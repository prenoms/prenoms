<?php

/**
 * The shape of a Session and the operations on it. Pure functions over arrays:
 * nothing here touches the filesystem, so it is all testable without a server
 * (see `tests/unit.php`). `store.php` owns the locking and the JSON file.
 */

declare(strict_types=1);

require_once __DIR__ . '/ids.php';
require_once __DIR__ . '/elo.php';

const MODES = ['male', 'female'];

const VERDICTS = ['keep', 'reject'];

/** A Session holds exactly two Profiles at most. */
const MAX_PROFILES = 2;

/**
 * There is no migration system. A Session read with an unknown version is
 * handled the way `migrate()` did on the client: take what is recognisable,
 * default the rest. Bump this when the shape changes.
 */
const SESSION_VERSION = 1;

function empty_mode_state(): array
{
    return [
        // Drives the stable Deck shuffle in Swipe. Generated once, per Profile.
        'seed' => random_int(0, 2 ** 31 - 1),
        // Keyed by the Prénom string — never a row index, the CSV is hand-edited.
        'verdicts' => [],
        // Shortlist only.
        'ratings' => [],
        // Duels played per Prénom, for provisionality.
        'duels' => [],
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
            foreach (['verdicts', 'ratings', 'duels'] as $map) {
                if (isset($storedMode[$map]) && is_array($storedMode[$map])) {
                    $profile['modes'][$mode][$map] = $storedMode[$map];
                }
            }
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
 * Every prior Rating is discarded and the Final Profile starts level. Averaging
 * the two Rankings would invent a comparison that was never played: a Rating is
 * meaningful only against the Shortlist it was earned in (ADR 0003).
 */
function merge_session(array $session): array
{
    $final = ['modes' => []];
    foreach (MODES as $mode) {
        $ratings = [];
        $duels = [];
        foreach ($session['profiles'] as $profile) {
            foreach ($profile['modes'][$mode]['verdicts'] as $prenom => $verdict) {
                if ($verdict !== 'keep') {
                    continue;
                }
                $ratings[$prenom] = START_RATING;
                $duels[$prenom] = 0;
            }
        }
        $final['modes'][$mode] = ['ratings' => $ratings, 'duels' => $duels];
    }
    $session['final'] = $final;
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
        $view['modes'][$mode] = [
            // The Shortlist is the key set: a Prénom in the Final Profile has a Rating.
            'ratings' => as_map($final['modes'][$mode]['ratings'] ?? []),
            'duels' => as_map($final['modes'][$mode]['duels'] ?? []),
        ];
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
            'ratings' => as_map($profile['modes'][$mode]['ratings']),
            'duels' => as_map($profile['modes'][$mode]['duels']),
        ];
    }
    return [
        'id' => $profile['id'],
        'name' => $profile['name'],
        'ready' => $profile['ready'],
        'modes' => $modes,
    ];
}
