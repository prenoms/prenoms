<?php

/**
 * End-to-end tests: a real `php -S` on a throwaway data directory, driven over
 * HTTP the way `curl` would. Run with `just test-backend`.
 */

declare(strict_types=1);

require __DIR__ . '/harness.php';

$port = 8787;
$dataDir = sys_get_temp_dir() . '/prenoms-test-' . getmypid();
mkdir($dataDir, 0770, true);

$server = proc_open(
    sprintf(
        'PRENOMS_DATA_DIR=%s php -S 127.0.0.1:%d %s',
        escapeshellarg($dataDir),
        $port,
        escapeshellarg(__DIR__ . '/../index.php')
    ),
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
    $pipes
);

register_shutdown_function(function () use ($server, $dataDir) {
    proc_terminate($server);
    proc_close($server);
    foreach (glob("$dataDir/*") ?: [] as $file) {
        unlink($file);
    }
    @rmdir($dataDir);
});

// Wait for the server to accept connections.
for ($i = 0; $i < 100; $i++) {
    $socket = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.1);
    if ($socket !== false) {
        fclose($socket);
        break;
    }
    usleep(50_000);
}

/** @return array{status:int, body:mixed} */
function request(string $method, string $path, ?array $body = null): array
{
    global $port;
    $options = [
        'http' => [
            'method' => $method,
            'header' => "Content-Type: application/json\r\n",
            'ignore_errors' => true,
            'content' => $body === null ? '' : json_encode($body),
        ],
    ];
    $raw = file_get_contents("http://127.0.0.1:$port$path", false, stream_context_create($options));
    // `$http_response_header` is deprecated in 8.4 and the replacement does not
    // exist before it; the host's PHP version is not ours to assume.
    $headers = function_exists('http_get_last_response_headers')
        ? (http_get_last_response_headers() ?? [])
        : $http_response_header;
    $status = (int) explode(' ', $headers[0])[1];
    return ['status' => $status, 'body' => $raw === '' ? null : json_decode($raw, true)];
}

function create_session_over_http(): string
{
    $response = request('POST', '/api/sessions');
    assert_equals(201, $response['status']);
    return $response['body']['id'];
}

function join_as(string $sessionId, string $name): string
{
    $response = request('POST', "/api/sessions/$sessionId/profiles", ['name' => $name]);
    assert_equals(201, $response['status'], "joining as $name");
    return $response['body']['id'];
}

// --- Sessions --------------------------------------------------------------

test('creating a Session returns a readable id and an empty Session', function () {
    $response = request('POST', '/api/sessions');
    assert_equals(201, $response['status']);
    assert_equals(10, strlen($response['body']['id']));
    assert_equals([], $response['body']['profiles']);
    assert_equals(false, $response['body']['merged']);
});

test('an unknown Session is a 404, not a 500', function () {
    assert_equals(404, request('GET', '/api/sessions/K7M2QX9RTB')['status']);
});

test('a traversal attempt in the id is rejected before it reaches the filesystem', function () {
    foreach (['/api/sessions/..%2F..%2Fetc%2Fpasswd', '/api/sessions/..', '/api/sessions/x'] as $path) {
        assert_equals(404, request('GET', $path)['status'], "for $path");
    }
});

test('an id is accepted in lowercase', function () {
    $id = create_session_over_http();
    $response = request('GET', '/api/sessions/' . strtolower($id));
    assert_equals(200, $response['status']);
    assert_equals($id, $response['body']['id']);
});

test('the Nom belongs to the Session and either Profile may set it', function () {
    $id = create_session_over_http();
    assert_equals(null, request('GET', "/api/sessions/$id")['body']['nom']);
    assert_equals(200, request('PUT', "/api/sessions/$id/nom", ['nom' => 'Molveau'])['status']);
    assert_equals('Molveau', request('GET', "/api/sessions/$id")['body']['nom']);
    // Blank means "none".
    request('PUT', "/api/sessions/$id/nom", ['nom' => '  ']);
    assert_equals(null, request('GET', "/api/sessions/$id")['body']['nom']);
});

// --- Profiles --------------------------------------------------------------

test('a Session holds at most two Profiles', function () {
    $id = create_session_over_http();
    join_as($id, 'Alex');
    join_as($id, 'Camille');
    $third = request('POST', "/api/sessions/$id/profiles", ['name' => 'Dominique']);
    assert_equals(409, $third['status']);
});

test('Profile names are unique within a Session, case-insensitively', function () {
    $id = create_session_over_http();
    join_as($id, 'Alex');
    assert_equals(409, request('POST', "/api/sessions/$id/profiles", ['name' => 'alex'])['status']);
});

