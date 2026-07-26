import test from "node:test";
import assert from "node:assert/strict";

import type { Prenom } from "./domain";
import { activeCount, bounds, defaultFilter, matches, measure } from "./prenom-filter";

const jean: Prenom = { prenom: "Jean", sexProfile: { male: true, female: false } };
const jeanBaptiste: Prenom = { prenom: "Jean-Baptiste", sexProfile: { male: true, female: false } };
const camille: Prenom = { prenom: "Camille", sexProfile: { male: true, female: true } };

test("un Filtre neuf laisse tout passer", () => {
  const filter = defaultFilter();
  for (const p of [jean, jeanBaptiste, camille]) {
    assert.ok(matches(measure(p), filter), p.prenom);
  }
  assert.equal(activeCount(filter), 0);
});

test("les lettres comptent le trait d'union, comme à l'écran", () => {
  assert.equal(measure(jeanBaptiste).letters, 13);
  assert.equal(measure(jean).letters, 4);
});

test("les bornes de lettres sont inclusives", () => {
  const filter = { ...defaultFilter(), letters: { min: 4, max: 7 } };
  assert.ok(matches(measure(jean), filter));
  assert.ok(matches(measure(camille), filter));
  assert.ok(!matches(measure(jeanBaptiste), filter));
});

test("une borne nulle ne borne rien", () => {
  const filter = { ...defaultFilter(), letters: { min: null, max: 7 } };
  assert.ok(matches(measure(jean), filter));
  assert.ok(!matches(measure(jeanBaptiste), filter));
});

test("les syllabes se bornent comme les lettres", () => {
  const filter = { ...defaultFilter(), syllables: { min: 2, max: null } };
  assert.ok(!matches(measure(jean), filter));
  assert.ok(matches(measure(camille), filter));
});

test("cacher les Prénoms composés ne cache pas Jean", () => {
  const filter = { ...defaultFilter(), showComposed: false };
  assert.ok(matches(measure(jean), filter));
  assert.ok(!matches(measure(jeanBaptiste), filter));
});

test("cacher les Prénoms mixtes ne regarde que le Sex Profile", () => {
  const filter = { ...defaultFilter(), showMixed: false };
  assert.ok(!matches(measure(camille), filter));
  assert.ok(matches(measure(jean), filter));
});

test("chaque critère réglé compte une fois dans le badge", () => {
  assert.equal(activeCount({ ...defaultFilter(), letters: { min: 3, max: null } }), 1);
  assert.equal(activeCount({ ...defaultFilter(), letters: { min: 3, max: 9 } }), 1);
  assert.equal(
    activeCount({
      letters: { min: 3, max: 9 },
      syllables: { min: null, max: 2 },
      showComposed: false,
      showMixed: false,
    }),
    4,
  );
});

test("les extrémités des curseurs viennent du Deck en jeu", () => {
  const measured = [jean, jeanBaptiste, camille].map(measure);
  assert.deepEqual(bounds(measured).letters, { min: 4, max: 13 });
  assert.deepEqual(bounds(measured).syllables, { min: 1, max: 3 });
});

test("un Deck vide donne des extrémités utilisables", () => {
  assert.deepEqual(bounds([]).letters, { min: 1, max: 1 });
});
