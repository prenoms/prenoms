<?php

/**
 * Session and Profile ids: ten characters of Crockford base32 from a CSPRNG,
 * about fifty bits. Short enough to read aloud over the phone and to carry in a
 * path (`/s/K7M2QX9RTB`), unguessable enough for a hobby host (ADR 0003).
 */

declare(strict_types=1);

/** Crockford base32 — no I, L, O or U, so nothing reads as a digit. */
const ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const ID_LENGTH = 10;

function new_id(): string
{
    $bytes = random_bytes(ID_LENGTH);
    $id = '';
    for ($i = 0; $i < ID_LENGTH; $i++) {
        // 32 divides 256, so the modulo is unbiased.
        $id .= ID_ALPHABET[ord($bytes[$i]) % 32];
    }
    return $id;
}

/**
 * The one security-critical line in the codebase. A Session id is user input
 * that becomes a filename, so it is matched whole against the alphabet before
 * it goes anywhere near a path — never sanitised, never escaped, just rejected.
 * `D` anchors the pattern to the end of the string with no trailing newline
 * allowed, which `$` alone would permit.
 */
function valid_id(string $candidate): bool
{
    return preg_match('/^[0-9A-HJKMNP-TV-Z]{10}$/D', strtoupper($candidate)) === 1;
}

/** Ids are case-insensitive on input and uppercase everywhere else. */
function normalise_id(string $id): string
{
    return strtoupper($id);
}
