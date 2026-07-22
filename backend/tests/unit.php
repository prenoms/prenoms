<?php

/**
 * Unit tests for the pure parts of the API: id validation, the Elo port and the
 * merge. Run with `just test-backend`. No Composer, so no PHPUnit —
 * assertions are three helper functions and an exit code.
 */

declare(strict_types=1);

require __DIR__ . '/harness.php';
require __DIR__ . '/../lib/http.php';
require __DIR__ . '/../lib/ids.php';
require __DIR__ . '/../lib/bracket.php';
require __DIR__ . '/../lib/session.php';

/** A Session with two Profiles, both mid-swipe. The starting point for most rules. */
function two_profile_session(): array
{
    $session = empty_session('K7M2QX9RTB');
    $session['profiles'] = [empty_profile('A'), empty_profile('B')];
    return $session;
}

function merged_session(): array
{
    $session = two_profile_session();
    $session['profiles'][0]['modes']['female']['verdicts'] = ['JEANNE' => 'keep', 'ZOE' => 'keep'];
    $session['profiles'][0]['ready'] = true;
    $session['profiles'][1]['ready'] = true;
    return merge_session($session);
}

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

// --- The Bracket -----------------------------------------------------------

/**
 * Plays a whole tournament with a fixed opinion: the Prénom earlier in
 * `$preference` always wins. That is a real total order, so the podium it
 * produces is checkable against it — and it is the same fixture as the one in
 * `src/lib/bracket.test.ts`, which is how the two ports are kept honest.
 */
function play_out(array $bracket, array $preference): array
{
    for ($guard = 0; $guard < 10000 && !bracket_is_decided($bracket); $guard++) {
        $duels = pending_duels($bracket);
        if ($duels === []) {
            break;
        }
        [$a, $b] = $duels[0];
        $winner = array_search($a, $preference, true) < array_search($b, $preference, true) ? $a : $b;
        $bracket = resolve_bracket($bracket, $winner, $winner === $a ? $b : $a);
    }
    return $bracket;
}

test('the podium is the true Top 5 of a field that has a real order', function () {
    $preference = [];
    for ($i = 0; $i < 16; $i++) {
        $preference[] = "P$i";
    }
    $played = play_out(draw_bracket(array_reverse($preference)), $preference);

    assert_equals(TOP_PLACES, count($played['places']));
    assert_equals(array_slice($preference, 0, TOP_PLACES), $played['places']);
});

test('a field that is not a power of two gets byes, not phantom opponents', function () {
    $preference = ['A', 'B', 'C', 'D', 'E', 'F'];
    $played = play_out(draw_bracket($preference), $preference);

    assert_equals(['A', 'B', 'C', 'D', 'E'], $played['places']);
});

test('the Top 5 costs far fewer Duels than ranking the whole field', function () {
    $preference = [];
    for ($i = 0; $i < 32; $i++) {
        $preference[] = "P$i";
    }
    $played = play_out(draw_bracket($preference), $preference);

    assert_true($played['played'] >= 31, 'the first Place alone costs the whole tournament');
    assert_true($played['played'] < 60, "expected well under 60 Duels, played {$played['played']}");
});

test('a Duel the tree is not waiting on is refused rather than guessed at', function () {
    $bracket = draw_bracket(['A', 'B']);
    $played = resolve_bracket($bracket, 'A', 'B');

    assert_throws(Conflict::class, fn() => resolve_bracket($played, 'B', 'A'), 'terminé');
});

test('a stored Bracket whose tree does not match its draw is not trusted', function () {
    $clean = clean_bracket(['field' => ['A', 'B'], 'size' => 2, 'winners' => [null, 7], 'played' => 3]);

    assert_equals(['A', 'B'], $clean['field']);
    assert_equals(null, $clean['winners'][1], 'an index outside the draw is dropped');
    assert_equals(3, $clean['played']);
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
        assert_equals([], $profile['modes'][$mode]['bracket']['field']);
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

    $female = $session['final']['modes']['female']['bracket']['field'];
    sort($female);
    assert_equals(['JEANNE', 'ZOE'], $female);
    assert_equals(['PAUL'], $session['final']['modes']['male']['bracket']['field']);
});

