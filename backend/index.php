<?php

/**
 * The whole API. Apache rewrites `/api/*` here (see `.htaccess`); everything
 * else goes to `index.html` and the Svelte app.
 *
 * Authorisation is possession of the Session id and nothing else — no tokens,
 * no CSRF, no accounts. The only two people who ever see the link are the two
 * people who share the Session, and impersonation between them is not a threat
 * we are asked to solve (ADR 0003).
 */

declare(strict_types=1);

require_once __DIR__ . '/lib/http.php';
require_once __DIR__ . '/lib/ids.php';
require_once __DIR__ . '/lib/bracket.php';
require_once __DIR__ . '/lib/session.php';
require_once __DIR__ . '/lib/store.php';

/** A Prénom is identified by its string and is used as a map key, never a path. */
const PRENOM_PATTERN = "/^[A-Za-z' -]{1,40}$/D";

/**
 * The path, split and only then decoded — decoding first would let an encoded
 * `%2F` in a Prénom split into two segments and shift everything after it.
 */
function segments(): array
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $path = preg_replace('#^/api#', '', $path);
    $parts = array_filter(explode('/', $path), fn($s) => $s !== '');
    return array_values(array_map(rawurldecode(...), $parts));
}

function require_session_id(string $raw): string
{
    // The one security-critical check: user input about to become a filename.
    if (!valid_id($raw)) {
        throw new NotFound("session");
    }
    return normalise_id($raw);
}

function require_mode(string $mode): string
{
    if (!in_array($mode, MODES, true)) {
        throw new BadRequest("Mode inconnu.");
    }
    return $mode;
}

function require_prenom(string $prenom): string
{
    if (preg_match(PRENOM_PATTERN, $prenom) !== 1) {
        throw new BadRequest("Prénom invalide.");
    }
    return $prenom;
}

function handle(string $method, array $path): never
{
    if ($path === [] || $path[0] !== 'sessions') {
        throw new NotFound("route");
    }

    // POST /api/sessions — create a Session.
    if (count($path) === 1) {
        if ($method !== 'POST') {
            throw new BadRequest("Méthode non autorisée.");
        }
        send_json(session_view(create_session()), 201);
    }

    $id = require_session_id($path[1]);
    $rest = array_slice($path, 2);

    // GET /api/sessions/{id} — what the join screen may see.
    if ($rest === []) {
        if ($method !== 'GET') {
            throw new BadRequest("Méthode non autorisée.");
        }
        $session = read_session($id);
        if ($session === null) {
            throw new NotFound("session");
        }
        send_json(session_view($session));
    }

    // PUT /api/sessions/{id}/nom — Session-level, either Profile may set it.
    if ($rest === ['nom'] && $method === 'PUT') {
        $body = read_body();
        $nom = $body['nom'] ?? null;
        if ($nom !== null && !is_string($nom)) {
            throw new BadRequest("Nom invalide.");
        }
        // Blank means "none", stored as null so the views have one thing to test.
        $nom = is_string($nom) ? trim($nom) : '';
        if (mb_strlen($nom) > 60) {
            throw new BadRequest("Nom trop long.");
        }
        send_json(session_view(with_session($id, fn(array $s): array => set_nom($s, $nom))));
    }

    // POST /api/sessions/{id}/profiles — claim a Profile by naming it.
    if ($rest === ['profiles'] && $method === 'POST') {
        // Built here so the response can answer with the Profile rather than
        // the Session; `add_profile()` decides whether it may join at all.
        $created = empty_profile(body_string(read_body(), 'name'));
        with_session($id, fn(array $s): array => add_profile($s, $created));
        send_json(profile_view($created), 201);
    }

    // POST /api/sessions/{id}/final/duels — the server owns Final Profile Ratings.
    if ($rest === ['final', 'duels'] && $method === 'POST') {
        $body = read_body();
        $mode = require_mode((string) ($body['mode'] ?? ''));
        $winner = require_prenom(body_string($body, 'winner', 40));
        $loser = require_prenom(body_string($body, 'loser', 40));
        // The Duel is applied inside the lock, so two simultaneous picks both count.
        $session = with_session(
            $id,
            fn(array $s): array => record_final_duel($s, $mode, $winner, $loser),
        );
        send_json(final_view($session['final']));
    }

    if ($rest[0] !== 'profiles' || count($rest) < 2) {
        throw new NotFound("route");
    }
    $profileId = $rest[1];
    $sub = array_slice($rest, 2);

    // GET /api/sessions/{id}/profiles/{pid} — that Profile's own state.
    if ($sub === [] && $method === 'GET') {
        $session = read_session($id);
        if ($session === null) {
            throw new NotFound("session");
        }
        send_json(profile_view($session['profiles'][require_profile($session, $profileId)]));
    }

    // POST /api/sessions/{id}/profiles/{pid}/ready — irreversible, and it may merge.
    if ($sub === ['ready'] && $method === 'POST') {
        $session = with_session($id, fn(array $s): array => declare_ready($s, $profileId));
        send_json(session_view($session));
    }

    // PUT|DELETE /api/sessions/{id}/profiles/{pid}/verdicts/{mode}/{prenom}
    if (count($sub) === 3 && $sub[0] === 'verdicts') {
        $mode = require_mode($sub[1]);
        $prenom = require_prenom($sub[2]);
        $verdict = null;
        if ($method === 'PUT') {
            $verdict = (string) (read_body()['verdict'] ?? '');
            if (!in_array($verdict, VERDICTS, true)) {
                throw new BadRequest("Verdict inconnu.");
            }
        } elseif ($method !== 'DELETE') {
            throw new BadRequest("Méthode non autorisée.");
        }
        with_session(
            $id,
            fn(array $s): array => record_verdict($s, $profileId, $mode, $prenom, $verdict),
        );
        send_no_content();
    }

    /*
     * PUT /api/sessions/{id}/profiles/{pid}/bracket/{mode} — the per-Profile
     * Bracket for one Mode, written whole. Every Prénom in the body is checked
     * here; `clean_bracket()` is what makes sure the tree still indexes into the
     * draw, and `replace_bracket()` what the Session permits.
     */
    if (count($sub) === 2 && $sub[0] === 'bracket' && $method === 'PUT') {
        $mode = require_mode($sub[1]);
        $bracket = read_body()['bracket'] ?? null;
        if (!is_array($bracket) || !is_array($bracket['field'] ?? null)) {
            throw new BadRequest("Tournoi invalide.");
        }
        foreach ($bracket['field'] as $prenom) {
            require_prenom((string) $prenom);
        }
        with_session($id, fn(array $s): array => replace_bracket($s, $profileId, $mode, $bracket));
        send_no_content();
    }

    throw new NotFound("route");
}

try {
    handle($_SERVER['REQUEST_METHOD'] ?? 'GET', segments());
} catch (NotFound) {
    send_error(404, 'not_found', "Session ou profil introuvable.");
} catch (BadRequest $e) {
    send_error(400, 'bad_request', $e->getMessage());
} catch (Conflict $e) {
    send_error(409, 'conflict', $e->getMessage());
} catch (Throwable $e) {
    error_log('prenoms: ' . $e->getMessage());
    send_error(500, 'server_error', "Erreur du serveur. Réessayez dans un instant.");
}