test('a Profile needs a name', function () {
    $id = create_session_over_http();
    assert_equals(400, request('POST', "/api/sessions/$id/profiles", ['name' => ' '])['status']);
    assert_equals(400, request('POST', "/api/sessions/$id/profiles", [])['status']);
});

test('a Profile has a stable seed and its own Verdicts', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    $first = request('GET', "/api/sessions/$id/profiles/$pid")['body'];
    $again = request('GET', "/api/sessions/$id/profiles/$pid")['body'];
    assert_equals($first['modes']['female']['seed'], $again['modes']['female']['seed']);
    assert_equals([], (array) $first['modes']['female']['verdicts']);
});

test('an unknown Profile id is a 404', function () {
    $id = create_session_over_http();
    assert_equals(404, request('GET', "/api/sessions/$id/profiles/K7M2QX9RTB")['status']);
});

// --- Verdicts --------------------------------------------------------------

test('a Verdict write is idempotent and a DELETE clears it', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    $path = "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne";

    assert_equals(204, request('PUT', $path, ['verdict' => 'keep'])['status']);
    assert_equals(204, request('PUT', $path, ['verdict' => 'keep'])['status']);
    $profile = request('GET', "/api/sessions/$id/profiles/$pid")['body'];
    assert_equals('keep', $profile['modes']['female']['verdicts']['Jeanne']);

    assert_equals(204, request('DELETE', $path)['status']);
    $profile = request('GET', "/api/sessions/$id/profiles/$pid")['body'];
    assert_equals([], (array) $profile['modes']['female']['verdicts']);
});

test('a Verdict in one Mode says nothing about the other', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Camille", ['verdict' => 'reject']);
    $profile = request('GET', "/api/sessions/$id/profiles/$pid")['body'];
    assert_equals('reject', $profile['modes']['female']['verdicts']['Camille']);
    assert_equals([], (array) $profile['modes']['male']['verdicts']);
});

test('a bad Mode, Verdict or Prénom is rejected', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    $base = "/api/sessions/$id/profiles/$pid/verdicts";
    assert_equals(400, request('PUT', "$base/neutral/Jeanne", ['verdict' => 'keep'])['status']);
    assert_equals(400, request('PUT', "$base/female/Jeanne", ['verdict' => 'maybe'])['status']);
    assert_equals(400, request('PUT', "$base/female/Jeanne%3B%20rm", ['verdict' => 'keep'])['status']);
});

test('one Profile never sees another Profile Verdicts', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    join_as($id, 'Camille');
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne", ['verdict' => 'keep']);

    $view = request('GET', "/api/sessions/$id")['body'];
    assert_true(!str_contains(json_encode($view), 'Jeanne'), 'a Verdict leaked into the Session view');
    assert_equals(2, count($view['profiles']));
});

// --- Per-Profile Ratings ---------------------------------------------------

test('per-Profile Ratings are stored as the client computed them', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    $response = request('PUT', "/api/sessions/$id/profiles/$pid/ratings/female", [
        'ratings' => ['Jeanne' => 1016.0, 'Zoe' => 984.0],
        'duels' => ['Jeanne' => 1, 'Zoe' => 1],
    ]);
    assert_equals(204, $response['status']);
    $profile = request('GET', "/api/sessions/$id/profiles/$pid")['body'];
    assert_equals(1016.0, $profile['modes']['female']['ratings']['Jeanne']);
    assert_equals(1, $profile['modes']['female']['duels']['Zoe']);
});

// --- Ready and the merge ---------------------------------------------------

test('ready is visible to the other Profile, and nothing else is', function () {
    $id = create_session_over_http();
    $alex = join_as($id, 'Alex');
    join_as($id, 'Camille');
    request('POST', "/api/sessions/$id/profiles/$alex/ready");

    $view = request('GET', "/api/sessions/$id")['body'];
    $states = array_column($view['profiles'], 'ready', 'name');
    assert_equals(true, $states['Alex']);
    assert_equals(false, $states['Camille']);
    assert_equals(false, $view['merged']);
});

