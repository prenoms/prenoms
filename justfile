set dotenv-load
set shell := ["bash", "-euo", "pipefail", "-c"]

# List available recipes (default when you run `just` with no arguments)
default:
    @just --list

# Create .env from the example. Only `just deploy` needs it filled in.
init-env:
    [ -f .env ] || cp .env.dev.example .env
    @echo "✓ .env ready — fill in the OVH FTP credentials before deploying"

# --------------------------------------------------------------------- run

# Run just the Svelte dev server on http://127.0.0.1:5173 (proxies /api to :8888)
run-frontend-local:
    cd frontend && just dev

# Run just the PHP API on http://127.0.0.1:8888, Sessions in ./.prenoms-data
run-backend-local:
    PRENOMS_DATA_DIR="${PWD}/.prenoms-data" php -S 127.0.0.1:8888 backend/index.php

# -------------------------------------------------------------------- test

# Everything CI runs.
test: test-frontend test-backend check-data build

# Type-check the frontend and run the state-layer tests on node --test.
[working-directory('frontend')]
test-frontend:
    just test

# Lint every PHP file, then the unit and API suites.
[working-directory('backend')]
test-backend:
    just lint
    just test

# Validate the Prénom List: header, sort order, duplicates, folded collisions.
check-data:
    tools/check_prenoms.py --check

# Catches what the two suites above cannot: a wrong Vite base, a broken /api
# rewrite, a Prénom List that 404s, a Session file inside the web root.
# Build, stage the tree in the shape OVH will hold it, and smoke it end to end.
e2e:
    e2e/smoke-deploy.sh

# ------------------------------------------------------------------- ship

# `deploy` and the e2e smoke both go through this, so what is tested is what
# ships.
# Static build into frontend/dist/.
[working-directory('frontend')]
build:
    just build

# Run by hand, never from CI: the credentials reach every Session on the host.
# Mirror the staged tree onto OVH over FTPS (--dry-run to preview).
deploy *args:
    tools/deploy.sh {{ args }}

# Creates a real Session and leaves it behind; the sweep collects it.
# Smoke the live site after a deploy.
smoke-prod:
    ORIGIN=https://quelprenom.xyz node e2e/smoke.mjs

# -------------------------------------------------------------------- data

# Rebuild the Prénom List from INSEE's fichier des prénoms.
build-data *args:
    tools/build_prenoms.py {{ args }}
