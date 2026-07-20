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
require_once __DIR__ . '/lib/elo.php';
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

/** Locates a Profile inside a Session, or fails the request. */
function &profile_at(array &$session, string $profileId): array
{
    $index = find_profile($session, $profileId);
    if ($index === null) {
        throw new NotFound("profile");
    }
    return $session['profiles'][$index];
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
        $session = with_session($id, function (array $session) use ($nom): array {
            $session['nom'] = $nom === '' ? null : $nom;
            return $session;
        });
        send_json(session_view($session));
    }

    // POST /api/sessions/{id}/profiles — claim a Profile by naming it.
    if ($rest === ['profiles'] && $method === 'POST') {
        $name = body_string(read_body(), 'name');
        $created = null;
        with_session($id, function (array $session) use ($name, &$created): array {
            if (has_merged($session)) {
                throw new Conflict("Cette session est terminée : on ne peut plus la rejoindre.");
            }
            if (count($session['profiles']) >= MAX_PROFILES) {
                throw new Conflict("Cette session a déjà deux profils.");
            }
            if (has_profile_name($session, $name)) {
                throw new Conflict("Ce prénom de profil est déjà pris dans cette session.");
            }
            $created = empty_profile($name);
            $session['profiles'][] = $created;
            return $session;
        });
        send_json(profile_view($created), 201);
    }

    // POST /api/sessions/{id}/final/duels — the server owns Final Profile Ratings.
    if ($rest === ['final', 'duels'] && $method === 'POST') {
        $body = read_body();
        $mode = require_mode((string) ($body['mode'] ?? ''));
        $winner = require_prenom(body_string($body, 'winner', 40));
        $loser = require_prenom(body_string($body, 'loser', 40));
        if ($winner === $loser) {
            throw new BadRequest("Un Prénom ne peut pas se battre contre lui-même.");
        }
        $session = with_session($id, function (array $session) use ($mode, $winner, $loser): array {
            if (!has_merged($session)) {
                throw new Conflict("La session n'a pas encore fusionné.");
            }
            $final = &$session['final']['modes'][$mode];
            foreach ([$winner, $loser] as $prenom) {
                if (!isset($final['ratings'][$prenom])) {
                    throw new BadRequest("« $prenom » n'est pas dans cette liste.");
                }
            }
            // Computed here, inside the lock: two simultaneous picks both count.
            $adjusted = adjust((float) $final['ratings'][$winner], (float) $final['ratings'][$loser]);
            $final['ratings'][$winner] = $adjusted['winner'];
            $final['ratings'][$loser] = $adjusted['loser'];
            $final['duels'][$winner] = ($final['duels'][$winner] ?? 0) + 1;
            $final['duels'][$loser] = ($final['duels'][$loser] ?? 0) + 1;
            return $session;
        });
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
        send_json(profile_view(profile_at($session, $profileId)));
    }

    // POST /api/sessions/{id}/profiles/{pid}/ready — irreversible, and it may merge.
    if ($sub === ['ready'] && $method === 'POST') {
        $session = with_session($id, function (array $session) use ($profileId): array {
            $profile = &profile_at($session, $profileId);
            $profile['ready'] = true;
            unset($profile);
            // The merge happens in the same locked write, so a Session can never
            // sit with every Profile ready and no Final Profile.
            if (all_ready($session) && !has_merged($session)) {
                $session = merge_session($session);
            }
            return $session;
        });
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
        with_session($id, function (array $session) use ($profileId, $mode, $prenom, $verdict): array {
            if (has_merged($session)) {
                throw new Conflict("La session a fusionné : le tri est terminé.");
            }
            $profile = &profile_at($session, $profileId);
            if ($profile['ready'] === true) {
                throw new Conflict("Ce profil a déjà déclaré avoir terminé.");
            }
            // Keyed by (Profile, Mode, Prénom), so a retry is free.
            if ($verdict === null) {
                unset($profile['modes'][$mode]['verdicts'][$prenom]);
            } else {
                $profile['modes'][$mode]['verdicts'][$prenom] = $verdict;
            }
            return $session;
        });
        send_no_content();
    }

    /*
     * PUT /api/sessions/{id}/profiles/{pid}/ratings/{mode} — the per-Profile
     * Ratings and Duel counts for one Mode, written whole.
     *
     * Unlike the Final Profile, the maths is not done here: `src/lib/duel.ts`
     * owns the per-Profile phase, including `syncRatings`' enter-at-the-median
     * rule, and only one person ever writes these numbers, so there is no
     * simultaneous-pick problem to solve. The server just stores what it is given.
     */
    if (count($sub) === 2 && $sub[0] === 'ratings' && $method === 'PUT') {
        $mode = require_mode($sub[1]);
        $body = read_body();
        $ratings = [];
        $duels = [];
        foreach (($body['ratings'] ?? []) as $prenom => $rating) {
            if (!is_numeric($rating)) {
                throw new BadRequest("Note invalide.");
            }
            $ratings[require_prenom((string) $prenom)] = (float) $rating;
        }
        foreach (($body['duels'] ?? []) as $prenom => $count) {
            $prenom = require_prenom((string) $prenom);
            if (!is_int($count) || $count < 0 || !isset($ratings[$prenom])) {
                throw new BadRequest("Compteur de duels invalide.");
            }
            $duels[$prenom] = $count;
        }
        with_session($id, function (array $session) use ($profileId, $mode, $ratings, $duels): array {
            if (has_merged($session)) {
                throw new Conflict("La session a fusionné : le tri est terminé.");
            }
            $profile = &profile_at($session, $profileId);
            $profile['modes'][$mode]['ratings'] = $ratings;
            $profile['modes'][$mode]['duels'] = $duels;
            return $session;
        });
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
