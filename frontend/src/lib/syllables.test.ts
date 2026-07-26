import test from "node:test";
import assert from "node:assert/strict";

import { countSyllables } from "./syllables";

test("une voyelle seule est une syllabe", () => {
  assert.equal(countSyllables("Emma"), 2);
  assert.equal(countSyllables("Adam"), 2);
  assert.equal(countSyllables("Gabriel"), 3);
});

test("les groupes de voyelles français ne comptent que pour une", () => {
  assert.equal(countSyllables("Paul"), 1);
  assert.equal(countSyllables("Marie"), 2);
  assert.equal(countSyllables("Sophie"), 2);
  assert.equal(countSyllables("Julien"), 2);
});

test("un ea nasalisé est une syllabe, ailleurs il se scinde", () => {
  assert.equal(countSyllables("Jean"), 1);
  assert.equal(countSyllables("Lea"), 2);
});

test("les voyelles hors liste se scindent", () => {
  assert.equal(countSyllables("Leo"), 2);
  assert.equal(countSyllables("Mia"), 2);
  assert.equal(countSyllables("Noah"), 2);
  assert.equal(countSyllables("Raphael"), 3);
});

test("le e final muet ne compte pas après une consonne", () => {
  assert.equal(countSyllables("Jeanne"), 1);
  assert.equal(countSyllables("Alice"), 2);
  assert.equal(countSyllables("Camille"), 2);
});

test("le e final compte après une voyelle, l'accent ayant été retiré", () => {
  assert.equal(countSyllables("Zoe"), 2);
  assert.equal(countSyllables("Chloe"), 2);
});

test("chaque partie d'un Prénom composé est comptée", () => {
  assert.equal(countSyllables("Jean-Baptiste"), 3);
  assert.equal(countSyllables("Marie-Lou"), 3);
  assert.equal(countSyllables("Anne-Sophie"), 3);
});

test("le u de qu ne s'entend pas", () => {
  assert.equal(countSyllables("Dominique"), 3);
  assert.equal(countSyllables("Angelique"), 3);
});

test("une voyelle doublée s'écrit deux fois et se dit une", () => {
  assert.equal(countSyllables("Aaron"), 2);
  assert.equal(countSyllables("Isaac"), 2);
  assert.equal(countSyllables("Aimee"), 2);
});

test("un Prénom accentué compte comme sa forme repliée", () => {
  assert.equal(countSyllables("Zoé"), countSyllables("Zoe"));
});

test("aucun Prénom ne tombe à zéro syllabe", () => {
  for (const prenom of ["Bo", "Kim", "Yan", "Ilyes", "Mohamed-Amine", "Fatima-Zahra"]) {
    assert.ok(countSyllables(prenom) >= 1, prenom);
  }
});
