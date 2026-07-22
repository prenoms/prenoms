/**
 * Smoke test for the deployed shape: the app, the Prénom List it fetches at
 * runtime, and the API behind the /api rewrite, all from one origin.
 *
 * This is what `just test-backend` cannot cover — that one talks to PHP
 * directly, and every failure here is a failure of the routing or the build
 * base rather than of the code. Run against a staged tree by
 * `just e2e`, and against the real site with `just smoke-prod` after a deploy.
 *
 * It creates a real Session and leaves it behind; the twelve-month sweep
 * collects it.
 */
const O = process.env.ORIGIN ?? "http://127.0.0.1:8123";
const j = (b) => ({ headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
let bad = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) bad++;
};

// The shell must answer on the root and on a Session path that is not a real file.
// The Session id is in the path, so a cold visit to a shared link must reach
// the shell rather than a 404 — that link is the only key there is.
for (const p of ["/", "/s/K7M2QX9RTB", "/s/k7m2qx9rtb"]) {
  const r = await fetch(O + p);
  const html = await r.text();
  check(`SPA fallback ${p}`, r.ok && html.includes('<div id="app">'));
}

// Assets must be referenced at the root, not under /prenoms/.
const shell = await (await fetch(O + "/")).text();
const src = shell.match(/src="([^"]+\.js)"/)?.[1] ?? "";
check("asset path is root-relative", src.startsWith("/assets/"), src);
check("asset resolves", (await fetch(O + src)).ok);

// The Prénom List is fetched at runtime; a 404 here is a blank app.
const bundle = await (await fetch(O + src)).text();
const csv = bundle.match(/["'`](\/assets\/prenoms[^"'`]*\.csv)["'`]/)?.[1];
check("Prénom List URL found in bundle", Boolean(csv), csv ?? "");
if (csv) {
  const r = await fetch(O + csv);
  check("Prénom List resolves", r.ok && (await r.text()).startsWith("firstname"));
}

// The API, through the same rewrite the .htaccess installs.
const B = `${O}/api/sessions`;
const create = await fetch(B, { method: "POST" });
const { id } = await create.json();
check("POST /api/sessions", create.status === 201 && /^[0-9A-HJKMNP-TV-Z]{10}$/.test(id), id);

const { id: pid } = await (await fetch(`${B}/${id}/profiles`, { method: "POST", ...j({ name: "Alex" }) })).json();
check("POST profile", Boolean(pid), pid);

const put = await fetch(`${B}/${id}/profiles/${pid}/verdicts/female/Jeanne`, { method: "PUT", ...j({ verdict: "keep" }) });
check("PUT verdict through /api rewrite", put.status === 204);

const prof = await (await fetch(`${B}/${id}/profiles/${pid}`)).json();
check("verdict round-trips", prof.modes.female.verdicts.Jeanne === "keep");

const ready = await fetch(`${B}/${id}/profiles/${pid}/ready`, { method: "POST" });
const merged = await ready.json();
check(
  "ready merges a lone Profile and draws its Bracket",
  merged.merged === true && merged.final.modes.female.bracket.field.join() === "Jeanne",
);

// A field of one has nobody to duel: the Place is awarded unopposed, which is
// also the only Final Profile state this smoke can reach without playing along.
const duel = await fetch(`${B}/${id}/final/duels`, {
  method: "POST",
  ...j({ mode: "female", winner: "Jeanne", loser: "Zoe" }),
});
check("a Duel the tree is not waiting on is a JSON 409", duel.status === 409);

const nf = await fetch(`${B}/ZZZZZZZZZZ`);
check("unknown Session is a JSON 404", nf.status === 404 && (await nf.json()).error === "not_found");

process.exit(bad === 0 ? 0 : 1);
