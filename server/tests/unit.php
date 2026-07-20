<?php

/**
 * Unit tests for the pure parts of the API: id validation, the Elo port and the
 * merge. Run with `php server/tests/unit.php`. No Composer, so no PHPUnit —
 * assertions are three helper functions and an exit code.
 */

declare(strict_types=1);

require __DIR__ . '/harness.php';
require __DIR__ . '/../lib/ids.php';
require __DIR__ . '/../lib/elo.php';
require __DIR__ . '/../lib/session.php';

// --- Ids -------------------------------------------------------------------

test('a generated id is ten Crockford characters', function () {
    for ($i = 0; $i < 50; $i++) {
        $id = new_id();
        assert_true(strlen($id) === 10, "expected 10 chars, got '$id'");
        assert_true(valid_id($id), "generated id '$id' failed its own validation");
    }
});

test('generated ids never contain the excluded letters', function () {
    $seen = '';
    for ($i = 0; $i < 200; $i++) {
        $seen .= new_id();
    }
    foreach (['I', 'L', 'O', 'U'] as $excluded) {
        assert_true(!str_contains($seen, $excluded), "id alphabet leaked '$excluded'");
    }
});

test('ids are unique across a large sample', function () {
    $ids = [];
    for ($i = 0; $i < 500; $i++) {
        $ids[new_id()] = true;
    }
    assert_equals(500, count($ids));
});

test('valid_id rejects anything that could escape the data directory', function () {
    $attacks = [
        '../../etc/passwd',
        '..',
        '.',
        'K7M2QX9RT/',
        'K7M2QX9R.B',
        "K7M2QX9RT\0",
        'K7M2QX9RTB.json',
        '',
        'K7M2QX9RT',      // too short
        'K7M2QX9RTBB',    // too long
        'K7M2QX9RTI',     // I is not in the alphabet
        'K7M2QX9RTL',
        'K7M2QX9RTO',
        'K7M2QX9RTU',
        'K7M2QX-RTB',
    ];
    foreach ($attacks as $attack) {
        assert_true(!valid_id($attack), "valid_id accepted " . json_encode($attack));
    }
});

test('valid_id accepts lowercase, since ids are read aloud', function () {
    assert_true(valid_id('k7m2qx9rtb'));
    assert_equals('K7M2QX9RTB', normalise_id('k7m2qx9rtb'));
});

// --- Elo -------------------------------------------------------------------

test('adjust matches the TypeScript port for equal Ratings', function () {
    $adjusted = adjust(1000.0, 1000.0);
    assert_equals(1016.0, $adjusted['winner']);
    assert_equals(984.0, $adjusted['loser']);
});

test('adjust moves both Ratings by the same shift', function () {
    $adjusted = adjust(1200.0, 1000.0);
    $shift = $adjusted['winner'] - 1200.0;
    assert_close($shift, 1000.0 - $adjusted['loser']);
    assert_true($shift > 0 && $shift < 16.0, "an expected win should shift less than half K, got $shift");
});

test('an upset shifts more than an expected win', function () {
    $upset = adjust(1000.0, 1400.0)['winner'] - 1000.0;
    $expected = adjust(1400.0, 1000.0)['winner'] - 1400.0;
    assert_true($upset > $expected, 'the underdog should gain more');
});

// --- Sessions --------------------------------------------------------------

test('a new Session has no Profiles, no Nom and has not merged', function () {
    $session = empty_session('K7M2QX9RTB');
    assert_equals('K7M2QX9RTB', $session['id']);
    assert_equals([], $session['profiles']);
    assert_equals(null, $session['nom']);
    assert_true($session['final'] === null);
});

test('a Profile starts with a seed and empty Verdicts in both Modes', function () {
    $profile = empty_profile('Camille');
    assert_equals('Camille', $profile['name']);
    assert_true($profile['ready'] === false);
    foreach (MODES as $mode) {
        assert_true(is_int($profile['modes'][$mode]['seed']));
        assert_equals([], $profile['modes'][$mode]['verdicts']);
        assert_equals([], $profile['modes'][$mode]['ratings']);
    }
});

test('the public view of a Session never exposes Verdicts', function () {
    $session = empty_session('K7M2QX9RTB');
    $session['profiles'][] = empty_profile('A');
    $session['profiles'][0]['modes']['female']['verdicts']['JEANNE'] = 'keep';

    $view = session_view($session);
    assert_true(!str_contains(json_encode($view), 'JEANNE'), 'a Verdict leaked into the Session view');
    assert_equals(1, count($view['profiles']));
    assert_equals('A', $view['profiles'][0]['name']);
    assert_true($view['profiles'][0]['ready'] === false);
});

test('the merge is the union of every keep, per Mode', function () {
    $session = empty_session('K7M2QX9RTB');
    $a = empty_profile('A');
    $a['modes']['female']['verdicts'] = ['JEANNE' => 'keep', 'ZOE' => 'reject'];
    $a['modes']['male']['verdicts'] = ['PAUL' => 'keep'];
    $b = empty_profile('B');
    $b['modes']['female']['verdicts'] = ['ZOE' => 'keep', 'JEANNE' => 'reject'];
    $session['profiles'] = [$a, $b];

    $session = merge_session($session);

    $female = array_keys($session['final']['modes']['female']['ratings']);
    sort($female);
    assert_equals(['JEANNE', 'ZOE'], $female);
    assert_equals(['PAUL'], array_keys($session['final']['modes']['male']['ratings']));
});

test('the merge discards every prior Rating and starts the Final Profile level', function () {
    $session = empty_session('K7M2QX9RTB');
    $a = empty_profile('A');
    $a['modes']['female']['verdicts'] = ['JEANNE' => 'keep', 'ZOE' => 'keep'];
    $a['modes']['female']['ratings'] = ['JEANNE' => 1600.0, 'ZOE' => 800.0];
    $a['modes']['female']['duels'] = ['JEANNE' => 12, 'ZOE' => 12];
    $session['profiles'] = [$a];

    $session = merge_session($session);

    $final = $session['final']['modes']['female'];
    assert_equals(START_RATING, $final['ratings']['JEANNE']);
    assert_equals(START_RATING, $final['ratings']['ZOE']);
    assert_equals(0, $final['duels']['JEANNE']);
});

test('a Session with one ready Profile merges — the union of one set is itself', function () {
    $session = empty_session('K7M2QX9RTB');
    $session['profiles'][] = empty_profile('A');
    assert_true(!all_ready($session), 'nobody is ready yet');
    $session['profiles'][0]['ready'] = true;
    assert_true(all_ready($session));
});

test('an empty Session is not ready to merge, however few Profiles it has', function () {
    assert_true(!all_ready(empty_session('K7M2QX9RTB')));
});

test('all_ready is false while one of two Profiles is still swiping', function () {
    $session = empty_session('K7M2QX9RTB');
    $session['profiles'] = [empty_profile('A'), empty_profile('B')];
    $session['profiles'][0]['ready'] = true;
    assert_true(!all_ready($session));
    $session['profiles'][1]['ready'] = true;
    assert_true(all_ready($session));
});

summary();