test('the Session merges when the last Profile declares itself ready', function () {
    $id = create_session_over_http();
    $alex = join_as($id, 'Alex');
    $camille = join_as($id, 'Camille');

    request('PUT', "/api/sessions/$id/profiles/$alex/verdicts/female/Jeanne", ['verdict' => 'keep']);
    request('PUT', "/api/sessions/$id/profiles/$alex/verdicts/female/Zoe", ['verdict' => 'reject']);
    request('PUT', "/api/sessions/$id/profiles/$alex/verdicts/male/Paul", ['verdict' => 'keep']);
    request('PUT', "/api/sessions/$id/profiles/$camille/verdicts/female/Zoe", ['verdict' => 'keep']);

    request('POST', "/api/sessions/$id/profiles/$alex/ready");
    $merged = request('POST', "/api/sessions/$id/profiles/$camille/ready")['body'];

    assert_equals(true, $merged['merged']);
    // The union: Zoe is in although Alex rejected it.
    $female = array_keys((array) $merged['final']['modes']['female']['ratings']);
    sort($female);
    assert_equals(['Jeanne', 'Zoe'], $female);
    assert_equals(['Paul'], array_keys((array) $merged['final']['modes']['male']['ratings']));
    assert_equals(1000.0, $merged['final']['modes']['female']['ratings']['Jeanne']);
});

test('a Session with a single Profile merges as soon as that Profile is ready', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne", ['verdict' => 'keep']);
    $merged = request('POST', "/api/sessions/$id/profiles/$pid/ready")['body'];
    assert_equals(true, $merged['merged']);
    assert_equals(['Jeanne'], array_keys((array) $merged['final']['modes']['female']['ratings']));
});

test('ready cannot be undone, and swiping stops for the whole Session', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    request('POST', "/api/sessions/$id/profiles/$pid/ready");

    $verdict = request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne", ['verdict' => 'keep']);
    assert_equals(409, $verdict['status']);
    // And nobody can join a merged Session.
    assert_equals(409, request('POST', "/api/sessions/$id/profiles", ['name' => 'Camille'])['status']);
});

// --- Final Profile Duels ---------------------------------------------------

test('the server computes the Elo adjustment for a Final Profile Duel', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne", ['verdict' => 'keep']);
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Zoe", ['verdict' => 'keep']);
    request('POST', "/api/sessions/$id/profiles/$pid/ready");

    $final = request('POST', "/api/sessions/$id/final/duels", [
        'mode' => 'female',
        'winner' => 'Jeanne',
        'loser' => 'Zoe',
    ]);
    assert_equals(200, $final['status']);
    assert_equals(1016.0, $final['body']['modes']['female']['ratings']['Jeanne']);
    assert_equals(984.0, $final['body']['modes']['female']['ratings']['Zoe']);
    assert_equals(1, $final['body']['modes']['female']['duels']['Jeanne']);
});

test('a Duel needs two different Prénoms that are both in the Shortlist', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne", ['verdict' => 'keep']);
    request('POST', "/api/sessions/$id/profiles/$pid/ready");
    $duels = "/api/sessions/$id/final/duels";

    assert_equals(400, request('POST', $duels, ['mode' => 'female', 'winner' => 'Jeanne', 'loser' => 'Jeanne'])['status']);
    assert_equals(400, request('POST', $duels, ['mode' => 'female', 'winner' => 'Jeanne', 'loser' => 'Zoe'])['status']);
    assert_equals(400, request('POST', $duels, ['mode' => 'neutral', 'winner' => 'Jeanne', 'loser' => 'Zoe'])['status']);
});

test('a Duel before the merge is a conflict — there is no Final Profile yet', function () {
    $id = create_session_over_http();
    join_as($id, 'Alex');
    $response = request('POST', "/api/sessions/$id/final/duels", [
        'mode' => 'female',
        'winner' => 'Jeanne',
        'loser' => 'Zoe',
    ]);
    assert_equals(409, $response['status']);
});

test('concurrent Duels are not lost — the Elo runs inside the lock', function () {
    global $port;
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    foreach (['Jeanne', 'Zoe'] as $prenom) {
        request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/$prenom", ['verdict' => 'keep']);
    }
    request('POST', "/api/sessions/$id/profiles/$pid/ready");

    // Both parents pick at the same moment, ten times over.
    for ($i = 0; $i < 10; $i++) {
        request('POST', "/api/sessions/$id/final/duels", [
            'mode' => 'female', 'winner' => 'Jeanne', 'loser' => 'Zoe',
        ]);
    }
    $final = request('GET', "/api/sessions/$id")['body']['final'];
    assert_equals(10, $final['modes']['female']['duels']['Jeanne']);
    assert_true($final['modes']['female']['ratings']['Jeanne'] > 1100.0, 'ten wins should move the Rating');
});

// --- Routing ---------------------------------------------------------------

test('an unknown route is a 404 and a wrong method a 400', function () {
    $id = create_session_over_http();
    assert_equals(404, request('GET', '/api/nonsense')['status']);
    assert_equals(404, request('GET', "/api/sessions/$id/nonsense")['status']);
    assert_equals(400, request('GET', '/api/sessions')['status']);
});

summary();
