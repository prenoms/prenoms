import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api";
import { Outbox } from "./outbox";

/** Backoff is injected so the tests settle immediately instead of waiting seconds. */
function instant() {
  const waited: number[] = [];
  return {
    waited,
    delay: (ms: number) => {
      waited.push(ms);
      return Promise.resolve();
    },
  };
}

test("sends a scheduled write", async () => {
  const sent: string[] = [];
  const outbox = new Outbox(instant());
  outbox.schedule("verdict:female:Jeanne", async () => {
    sent.push("keep");
  });
  await outbox.settled();
  assert.deepEqual(sent, ["keep"]);
  assert.equal(outbox.pending, 0);
});

test("a re-swipe of the same Prénom replaces the queued write rather than queueing behind it", async () => {
  const sent: string[] = [];
  let release = () => {};
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const outbox = new Outbox(instant());

  // The first write is in flight, so the next two can only queue.
  outbox.schedule("verdict:female:Jeanne", async () => {
    await blocked;
    sent.push("keep");
  });
  outbox.schedule("verdict:female:Jeanne", async () => {
    sent.push("reject");
  });
  outbox.schedule("verdict:female:Jeanne", async () => {
    sent.push("cleared");
  });

  release();
  await outbox.settled();
  // The middle Verdict never goes out: the server only needs the last one.
  assert.deepEqual(sent, ["keep", "cleared"]);
});

test("retries a failed write with a growing backoff until it lands", async () => {
  const clock = instant();
  const outbox = new Outbox(clock);
  let attempts = 0;

  outbox.schedule("ratings:male", async () => {
    attempts += 1;
    if (attempts < 4) throw new ApiError("server_error", "Erreur du serveur.");
  });

  await outbox.settled();
  assert.equal(attempts, 4);
  assert.deepEqual(clock.waited, [500, 1000, 2000]);
});

test("a broken connection raises the banner, and landing the write lowers it", async () => {
  const outbox = new Outbox(instant());
  const seen: boolean[] = [];
  outbox.onChange(() => seen.push(outbox.failing));

  let attempts = 0;
  outbox.schedule("verdict:male:Louis", async () => {
    attempts += 1;
    if (attempts === 1) throw new ApiError("network", "Connexion perdue.");
  });

  await outbox.settled();
  assert.ok(seen.includes(true), "the banner went up while the write was failing");
  assert.equal(outbox.failing, false);
});

test("a refusal the server will never accept is dropped, not retried forever", async () => {
  const outbox = new Outbox(instant());
  const refused: string[] = [];
  outbox.onError((error) => refused.push(error.message));

  let attempts = 0;
  outbox.schedule("verdict:male:Louis", async () => {
    attempts += 1;
    throw new ApiError("conflict", "Ce profil a déjà déclaré avoir terminé.");
  });

  await outbox.settled();
  assert.equal(attempts, 1);
  assert.deepEqual(refused, ["Ce profil a déjà déclaré avoir terminé."]);
  // A refusal is not a lost swipe, so it must not leave the banner up.
  assert.equal(outbox.failing, false);
});

test("keys advance independently — a stuck Mode does not hold up a Verdict", async () => {
  const clock = instant();
  const outbox = new Outbox(clock);
  const sent: string[] = [];
  let ratingAttempts = 0;

  outbox.schedule("ratings:female", async () => {
    ratingAttempts += 1;
    if (ratingAttempts < 3) throw new ApiError("network", "Connexion perdue.");
    sent.push("ratings");
  });
  outbox.schedule("verdict:female:Zoe", async () => {
    sent.push("verdict");
  });

  await outbox.settled();
  assert.equal(sent[0], "verdict");
  assert.equal(sent.length, 2);
});

test("a swipe made during the backoff supersedes the one being retried", async () => {
  let resume = () => {};
  const outbox = new Outbox({ delay: () => new Promise<void>((r) => (resume = r)) });
  const sent: string[] = [];

  outbox.schedule("verdict:female:Jeanne", async () => {
    throw new ApiError("network", "Connexion perdue.");
  });
  // Let the first attempt fail and settle into its backoff.
  await Promise.resolve();
  await Promise.resolve();

  outbox.schedule("verdict:female:Jeanne", async () => {
    sent.push("reject");
  });
  resume();

  await outbox.settled();
  // The stale keep is never retried: the Verdict the user last chose is the truth.
  assert.deepEqual(sent, ["reject"]);
});

test("the backoff is capped so a long outage still retries at a sane interval", () => {
  const outbox = new Outbox();
  assert.equal(outbox.backoffFor(1), 500);
  assert.equal(outbox.backoffFor(6), 16000);
  assert.equal(outbox.backoffFor(20), 30000);
});
