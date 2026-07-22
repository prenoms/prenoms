<?php

/**
 * The shape of a Session, and every rule about what may be done to one.
 * Functions over arrays: nothing here touches the filesystem or the request, so
 * it is all testable without a server (see `tests/unit.php`). `store.php` owns
 * the locking and the JSON file; `index.php` owns the routing and the shape of
 * a request body, and nothing else.
 *
 * An operation that the Session's state forbids throws — the same `Conflict`,
 * `NotFound` and `BadRequest` the front controller turns into status codes, so
 * the rule and the French sentence that explains it sit together rather than
 * one being in the routing layer and the other in a comment here.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';
require_once __DIR__ . '/ids.php';
require_once __DIR__ . '/bracket.php';

const MODES = ['male', 'female'];

const VERDICTS = ['keep', 'reject'];

/** A Session holds exactly two Profiles at most. */
const MAX_PROFILES = 2;

/**
 * There is no migration system. A Session read with an unknown version is
 * handled the way `migrate()` did on the client: take what is recognisable,
 * default the rest. Bump this when the shape changes.
 */
const SESSION_VERSION = 2;

function empty_mode_state(): array
{
    return [
        // Drives the stable Deck shuffle in Swipe. Generated once, per Profile.
        'seed' => random_int(0, 2 ** 31 - 1),
        // Keyed by the Prénom string — never a row index, the CSV is hand-edited.
        'verdicts' => [],
        // The tournament over the Shortlist, and the Places it has awarded.
        'bracket' => empty_bracket(),
    ];
}

function empty_profile(string $name): array
{
    return [
        'id' => new_id(),
        // Identity is the id, so a Profile can be renamed without touching Verdicts.
        'name' => $name,
        'ready' => false,
        'modes' => ['male' => empty_mode_state(), 'female' => empty_mode_state()],
    ];
}

function empty_session(string $id): array
{
    return [
        'version' => SESSION_VERSION,
        'id' => $id,
        'createdAt' => time(),
        // Belongs to the Session, not to a Profile: one family name, either may set it.
        'nom' => null,
        'profiles' => [],
        // Null until the merge; a Session with a Final Profile never swipes again.
        'final' => null,
    ];
}

/**
 * Brings whatever is on disk up to the current shape, in the spirit of the
 * client's old `migrate()`: unrecognisable fields are defaulted rather than
 * fatal, unknown Prénoms are kept because a later rebuild of the Prénom List
 * may bring them back.
 */
function migrate_session(mixed $raw, string $id): array
{
    if (!is_array($raw)) {
        return empty_session($id);
    }
    $session = empty_session($id);
    if (isset($raw['createdAt']) && is_int($raw['createdAt'])) {
        $session['createdAt'] = $raw['createdAt'];
    }
    if (isset($raw['nom']) && is_string($raw['nom']) && $raw['nom'] !== '') {
        $session['nom'] = $raw['nom'];
    }
    foreach ($raw['profiles'] ?? [] as $stored) {
        if (!is_array($stored) || !isset($stored['id'], $stored['name'])) {
            continue;
        }
        $profile = empty_profile((string) $stored['name']);
        $profile['id'] = (string) $stored['id'];
        $profile['ready'] = ($stored['ready'] ?? false) === true;
        foreach (MODES as $mode) {
            $storedMode = $stored['modes'][$mode] ?? null;
            if (!is_array($storedMode)) {
                continue;
            }
            if (isset($storedMode['seed']) && is_int($storedMode['seed'])) {
                $profile['modes'][$mode]['seed'] = $storedMode['seed'];
            }
            if (isset($storedMode['verdicts']) && is_array($storedMode['verdicts'])) {
                $profile['modes'][$mode]['verdicts'] = $storedMode['verdicts'];
            }
            // Version 1 stored Elo Ratings. There is nothing to convert: a
            // Rating was a number every Prénom had, a Place is a tournament
            // somebody won, and seeding a draw from old Ratings would decide
            // who meets whom by a number we have stopped believing in. The
            // Verdicts survive, the Bracket is drawn again.
            $profile['modes'][$mode]['bracket'] = clean_bracket($storedMode['bracket'] ?? null);
        }
        $session['profiles'][] = $profile;
    }
    if (isset($raw['final']) && is_array($raw['final'])) {
        $session['final'] = $raw['final'];
    }
    return $session;
}

