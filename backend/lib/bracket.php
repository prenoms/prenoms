<?php

/**
 * The Bracket for the Final Profile. A deliberate port of `src/lib/bracket.ts`:
 * both parents play into one shared tournament, so a Duel is resolved here,
 * inside the lock, from a `{winner, loser}` fact — a client-side resolution
 * would drop a Duel whenever both people picked at the same moment (ADR 0003).
 *
 * The cost is that the rules exist twice. It is contained by ownership: this
 * file owns the Final Profile's Bracket and nothing else, `bracket.ts` owns the
 * per-Profile phase and nothing else. Neither reads the other's state.
 *
 * Read `bracket.ts` for why lifting the winner out and replaying only its path
 * gives an honest second Place for one round of Duels rather than a whole
 * second tournament.
 */

declare(strict_types=1);

require_once __DIR__ . '/http.php';

/** How many Places the podium holds. Beyond it, the field is unranked. */
const TOP_PLACES = 5;

function empty_bracket(): array
{
    return ['field' => [], 'size' => 1, 'winners' => [null], 'gone' => [], 'places' => [], 'played' => 0];
}

function power_of_two_at_least(int $count): int
{
    $size = 1;
    while ($size < $count) {
        $size *= 2;
    }
    return $size;
}

/**
 * Draws a fresh Bracket. The field is shuffled rather than left in Shortlist
 * order: the draw decides who meets whom, and an alphabetical draw would put
 * the two Prénoms someone happened to star first against each other in round
 * one for no reason at all.
 */
function draw_bracket(array $shortlist): array
{
    $field = array_values($shortlist);
    shuffle($field);
    $size = power_of_two_at_least(max(1, count($field)));
    return [
        'field' => $field,
        'size' => $size,
        'winners' => array_fill(0, $size, null),
        'gone' => [],
        'places' => [],
        'played' => 0,
    ];
}

/** How many Places this field can actually fill. A field of three has no fifth. */
function places_wanted(array $bracket): int
{
    return min(TOP_PLACES, count($bracket['field']));
}

function bracket_is_decided(array $bracket): bool
{
    return count($bracket['places']) >= places_wanted($bracket);
}

/**
 * Who came through `$node`: the index of a Prénom, `'empty'` when nobody is
 * left on that side, or `'pending'` while the Duel is unplayed. A node with
 * only one live side needs no Duel at all — a bye is not a question worth
 * asking.
 */
function holder_of(array $bracket, int $node): int|string
{
    if ($node >= $bracket['size']) {
        $index = $node - $bracket['size'];
        if ($index >= count($bracket['field']) || in_array($index, $bracket['gone'], true)) {
            return 'empty';
        }
        return $index;
    }
    if ($bracket['winners'][$node] !== null) {
        return $bracket['winners'][$node];
    }
    $left = holder_of($bracket, $node * 2);
    $right = holder_of($bracket, $node * 2 + 1);
    if ($left === 'pending' || $right === 'pending') {
        return 'pending';
    }
    if ($left === 'empty') {
        return $right;
    }
    if ($right === 'empty') {
        return $left;
    }
    return 'pending';
}

/** Forgets every Duel one Prénom won on its way up. Called when it leaves the tree. */
function clear_path(array $bracket, int $index): array
{
    for ($node = ($bracket['size'] + $index) >> 1; $node >= 1; $node >>= 1) {
        $bracket['winners'][$node] = null;
    }
    return $bracket;
}

/**
 * Awards every Place the tree can now award, and lifts each winner out so the
 * next round of place-offs can find the one behind it. Idempotent.
 */
function award_places(array $bracket): array
{
    while (count($bracket['places']) < places_wanted($bracket)) {
        $top = holder_of($bracket, 1);
        if (!is_int($top)) {
            return $bracket;
        }
        $bracket['places'][] = $bracket['field'][$top];
        $bracket['gone'][] = $top;
        $bracket = clear_path($bracket, $top);
    }
    return $bracket;
}

/**
 * Every Duel the tree is waiting on, deepest first so a round is finished
 * before the next is started. There are many of them early on, which is what
 * lets two parents play at once without being handed the same question.
 */
