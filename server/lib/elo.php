<?php

/**
 * Elo for the Final Profile. A deliberate port of `src/lib/duel.ts`: both
 * partners duel one shared Rating, so the adjustment is computed here, inside
 * the lock, from a `{winner, loser}` fact — a client-side computation would
 * drop a Duel whenever both people picked at the same moment (ADR 0003).
 *
 * The cost is that the maths exists twice. It is contained by ownership: this
 * file owns Final Profile Ratings and nothing else, `duel.ts` owns the
 * per-Profile phase and nothing else. Neither reads the other's numbers.
 */

declare(strict_types=1);

const START_RATING = 1000.0;
const K = 32.0;

function expected_score(float $rating, float $against): float
{
    return 1 / (1 + 10 ** (($against - $rating) / 400));
}

/** Resolves one Duel. Nothing is eliminated — both Ratings simply move. */
function adjust(float $winner, float $loser): array
{
    $shift = K * (1 - expected_score($winner, $loser));
    return ['winner' => $winner + $shift, 'loser' => $loser - $shift];
}
