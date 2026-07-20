#!/usr/bin/env bash
#
# Builds, stages, and serves the tree in the shape OVH will hold it, then runs
# `smoke.mjs` against it. The point is the shape: the staging directory is laid
# out as `<home>/www/`, so `server/config.php` resolves its data directory to a
# sibling of the web root exactly as it will on the host — and the test asserts
# that no Session file lands anywhere Apache could serve it.
#
# Catches what neither `just test-frontend` nor `just test-backend` can: a wrong Vite
# `base`, a broken /api rewrite, a Prénom List that 404s.

set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8123}"
HOME_DIR="$(mktemp -d)"
WWW="$HOME_DIR/www"

cleanup() {
  if [ -n "${SERVER_PID:-}" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  rm -rf "$HOME_DIR"
}
trap cleanup EXIT

echo "==> build"
just build >/dev/null

echo "==> stage into $WWW"
tools/stage.sh "$WWW"
cp e2e/smoke-router.php "$WWW/"

echo "==> serve"
# `exec` so $! is the PHP process itself and not the subshell — the liveness
# check below depends on it.
(cd "$WWW" && exec php -S "127.0.0.1:$PORT" smoke-router.php) >/dev/null 2>&1 &
SERVER_PID=$!

READY=false
for _ in $(seq 1 40); do
  # `php -S` exits immediately when the port is taken, and a leftover server
  # from an earlier run would answer every request from a stale tree — a green
  # smoke test against the wrong build is worse than no smoke test at all.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "error: php -S exited — is port $PORT already in use? (PORT=... to change)" >&2
    exit 1
  fi
  if node -e "fetch('http://127.0.0.1:$PORT/').then(()=>process.exit(0),()=>process.exit(1))" 2>/dev/null; then
    READY=true
    break
  fi
  sleep 0.25
done
[ "$READY" = true ] || {
  echo "error: server did not come up on $PORT" >&2
  exit 1
}

echo "==> smoke"
ORIGIN="http://127.0.0.1:$PORT" node e2e/smoke.mjs

# The whole reason the data directory sits outside the web root (ADR 0003):
# these files hold people's Verdicts and the family Nom.
if find "$WWW" -name '*.json' | grep -q .; then
  echo "FAIL  a Session file landed inside the web root" >&2
  exit 1
fi
if ! find "$HOME_DIR/prenoms-data" -name '*.json' 2>/dev/null | grep -q .; then
  echo "FAIL  no Session file in <home>/prenoms-data — config.php resolved elsewhere" >&2
  exit 1
fi
echo "ok    Sessions land outside the web root"