function pending_duels(array $bracket): array
{
    // Awarding the last Place clears that winner's path, which leaves nodes the
    // tree could still decide and no reason on earth to ask about them.
    if (bracket_is_decided($bracket)) {
        return [];
    }
    $duels = [];
    for ($node = $bracket['size'] - 1; $node >= 1; $node--) {
        if ($bracket['winners'][$node] !== null) {
            continue;
        }
        $left = holder_of($bracket, $node * 2);
        $right = holder_of($bracket, $node * 2 + 1);
        if (!is_int($left) || !is_int($right)) {
            continue;
        }
        $duels[] = [$bracket['field'][$left], $bracket['field'][$right]];
    }
    return $duels;
}

/**
 * Resolves one Duel by the fact alone, so a parent is always answering the
 * question they were shown. A Duel matching nothing the tree is waiting on is
 * stale — the other parent got there first — and is refused rather than guessed
 * at.
 */
function resolve_bracket(array $bracket, string $winner, string $loser): array
{
    if (bracket_is_decided($bracket)) {
        throw new Conflict("Ce tournoi est terminé.");
    }
    for ($node = $bracket['size'] - 1; $node >= 1; $node--) {
        if ($bracket['winners'][$node] !== null) {
            continue;
        }
        $left = holder_of($bracket, $node * 2);
        $right = holder_of($bracket, $node * 2 + 1);
        if (!is_int($left) || !is_int($right)) {
            continue;
        }
        $pair = [$bracket['field'][$left], $bracket['field'][$right]];
        if (!in_array($winner, $pair, true) || !in_array($loser, $pair, true)) {
            continue;
        }
        $bracket['winners'][$node] = $bracket['field'][$left] === $winner ? $left : $right;
        $bracket['played']++;
        return award_places($bracket);
    }
    throw new Conflict("Ce duel n'est plus celui qui vous était proposé.");
}

/**
 * Whatever is on disk, forced into the shape above. A Bracket is the one stored
 * value with an internal invariant — `winners` holds indexes into `field`, and
 * the tree is sized to it — so anything that fails the check is dropped rather
 * than trusted. A dropped Duel costs one question; a trusted bad index would
 * put a Prénom on the podium that never won anything.
 */
function clean_bracket(mixed $raw): array
{
    if (!is_array($raw)) {
        return empty_bracket();
    }
    $field = [];
    foreach ($raw['field'] ?? [] as $prenom) {
        // A Prénom twice in one draw would be two leaves that cannot be told apart.
        if (is_string($prenom) && !in_array($prenom, $field, true)) {
            $field[] = $prenom;
        }
    }
    $bracket = draw_bracket([]);
    $bracket['field'] = $field;
    $bracket['size'] = power_of_two_at_least(max(1, count($field)));
    $bracket['winners'] = array_fill(0, $bracket['size'], null);

    foreach ($raw['gone'] ?? [] as $index) {
        if (is_int($index) && $index >= 0 && $index < count($field) && !in_array($index, $bracket['gone'], true)) {
            $bracket['gone'][] = $index;
        }
    }
    foreach ($raw['winners'] ?? [] as $node => $index) {
        if (!is_int($node) || $node < 1 || $node >= $bracket['size']) {
            continue;
        }
        if (!is_int($index) || $index < 0 || $index >= count($field)) {
            continue;
        }
        // A node may only be held by a Prénom drawn beneath it: walk the leaf up.
        $under = false;
        for ($n = $bracket['size'] + $index; $n >= 1; $n >>= 1) {
            if ($n === $node) {
                $under = true;
                break;
            }
        }
        if ($under) {
            $bracket['winners'][$node] = $index;
        }
    }
    // A Prénom with a Place is out of the running by definition, so the podium
    // is what decides `gone` for it rather than the two being trusted separately.
    foreach ($raw['places'] ?? [] as $prenom) {
        if (!is_string($prenom) || in_array($prenom, $bracket['places'], true)) {
            continue;
        }
        $index = array_search($prenom, $field, true);
        if ($index === false) {
            continue;
        }
        $bracket['places'][] = $prenom;
        if (!in_array($index, $bracket['gone'], true)) {
            $bracket['gone'][] = $index;
        }
    }
    if (isset($raw['played']) && is_int($raw['played']) && $raw['played'] >= 0) {
        $bracket['played'] = $raw['played'];
    }
    return $bracket;
}

/** Casts the lists so an empty one encodes as `[]` and `winners` stays a list. */
function bracket_view(array $bracket): array
{
    return [
        'field' => array_values($bracket['field']),
        'size' => $bracket['size'],
        'winners' => array_values($bracket['winners']),
        'gone' => array_values($bracket['gone']),
        'places' => array_values($bracket['places']),
        'played' => $bracket['played'],
    ];
}