function find_profile(array $session, string $profileId): ?int
{
    foreach ($session['profiles'] as $index => $profile) {
        if ($profile['id'] === $profileId) {
            return $index;
        }
    }
    return null;
}

function has_profile_name(array $session, string $name): bool
{
    foreach ($session['profiles'] as $profile) {
        if (mb_strtolower($profile['name']) === mb_strtolower($name)) {
            return true;
        }
    }
    return false;
}

/**
 * True once every Profile in the Session is ready. An empty Session is never
 * ready — there is nothing to merge — but a Session with a single ready Profile
 * is, because the union of one set is itself and the app has to work alone.
 */
function all_ready(array $session): bool
{
    if (count($session['profiles']) === 0) {
        return false;
    }
    foreach ($session['profiles'] as $profile) {
        if ($profile['ready'] !== true) {
            return false;
        }
    }
    return true;
}

function has_merged(array $session): bool
{
    return $session['final'] !== null;
}

/**
 * The merge: per Mode, the union of every Prénom any Profile kept, including
 * the ones the other rejected. A rejection is a statement about your own list,
 * not a veto over theirs — the disagreement is forwarded to the Duels.
 *
 * Every prior Bracket is discarded and the Final Profile is drawn afresh. The
 * two tournaments were played over two different fields, and half the Prénoms
 * in the union were never in the other's — carrying a Place across would seed
 * this draw on results that were never about these opponents (ADR 0003).
 */
function merge_session(array $session): array
{
    $final = ['modes' => []];
    foreach (MODES as $mode) {
        $kept = [];
        foreach ($session['profiles'] as $profile) {
            foreach ($profile['modes'][$mode]['verdicts'] as $prenom => $verdict) {
                if ($verdict === 'keep') {
                    $kept[$prenom] = true;
                }
            }
        }
        $final['modes'][$mode] = ['bracket' => draw_bracket(array_keys($kept))];
    }
    $session['final'] = $final;
    return $session;
}

/* ---------------------------------------------------------------- operations */

/*
 * Each takes a Session and returns the new one, so they compose inside
 * `with_session()`'s closure and can be run against a bare array in a test.
 * Each enforces its own guards: the caller has already checked that the request
 * is well formed, never that the Session permits it.
 */

/**
 * Locates a Profile, or fails the request. Returns the index rather than the
 * Profile because the caller is about to write to it, and a copy would be lost.
 */
function require_profile(array $session, string $profileId): int
{
    $index = find_profile($session, $profileId);
    if ($index === null) {
        throw new NotFound("profile");
    }
    return $index;
}

/** The Nom is the Session's: one family name, either Profile may set it, and it
 *  outlives both the merge and a Profile being ready. Blank means "none",
 *  stored as null so the views have one thing to test. */
function set_nom(array $session, string $nom): array
{
    $session['nom'] = $nom === '' ? null : $nom;
    return $session;
}

/**
 * Adds a Profile built by `empty_profile()`. The Profile is passed in rather
 * than named here so the caller keeps a handle on it for the response — it is
 * the created Profile that is sent back, not the Session.
 */
function add_profile(array $session, array $profile): array
{
    if (has_merged($session)) {
        throw new Conflict("Cette session est terminée : on ne peut plus la rejoindre.");
    }
    if (count($session['profiles']) >= MAX_PROFILES) {
        throw new Conflict("Cette session a déjà deux profils.");
    }
    if (has_profile_name($session, $profile['name'])) {
        throw new Conflict("Ce prénom de profil est déjà pris dans cette session.");
    }
    $session['profiles'][] = $profile;
    return $session;
}

/**
 * Ready is irreversible and covers both Modes. The merge happens in the same
 * call, and therefore in the same locked write, so a Session can never sit with
 * every Profile ready and no Final Profile.
 */
function declare_ready(array $session, string $profileId): array
{
    $index = require_profile($session, $profileId);
    $session['profiles'][$index]['ready'] = true;
    if (all_ready($session) && !has_merged($session)) {
        $session = merge_session($session);
    }
    return $session;
}

/**
 * One Verdict, keyed by (Profile, Mode, Prénom) exactly as the endpoint is —
 * which is what makes a retry free. A null Verdict clears it, returning the
 * Prénom to the swipe Deck unjudged.
 */
