import test from "node:test";
import assert from "node:assert/strict";
import {
  TOP_PLACES,
  drawBracket,
  duelAt,
  duelsLeft,
  isDecided,
  needsRedraw,
  pendingDuels,
  placesWanted,
  resolveBracket,
  unranked,
  withdrawUnkept,
  type BracketState,
} from "./bracket";

/** A draw in the order given, so a test can name the bracket it means. */
function drawInOrder(field: string[]): BracketState {
  return drawBracket(field, () => 0.999999);
}

/**
 * Plays a whole tournament with a fixed opinion: the Prénom earlier in
 * `preference` always wins. That is a real total order, so the podium it
 * produces is checkable against it.
 */
function playOut(bracket: BracketState, preference: string[]): BracketState {
  let current = bracket;
  for (let guard = 0; guard < 10_000 && !isDecided(current); guard++) {
    const duel = duelAt(current, 0);
    if (duel === null) break;
    const [a, b] = duel;
    const winner = preference.indexOf(a) < preference.indexOf(b) ? a : b;
    const next = resolveBracket(current, winner, winner === a ? b : a);
    assert.notEqual(next, null, "a Duel the tree offered must be one it accepts");
    current = next!;
  }
  return current;
}

test("the podium is the true Top 5 of a field that has a real order", () => {
  const preference = Array.from({ length: 16 }, (_, i) => `P${i}`);
  const shuffled = [...preference].reverse();
  const played = playOut(drawInOrder(shuffled), preference);

  assert.equal(played.places.length, TOP_PLACES);
  assert.deepEqual(played.places, preference.slice(0, TOP_PLACES));
});

test("a field that is not a power of two gets byes, not phantom opponents", () => {
  const preference = ["A", "B", "C", "D", "E", "F"];
  const played = playOut(drawInOrder(preference), preference);

  assert.deepEqual(played.places, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(unranked(played), ["F"], "the sixth is left where it fell");
});

test("a field smaller than the podium fills every Place it can and stops", () => {
  const preference = ["A", "B", "C"];
  const played = playOut(drawInOrder(preference), preference);

  assert.equal(placesWanted(played), 3);
  assert.equal(isDecided(played), true);
  assert.deepEqual(played.places, ["A", "B", "C"]);
});

test("the Top 5 costs far fewer Duels than ranking the whole field", () => {
  const preference = Array.from({ length: 32 }, (_, i) => `P${i}`);
  const played = playOut(drawInOrder(preference), preference);

  // 31 to find the winner, then one path replayed per further Place.
  assert.ok(played.played < 60, `expected well under 60 Duels, played ${played.played}`);
  assert.ok(played.played >= 31, "the first Place alone costs the whole tournament");
});

test("the Duels still owed only ever fall", () => {
  const preference = Array.from({ length: 16 }, (_, i) => `P${i}`);
  let current = drawInOrder([...preference].reverse());
  let previous = duelsLeft(current);

  while (!isDecided(current)) {
    const duel = duelAt(current, 0);
    if (duel === null) break;
    const [a, b] = duel;
    const winner = preference.indexOf(a) < preference.indexOf(b) ? a : b;
    current = resolveBracket(current, winner, winner === a ? b : a)!;
    const left = duelsLeft(current);
    assert.ok(left <= previous, `${left} owed after ${previous}`);
    previous = left;
  }
  assert.equal(duelsLeft(current), 0);
});

test("two slots are handed different Duels while the tree has more than one", () => {
  const drawn = drawInOrder(["A", "B", "C", "D"]);
  assert.equal(pendingDuels(drawn).length, 2, "both first-round matches at once");
  assert.notDeepEqual(duelAt(drawn, 0), duelAt(drawn, 1));

  // Down to the final there is only one question, and both slots get it — the
  // race is refused cleanly rather than shown as an empty screen.
  const semi = resolveBracket(resolveBracket(drawn, "A", "B")!, "C", "D")!;
  assert.equal(pendingDuels(semi).length, 1);
  assert.deepEqual(duelAt(semi, 1), duelAt(semi, 0));
});

test("a Duel the tree is not waiting on is refused", () => {
  const drawn = drawInOrder(["A", "B", "C", "D"]);
  assert.equal(resolveBracket(drawn, "A", "C"), null, "they have not met");

  const played = resolveBracket(drawn, "A", "B")!;
  assert.equal(resolveBracket(played, "B", "A"), null, "that Duel is over");
});

test("withdrawing a Prénom advances its opponent without a Duel", () => {
  const drawn = drawInOrder(["A", "B", "C", "D"]);
  const after = withdrawUnkept(drawn, ["B", "C", "D"])!;

  assert.equal(after.field.length, 4, "the draw is never spliced");
  const duels = pendingDuels(after).map((d) => [...d].sort().join("-"));
  assert.deepEqual(duels, ["C-D"], "A's match is a bye now, C v D still stands");
});

test("withdrawing the winner takes its Place back", () => {
  const preference = ["A", "B", "C", "D"];
  const played = playOut(drawInOrder(preference), preference);
  assert.equal(played.places[0], "A");

  const after = withdrawUnkept(played, ["B", "C", "D"])!;
  assert.ok(!after.places.includes("A"), "a Prénom nobody keeps cannot hold a Place");
});

test("a Shortlist that already matches the draw changes nothing", () => {
  const drawn = drawInOrder(["A", "B", "C"]);
  assert.equal(withdrawUnkept(drawn, ["A", "B", "C"]), null);
  assert.equal(needsRedraw(drawn, ["A", "B", "C"]), false);
  assert.equal(needsRedraw(drawn, ["A", "B", "C", "D"]), true);
});
