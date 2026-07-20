<?php

/**
 * One JSON file per Session, in a directory outside the web root. There is no
 * database on the host, so the file is the record and `flock(LOCK_EX)` is the
 * whole concurrency story: every mutation is a read-modify-write held under one
 * exclusive lock from the read to the write (ADR 0003).
 */

declare(strict_types=1);

require_once __DIR__ . '/ids.php';
require_once __DIR__ . '/session.php';

/** Sessions untouched for this long are unlinked. We hold people's data. */
const SESSION_TTL_SECONDS = 365 * 24 * 60 * 60;

/** The host has no cron, so the sweep rides on writes, roughly one in a hundred. */
const SWEEP_ODDS = 100;

function data_dir(): string
{
    $dir = getenv('PRENOMS_DATA_DIR');
    if (is_string($dir) && $dir !== '') {
        return rtrim($dir, '/');
    }
    require_once __DIR__ . '/../config.php';
    return rtrim(PRENOMS_DATA_DIR, '/');
}

/**
 * The only place a Session id meets the filesystem. It is validated first and
 * the caller is expected to have rejected anything invalid long before here —
 * this is the belt to that pair of braces.
 */
function session_path(string $id): string
{
    if (!valid_id($id)) {
        throw new InvalidArgumentException("invalid session id");
    }
    return data_dir() . '/' . normalise_id($id) . '.json';
}

function session_exists(string $id): bool
{
    return valid_id($id) && is_file(session_path($id));
}

function ensure_data_dir(): void
{
    $dir = data_dir();
    if (!is_dir($dir) && !mkdir($dir, 0770, true) && !is_dir($dir)) {
        throw new RuntimeException("cannot create data directory");
    }
}

/**
 * Creates a Session under a fresh id. The `x` mode makes the create atomic, so
 * the astronomically unlikely id collision is a retry rather than a silent
 * overwrite of somebody else's Session.
 */
function create_session(): array
{
    ensure_data_dir();
    for ($attempt = 0; $attempt < 5; $attempt++) {
        $id = new_id();
        $handle = @fopen(session_path($id), 'x');
        if ($handle === false) {
            continue;
        }
        $session = empty_session($id);
        fwrite($handle, encode_session($session));
        fclose($handle);
        maybe_sweep();
        return $session;
    }
    throw new RuntimeException("could not allocate a session id");
}

function encode_session(array $session): string
{
    return json_encode($session, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
}

/** Reads a Session without taking a lock. Fine for GETs: a torn read is impossible
 *  because writers replace the contents under an exclusive lock in one go. */
function read_session(string $id): ?array
{
    if (!session_exists($id)) {
        return null;
    }
    $raw = @file_get_contents(session_path($id));
    if ($raw === false) {
        return null;
    }
    return migrate_session(json_decode($raw, true), normalise_id($id));
}

/**
 * The one way to mutate a Session. `$mutate` receives the current Session and
 * returns the new one, or throws to abandon the write; everything it does
 * happens inside the lock, which is what lets the server own Final Profile
 * Ratings without losing a Duel to a simultaneous pick.
 *
 * Returns the written Session, so a caller can answer with the new state
 * without reading the file a second time.
 */
function with_session(string $id, callable $mutate): array
{
    if (!session_exists($id)) {
        throw new NotFound("session");
    }
    $handle = fopen(session_path($id), 'r+');
    if ($handle === false) {
        throw new RuntimeException("cannot open session");
    }
    try {
        if (!flock($handle, LOCK_EX)) {
            throw new RuntimeException("cannot lock session");
        }
        $raw = stream_get_contents($handle);
        $session = migrate_session(json_decode($raw, true), normalise_id($id));

        $session = $mutate($session);

        $encoded = encode_session($session);
        rewind($handle);
        ftruncate($handle, 0);
        fwrite($handle, $encoded);
        fflush($handle);
        flock($handle, LOCK_UN);
    } finally {
        fclose($handle);
    }
    maybe_sweep();
    return $session;
}

/**
 * Unlinks Sessions whose file has not been touched in twelve months. Swept
 * probabilistically on write because the host has no cron; over any month with
 * real traffic the sweep runs many times, and if the app goes quiet there is
 * nothing accumulating anyway.
 */
function maybe_sweep(): void
{
    if (random_int(1, SWEEP_ODDS) !== 1) {
        return;
    }
    $cutoff = time() - SESSION_TTL_SECONDS;
    foreach (glob(data_dir() . '/*.json') ?: [] as $path) {
        $mtime = @filemtime($path);
        if ($mtime !== false && $mtime < $cutoff) {
            @unlink($path);
        }
    }
}
