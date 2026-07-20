import test from "node:test";
import assert from "node:assert/strict";
import { idFromInput, parseRoute, sessionPath } from "./route";

test("the homepage is every path that is not a Session", () => {
  assert.deepEqual(parseRoute("/"), { name: "home" });
  assert.deepEqual(parseRoute("/s"), { name: "home" });
  assert.deepEqual(parseRoute("/s/"), { name: "home" });
  assert.deepEqual(parseRoute("/quelque/chose"), { name: "home" });
});

test("a Session id lives in the path", () => {
  assert.deepEqual(parseRoute("/s/K7M2QX9RTB"), { name: "session", id: "K7M2QX9RTB" });
  assert.deepEqual(parseRoute("/s/K7M2QX9RTB/"), { name: "session", id: "K7M2QX9RTB" });
});

test("ids are read case-insensitively and shown uppercase", () => {
  assert.deepEqual(parseRoute("/s/k7m2qx9rtb"), { name: "session", id: "K7M2QX9RTB" });
});

test("an id outside the alphabet is not a Session", () => {
  // I, L, O and U are not Crockford base32 — mistaking one for a Session would
  // send the join screen after a Session that cannot exist.
  assert.deepEqual(parseRoute("/s/K7M2QX9RTI"), { name: "home" });
  assert.deepEqual(parseRoute("/s/K7M2QX9RT"), { name: "home" });
  assert.deepEqual(parseRoute("/s/K7M2QX9RTBB"), { name: "home" });
});

test("the path is where a Session id goes", () => {
  assert.equal(sessionPath("K7M2QX9RTB"), "/s/K7M2QX9RTB");
});

test("the join box takes a bare id, typed however", () => {
  assert.equal(idFromInput("K7M2QX9RTB"), "K7M2QX9RTB");
  assert.equal(idFromInput("  k7m2qx9rtb "), "K7M2QX9RTB");
});

test("the join box takes the whole link, because that is what gets pasted", () => {
  assert.equal(idFromInput("https://quelprenom.xyz/s/K7M2QX9RTB"), "K7M2QX9RTB");
  assert.equal(idFromInput("https://quelprenom.xyz/s/K7M2QX9RTB#/swipe"), "K7M2QX9RTB");
  assert.equal(idFromInput("quelprenom.xyz/s/k7m2qx9rtb"), "K7M2QX9RTB");
});

test("anything without an id is refused rather than guessed at", () => {
  assert.equal(idFromInput(""), null);
  assert.equal(idFromInput("https://quelprenom.xyz/"), null);
  assert.equal(idFromInput("K7M2QX9RT"), null);
});