test('the merge discards every prior Bracket and draws the Final Profile afresh', function () {
    $session = empty_session('K7M2QX9RTB');
    $a = empty_profile('A');
    $a['modes']['female']['verdicts'] = ['JEANNE' => 'keep', 'ZOE' => 'keep'];
    $a['modes']['female']['bracket'] = draw_bracket(['JEANNE', 'ZOE']);
    $a['modes']['female']['bracket'] = resolve_bracket($a['modes']['female']['bracket'], 'ZOE', 'JEANNE');
    $session['profiles'] = [$a];

    $session = merge_session($session);

    $final = $session['final']['modes']['female']['bracket'];
    assert_equals([], $final['places'], 'nobody carries a Place across the merge');
    assert_equals(0, $final['played'], 'and no Duel is counted twice');
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

// --- Operations ------------------------------------------------------------

test('a blank Nom is stored as null, so the views have one thing to test', function () {
    assert_equals(null, set_nom(empty_session('K7M2QX9RTB'), '')['nom']);
    assert_equals('Martin', set_nom(empty_session('K7M2QX9RTB'), 'Martin')['nom']);
});

test('the Nom outlives the merge — it is the Session\'s, not a Profile\'s', function () {
    assert_equals('Martin', set_nom(merged_session(), 'Martin')['nom']);
});

test('a third Profile is refused', function () {
    $session = two_profile_session();
    assert_throws(Conflict::class, fn() => add_profile($session, empty_profile('C')), 'déjà deux profils');
});

test('a Profile name already taken in this Session is refused, whatever its case', function () {
    $session = two_profile_session();
    $session['profiles'] = [$session['profiles'][0]];
    assert_throws(Conflict::class, fn() => add_profile($session, empty_profile('a')), 'déjà pris');
});

test('a merged Session cannot be joined', function () {
    assert_throws(Conflict::class, fn() => add_profile(merged_session(), empty_profile('C')), 'terminée');
});

test('declaring ready merges only once every Profile has', function () {
    $session = two_profile_session();
    $pids = array_column($session['profiles'], 'id');

    $session = declare_ready($session, $pids[0]);
    assert_true($session['profiles'][0]['ready'], 'the Profile should be ready');
    assert_true(!has_merged($session), 'one ready Profile out of two must not merge');

    $session = declare_ready($session, $pids[1]);
    assert_true(has_merged($session), 'the merge happens in the same call as the last ready');
});

test('declaring ready for a Profile that is not in the Session is a 404', function () {
    assert_throws(NotFound::class, fn() => declare_ready(two_profile_session(), 'NOSUCHPRO'));
});

test('a Verdict is recorded, and clearing it returns the Prénom to the Deck unjudged', function () {
    $session = two_profile_session();
    $pid = $session['profiles'][0]['id'];

    $session = record_verdict($session, $pid, 'female', 'JEANNE', 'keep');
    assert_equals('keep', $session['profiles'][0]['modes']['female']['verdicts']['JEANNE']);

    $session = record_verdict($session, $pid, 'female', 'JEANNE', null);
    assert_equals([], $session['profiles'][0]['modes']['female']['verdicts']);
});

test('a Verdict in one Mode says nothing about the other', function () {
    $session = two_profile_session();
    $pid = $session['profiles'][0]['id'];
    $session = record_verdict($session, $pid, 'female', 'CAMILLE', 'reject');
    assert_equals([], $session['profiles'][0]['modes']['male']['verdicts']);
});

test('a Verdict from a Profile that has declared itself ready is refused', function () {
    $session = two_profile_session();
    $pid = $session['profiles'][0]['id'];
    $session = declare_ready($session, $pid);
    assert_throws(
        Conflict::class,
        fn() => record_verdict($session, $pid, 'female', 'JEANNE', 'keep'),
        'déjà déclaré avoir terminé',
    );
});

test('the other Profile keeps swiping while one is ready', function () {
    $session = two_profile_session();
    $session = declare_ready($session, $session['profiles'][0]['id']);
    $session = record_verdict($session, $session['profiles'][1]['id'], 'female', 'JEANNE', 'keep');
    assert_equals('keep', $session['profiles'][1]['modes']['female']['verdicts']['JEANNE']);
});

test('no Verdict and no Bracket survives the merge — the tri is over', function () {
    $session = merged_session();
    $pid = $session['profiles'][0]['id'];
    assert_throws(
        Conflict::class,
        fn() => record_verdict($session, $pid, 'female', 'JEANNE', 'keep'),
        'fusionné',
    );
    assert_throws(
        Conflict::class,
        fn() => replace_bracket($session, $pid, 'female', draw_bracket(['JEANNE'])),
        'fusionné',
    );
});

test('a per-Profile Bracket replaces the Mode whole, and only that Mode', function () {
    $session = two_profile_session();
    $pid = $session['profiles'][0]['id'];
    $session = replace_bracket($session, $pid, 'female', draw_bracket(['JEANNE', 'ZOE']));

    $field = $session['profiles'][0]['modes']['female']['bracket']['field'];
    sort($field);
    assert_equals(['JEANNE', 'ZOE'], $field);
    assert_equals([], $session['profiles'][0]['modes']['male']['bracket']['field']);
    assert_equals([], $session['profiles'][1]['modes']['female']['bracket']['field']);
});

test('a Final Profile Duel is applied to the shared tree, not to a score', function () {
    $session = record_final_duel(merged_session(), 'female', 'JEANNE', 'ZOE');
    $final = $session['final']['modes']['female']['bracket'];

    assert_equals(1, $final['played']);
    // A field of two fills both Places: the winner, then the other unopposed.
    assert_equals(['JEANNE', 'ZOE'], $final['places']);
});

test('a Duel before the merge is refused — there is no shared list yet', function () {
    assert_throws(
        Conflict::class,
        fn() => record_final_duel(two_profile_session(), 'female', 'JEANNE', 'ZOE'),
        'pas encore fusionné',
    );
});

test('a Prénom outside the Final Profile cannot duel', function () {
    assert_throws(
        Conflict::class,
        fn() => record_final_duel(merged_session(), 'female', 'JEANNE', 'PAUL'),
        'plus celui',
    );
});

test('a Prénom cannot duel itself', function () {
    assert_throws(
        BadRequest::class,
        fn() => record_final_duel(merged_session(), 'female', 'JEANNE', 'JEANNE'),
        'se battre contre lui-même',
    );
});

summary();
