# Deployment

Apache + PHP 8 on OVH shared hosting. No database, no cron, no CI push: the FTP
credentials reach every Session on the host, so they live in a gitignored `.env`
on one machine and the deploy is run by hand.

```bash
just init-env          # .env from the example — then fill in the OVH credentials
just deploy --dry-run  # show what would change
just deploy            # checks, build, stage, mirror
just smoke-prod        # assert the live site actually works
```

## What `just deploy` does

`tools/deploy.sh`, in order:

1. Warns if the working tree is dirty — you are about to deploy uncommitted
   work.
2. Runs `just test-frontend`, `just test-backend`, `just check-data`. A failure
   here stops the deploy.
3. `just build` into `frontend/dist/`.
4. `tools/stage.sh .deploy` — assembles a directory that **is** the web root.
5. mirrors `.deploy/`
   onto `www/` over FTPS with `--delete`, after a confirmation prompt (`--yes`
   skips it).

The mirror is `--delete` because Vite fingerprints its output: nothing is ever
overwritten in place, so without it every past build's assets would accumulate
for ever.

FTPS throughout with `ssl:verify-certificate`. OVH offers plain FTP; these
credentials are the only thing between the internet and every Session on the
host.

## The remote layout

```
/home/xxx/              FTP home
├── www/                DocumentRoot for quelprenom.xyz — the mirror target
│   ├── index.html      the Svelte app; Cache-Control: no-cache
│   ├── assets/         fingerprinted js/css/csv, immutable for a year
│   ├── favicon.svg
│   ├── .htaccess       from ./root.htaccess
│   └── server/         from ./backend/ — only index.php is reachable
└── prenoms-data/       one JSON file per Session, unreachable over HTTP
```

Three things about that layout are load-bearing:

**`prenoms-data/` is a sibling of `www/`, not a child.** The files hold people's
Verdicts and the family Nom, and nothing stops Apache serving a `.json` it can
see. `backend/config.php` resolves it as `dirname(__DIR__, 2)`, which lands
there exactly because the API sits at `www/server/`. It is also why mirroring
`www/` with `--delete` can never touch anybody's data.

**The PHP is inside the web root.** An `.htaccess` cannot rewrite to a target
outside it, so `www/server/` it is — and `backend/.htaccess` denies every `.php`
except `index.php`.

**The API folder is called `server/` remotely, `backend/` in the repo.** The
name is baked into the rewrite in `root.htaccess`; `tools/stage.sh` does the
translation.

## What is deliberately not deployed

`backend/tests/` (it spawns a server and writes to a throwaway directory),
`backend/justfile`, `e2e/`, `tools/`, `data/` as a source file (it ships
fingerprinted into `assets/`), and anything else `tools/stage.sh` does not
explicitly copy. The staging list is an allowlist — that is the point of
assembling a tree rather than pushing files piecemeal.

## Housekeeping

Sessions untouched for twelve months are unlinked. The host has no cron, so the
sweep rides on writes, roughly one in a hundred.
