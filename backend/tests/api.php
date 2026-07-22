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

// --- The per-Profile Bracket -----------------------------------------------

test('a per-Profile Bracket is stored as the client played it', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    $response = request('PUT', "/api/sessions/$id/profiles/$pid/bracket/female", [
        'bracket' => [
            'field' => ['Jeanne', 'Zoe'],
            'size' => 2,
            'winners' => [null, 0],
            'gone' => [0],
            'places' => ['Jeanne'],
            'played' => 1,
        ],
    ]);
    assert_equals(204, $response['status']);
    $bracket = request('GET', "/api/sessions/$id/profiles/$pid")['body']['modes']['female']['bracket'];
    assert_equals(['Jeanne', 'Zoe'], $bracket['field']);
    assert_equals(['Jeanne'], $bracket['places']);
    assert_equals(1, $bracket['played']);
});

test('a Bracket whose tree does not match its draw is refused or cleaned, never trusted', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');

    $bad = request('PUT', "/api/sessions/$id/profiles/$pid/bracket/female", [
        'bracket' => ['field' => ['Jeanne', 'Bobby/../../etc']],
    ]);
    assert_equals(400, $bad['status'], 'a Prénom that is not one is refused outright');

    request('PUT', "/api/sessions/$id/profiles/$pid/bracket/female", [
        'bracket' => ['field' => ['Jeanne', 'Zoe'], 'winners' => [null, 42], 'places' => ['Paul']],
    ]);
    $bracket = request('GET', "/api/sessions/$id/profiles/$pid")['body']['modes']['female']['bracket'];
    assert_equals(null, $bracket['winners'][1], 'an index outside the draw is dropped');
    assert_equals([], $bracket['places'], 'a Place for a Prénom that was never drawn is dropped');
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
    $female = $merged['final']['modes']['female']['bracket']['field'];
    sort($female);
    assert_equals(['Jeanne', 'Zoe'], $female);
    assert_equals(['Paul'], $merged['final']['modes']['male']['bracket']['field']);
    assert_equals([], $merged['final']['modes']['female']['bracket']['places'], 'the draw starts level');
});

test('a Session with a single Profile merges as soon as that Profile is ready', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne", ['verdict' => 'keep']);
    $merged = request('POST', "/api/sessions/$id/profiles/$pid/ready")['body'];
    assert_equals(true, $merged['merged']);
    assert_equals(['Jeanne'], $merged['final']['modes']['female']['bracket']['field']);
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

test('the server resolves a Final Profile Duel and awards the Places', function () {
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
    $bracket = $final['body']['modes']['female']['bracket'];
    assert_equals(1, $bracket['played']);
    // A field of two fills both Places: the winner, then the other unopposed.
    assert_equals(['Jeanne', 'Zoe'], $bracket['places']);
});

test('a Duel needs two different Prénoms that are both in the Shortlist', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/Jeanne", ['verdict' => 'keep']);
    request('POST', "/api/sessions/$id/profiles/$pid/ready");
    $duels = "/api/sessions/$id/final/duels";

    assert_equals(400, request('POST', $duels, ['mode' => 'female', 'winner' => 'Jeanne', 'loser' => 'Jeanne'])['status']);
    assert_equals(400, request('POST', $duels, ['mode' => 'neutral', 'winner' => 'Jeanne', 'loser' => 'Zoe'])['status']);
    // Zoe was never drawn, so no node of the tree is waiting on that Duel.
    assert_equals(409, request('POST', $duels, ['mode' => 'female', 'winner' => 'Jeanne', 'loser' => 'Zoe'])['status']);
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

test('every Duel of a round lands — each is applied inside the lock', function () {
    $id = create_session_over_http();
    $pid = join_as($id, 'Alex');
    $field = ['Alice', 'Bruno', 'Chloe', 'David', 'Emma', 'Felix', 'Gaby', 'Hugo'];
    foreach ($field as $prenom) {
        request('PUT', "/api/sessions/$id/profiles/$pid/verdicts/female/$prenom", ['verdict' => 'keep']);
    }
    request('POST', "/api/sessions/$id/profiles/$pid/ready");

    // The first round is four independent Duels — this is exactly what the two
    // parents are handed at once, and none of them may overwrite another.
    $bracket = request('GET', "/api/sessions/$id")['body']['final']['modes']['female']['bracket'];
    $round = first_round_of($bracket);
    assert_equals(4, count($round), 'a field of eight opens with four Duels');

    foreach ($round as [$winner, $loser]) {
        $response = request('POST', "/api/sessions/$id/final/duels", [
            'mode' => 'female', 'winner' => $winner, 'loser' => $loser,
        ]);
        assert_equals(200, $response['status']);
    }

    $final = request('GET', "/api/sessions/$id")['body']['final']['modes']['female']['bracket'];
    assert_equals(4, $final['played'], 'not one of the four was lost to another');
});

/** The Duels a freshly drawn Bracket opens with, read off the draw. */
function first_round_of(array $bracket): array
{
    $duels = [];
    for ($i = 0; $i + 1 < count($bracket['field']); $i += 2) {
        $duels[] = [$bracket['field'][$i], $bracket['field'][$i + 1]];
    }
    return $duels;
}

// --- Routing ---------------------------------------------------------------

test('an unknown route is a 404 and a wrong method a 400', function () {
    $id = create_session_over_http();
    assert_equals(404, request('GET', '/api/nonsense')['status']);
    assert_equals(404, request('GET', "/api/sessions/$id/nonsense")['status']);
    assert_equals(400, request('GET', '/api/sessions')['status']);
});

summary();
