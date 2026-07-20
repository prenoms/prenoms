# The Session API

Plain PHP 8, no framework, no Composer, no database — the same spirit as the
frontend, which has no runtime dependencies. See
[ADR 0003](../docs/adr/0003-sessions-on-a-php-backend.md).

One JSON file per Session, in a directory **outside the web root**
(`config.php`), with `flock(LOCK_EX)` around every read-modify-write.
Authorisation is possession of the Session id and nothing else.

## Running it

```sh
just run-backend-local  # php -S on 127.0.0.1:8888, Sessions in ./.prenoms-data
just test-backend       # php -l, unit tests, then the API tests on a throwaway dir
```

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/sessions` | Create a Session. Returns its id. |
| `GET` | `/api/sessions/{id}` | The join screen's view: Profiles, their ready state, whether the Session has merged, and the Final Profile once it has. Never another Profile's Verdicts. |
| `PUT` | `/api/sessions/{id}/nom` | `{nom}` — Session-level, either Profile may set it. Blank clears it. |
| `POST` | `/api/sessions/{id}/profiles` | `{name}` — claim a Profile. Max two, names unique within the Session. |
| `GET` | `/api/sessions/{id}/profiles/{pid}` | That Profile's own state: seed, Verdicts, Ratings, Duel counts, both Modes. |
| `PUT` | `/api/sessions/{id}/profiles/{pid}/verdicts/{mode}/{prenom}` | `{verdict}` — `keep` or `reject`. Idempotent, so a retry is free. |
| `DELETE` | `/api/sessions/{id}/profiles/{pid}/verdicts/{mode}/{prenom}` | Clear the Verdict. |
| `PUT` | `/api/sessions/{id}/profiles/{pid}/ratings/{mode}` | `{ratings, duels}` — the per-Profile Ranking, written whole. The client computes it (`frontend/src/lib/duel.ts`); the server only stores it. |
| `POST` | `/api/sessions/{id}/profiles/{pid}/ready` | Irreversible. Merges the Session in the same locked write if every Profile is then ready. |
| `POST` | `/api/sessions/{id}/final/duels` | `{mode, winner, loser}` — the **server** computes the Elo, inside the lock, so two simultaneous picks both count. |

Errors are `{error, message}` with a French `message` fit to show a user:
`400` malformed, `404` no such Session or Profile, `409` the Session's state
forbids it (a third Profile, a Verdict after the merge, a Duel before it).

## By hand

```sh
ID=$(curl -s -XPOST localhost:8888/api/sessions | sed 's/.*"id":"\([^"]*\)".*/\1/')
PID=$(curl -s -XPOST localhost:8888/api/sessions/$ID/profiles \
  -d '{"name":"Alex"}' | sed 's/.*"id":"\([^"]*\)".*/\1/')
curl -XPUT localhost:8888/api/sessions/$ID/profiles/$PID/verdicts/female/Jeanne \
  -d '{"verdict":"keep"}'
curl -XPOST localhost:8888/api/sessions/$ID/profiles/$PID/ready
curl -XPOST localhost:8888/api/sessions/$ID/final/duels \
  -d '{"mode":"female","winner":"Jeanne","loser":"Zoe"}'
```
