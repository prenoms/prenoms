# No backend — the app is static and runs entirely in the browser

> **Superseded by [ADR 0003](0003-sessions-on-a-php-backend.md).** Losing a
> browser's local storage lost everything, and export/import was a defence nobody
> used in time. Judgements now live in a server-side Session. The frontend is
> still a static build, as anticipated below — but on PHP 8 hosting rather than
> Cloudflare, and the "no live matching" and "clearing site data destroys
> everything" consequences no longer hold.

Choosing a baby name is something two people do together, so the obvious design is
an account system with live matching between partners. We rejected it: this app is
hosted on GitHub Pages at zero cost and will stay that way, so there is no server,
no database and no identity. Every Verdict, Rating and the Nom live in the browser's
local storage and never leave the device.

## Consequences

- **No live matching.** Partners cannot see each other's swipes in real time. The
  intended escape hatch is to encode one Mode's Shortlist into a compressed URL or
  QR code that the other device decodes and intersects locally — asynchronous, but
  it needs no infrastructure.
- **No cross-user statistics.** The Duel/Rating game is private to the device.
  A global "this name beat that one 73% of the time" is impossible without adding
  a backend, and stable identity to stop ballot-stuffing.
- **Clearing site data destroys everything.** There is no recovery. Accepted:
  a shortlist is a disposable artefact used for a few months.
- If live matching ever becomes non-negotiable, the migration is Cloudflare Pages +
  Workers + D1 rather than a rewrite — the frontend stays static either way.
