import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, request } from "./api";

function respond(status: number, body: unknown): typeof fetch {
  return (async () =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

test("returns the decoded body", async () => {
  const session = await request("/api/sessions/K7M2QX9RTB", {}, respond(200, { id: "K7M2QX9RTB" }));
  assert.deepEqual(session, { id: "K7M2QX9RTB" });
});

test("a 204 carries no body", async () => {
  const nothing = await request(
    "/api/sessions/K7M2QX9RTB/profiles/P/verdicts/female/Jeanne",
    { method: "PUT" },
    (async () => new Response(null, { status: 204 })) as unknown as typeof fetch,
  );
  assert.equal(nothing, null);
});

test("the server's French message is what reaches the user", async () => {
  const failed = await request("/api/sessions/X", {}, respond(409, {
    error: "conflict",
    message: "Cette session a déjà deux profils.",
  })).catch((e: unknown) => e);

  assert.ok(failed instanceof ApiError);
  assert.equal(failed.code, "conflict");
  assert.equal(failed.message, "Cette session a déjà deux profils.");
  assert.equal(failed.retryable, false);
});

test("a 500 is retryable — the write may still land", async () => {
  const failed = await request("/api/sessions/X", {}, respond(500, {
    error: "server_error",
    message: "Erreur du serveur. Réessayez dans un instant.",
  })).catch((e: unknown) => e);

  assert.ok(failed instanceof ApiError);
  assert.equal(failed.retryable, true);
});

test("a dead connection is retryable and speaks French", async () => {
  const failed = await request("/api/sessions/X", {}, (() =>
    Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch).catch(
    (e: unknown) => e,
  );

  assert.ok(failed instanceof ApiError);
  assert.equal(failed.code, "network");
  assert.equal(failed.retryable, true);
  assert.match(failed.message, /Connexion/);
});

test("a proxy that answers with HTML is a server error, not a crash", async () => {
  const failed = await request("/api/sessions/X", {}, (async () =>
    new Response("<html>502</html>", { status: 502 })) as unknown as typeof fetch).catch(
    (e: unknown) => e,
  );

  assert.ok(failed instanceof ApiError);
  assert.equal(failed.code, "server_error");
  assert.equal(failed.retryable, true);
});