function record_verdict(
    array $session,
    string $profileId,
    string $mode,
    string $prenom,
    ?string $verdict,
): array {
    if (has_merged($session)) {
        throw new Conflict("La session a fusionné : le tri est terminé.");
    }
    $index = require_profile($session, $profileId);
    if ($session['profiles'][$index]['ready'] === true) {
        throw new Conflict("Ce profil a déjà déclaré avoir terminé.");
    }
    if ($verdict === null) {
        unset($session['profiles'][$index]['modes'][$mode]['verdicts'][$prenom]);
    } else {
        $session['profiles'][$index]['modes'][$mode]['verdicts'][$prenom] = $verdict;
    }
    return $session;
}

/**
 * One Mode's per-Profile Bracket, written whole. The rules are not applied here:
 * `src/lib/bracket.ts` owns the per-Profile phase, and only one person ever
 * writes this state, so there is no simultaneous-pick problem to solve. The
 * Final Profile is the opposite case — see `record_final_duel()`.
 *
 * It still goes through `clean_bracket()`, because a Bracket has an invariant a
 * map of Verdicts does not: the tree indexes into the draw.
 */
function replace_bracket(array $session, string $profileId, string $mode, array $bracket): array
{
    if (has_merged($session)) {
        throw new Conflict("La session a fusionné : le tri est terminé.");
    }
    $index = require_profile($session, $profileId);
    $session['profiles'][$index]['modes'][$mode]['bracket'] = clean_bracket($bracket);
    return $session;
}

/**
 * One Final Profile Duel. Only the fact arrives — which Prénom was preferred —
 * and what it settles is worked out here, inside the lock, so two parents
 * picking at the same moment both count (ADR 0003). A Duel the tree is no
 * longer waiting on is refused: the other parent got there first, and the
 * client asks for the next question rather than inventing an answer.
 */
function record_final_duel(array $session, string $mode, string $winner, string $loser): array
{
    if (!has_merged($session)) {
        throw new Conflict("La session n'a pas encore fusionné.");
    }
    if ($winner === $loser) {
        throw new BadRequest("Un Prénom ne peut pas se battre contre lui-même.");
    }
    $bracket = clean_bracket($session['final']['modes'][$mode]['bracket'] ?? null);
    $session['final']['modes'][$mode]['bracket'] = resolve_bracket($bracket, $winner, $loser);
    return $session;
}

/** Casts a map to an object so an empty one encodes as `{}`, never as `[]`. */
function as_map(array $map): stdClass
{
    return (object) $map;
}

function final_view(?array $final): ?array
{
    if ($final === null) {
        return null;
    }
    $view = ['modes' => []];
    foreach (MODES as $mode) {
        // The Shortlist is the draw: everything in the field, placed or not.
        $view['modes'][$mode] = ['bracket' => bracket_view(clean_bracket($final['modes'][$mode]['bracket'] ?? null))];
    }
    return $view;
}

/**
 * What the join screen is allowed to see: which Profiles exist, whether each is
 * ready, and whether the Session has merged. Never another Profile's Verdicts —
 * seeing their Shortlist while you are still swiping would make the final Duels
 * theatre.
 */
function session_view(array $session): array
{
    $profiles = [];
    foreach ($session['profiles'] as $profile) {
        $profiles[] = [
            'id' => $profile['id'],
            'name' => $profile['name'],
            'ready' => $profile['ready'],
        ];
    }
    return [
        'id' => $session['id'],
        'nom' => $session['nom'],
        'merged' => has_merged($session),
        'profiles' => $profiles,
        'final' => final_view($session['final']),
    ];
}

/** A Profile's own state, returned only to whoever asked for it by id. */
function profile_view(array $profile): array
{
    $modes = [];
    foreach (MODES as $mode) {
        $modes[$mode] = [
            'seed' => $profile['modes'][$mode]['seed'],
            'verdicts' => as_map($profile['modes'][$mode]['verdicts']),
            'bracket' => bracket_view($profile['modes'][$mode]['bracket']),
        ];
    }
    return [
        'id' => $profile['id'],
        'name' => $profile['name'],
        'ready' => $profile['ready'],
        'modes' => $modes,
    ];
}
