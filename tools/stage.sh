#!/usr/bin/env bash
#
# Assembles exactly what the web root should contain into $1, from an existing
# `frontend/dist/`. Shared by `deploy.sh`, which mirrors it to OVH, and by
# `e2e/smoke-deploy.sh`, which serves it locally — so what is tested is what
# ships.
#
# The API is staged as `server/`, not `backend/`: that is the folder name the
# web root's rewrite points at (see root.htaccess), and renaming it remotely
# would buy nothing.

set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="${1:?usage: tools/stage.sh <dir>}"
[ -d frontend/dist ] || {
  echo "error: no frontend/dist/ — run just build first" >&2
  exit 1
}

rm -rf "$TARGET"
mkdir -p "$TARGET/server/lib"

cp -R frontend/dist/. "$TARGET/"
cp root.htaccess "$TARGET/.htaccess"

cp backend/index.php backend/config.php "$TARGET/server/"
cp backend/lib/*.php "$TARGET/server/lib/"
cp backend/.htaccess "$TARGET/server/.htaccess"
# `backend/tests/` is deliberately absent: it spawns a PHP server and writes to
# a throwaway data directory, neither of which belongs on a public host. So is
# `backend/justfile`, which is dev tooling.
