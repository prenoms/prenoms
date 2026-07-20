<?php

/**
 * The thin HTTP layer: JSON in, JSON out, and a small set of exceptions the
 * front controller turns into status codes. No framework and no dependencies,
 * matching the frontend, which has no runtime dependencies either.
 */

declare(strict_types=1);

/** The client asked for something that is not there. */
class NotFound extends RuntimeException
{
}

/** The client asked for something impossible: a third Profile, a Duel in an
 *  unmerged Session, a Verdict after the merge. */
class BadRequest extends RuntimeException
{
}

/** The request is well formed but the Session's state forbids it. */
class Conflict extends RuntimeException
{
}

function send_json(mixed $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    // The API is same-origin: the frontend is served by the same Apache.
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

/**
 * Error bodies carry a French message, because every one of them can end up in
 * front of a user, and a `code` for the client to branch on.
 */
function send_error(int $status, string $code, string $message): never
{
    send_json(['error' => $code, 'message' => $message], $status);
}

/** For writes whose only interesting outcome is "it landed". */
function send_no_content(): never
{
    http_response_code(204);
    header('Cache-Control: no-store');
    exit;
}

function read_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) {
        throw new BadRequest("Requête illisible.");
    }
    return $decoded;
}

function body_string(array $body, string $key, int $maxLength = 60): string
{
    $value = $body[$key] ?? null;
    if (!is_string($value)) {
        throw new BadRequest("Champ « $key » manquant.");
    }
    $value = trim($value);
    if ($value === '' || mb_strlen($value) > $maxLength) {
        throw new BadRequest("Champ « $key » invalide.");
    }
    return $value;
}
