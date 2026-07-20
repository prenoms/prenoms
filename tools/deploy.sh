#!/usr/bin/env bash
#
# Deploys quelprenom.xyz to OVH shared hosting over FTPS.
#
# There is no CI push: this is run by hand, from a checkout, after the checks
# pass. It stages exactly what `www/` should contain and mirrors that, so the
# remote ends up matching the staging directory rather than accumulating the
# assets of every past build — Vite fingerprints its output, so nothing is ever
# overwritten in place and stale files would otherwise pile up for ever.
#
# The Session files live in `prenoms-data/`, a sibling of `www/`, which is why
# mirroring `www/` with --delete cannot touch anybody's Verdicts. That is the
# whole reason the data directory sits outside the web root (ADR 0003).
#
# Usage:  just deploy [--dry-run] [--yes]

set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes | -y) ASSUME_YES=true ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 2
      ;;
  esac
done

die() {
  echo "error: $*" >&2
  exit 1
}

# --------------------------------------------------------------- credentials

[ -f .env ] || die "no .env — run \`just init-env\` and fill it in"
# shellcheck disable=SC1091
set -a && . ./.env && set +a

: "${FTP_HOST:?missing in .env}"
: "${FTP_USER:?missing in .env}"
: "${FTP_PASSWORD:?missing in .env}"
FTP_REMOTE_DIR="${FTP_REMOTE_DIR:-www}"

command -v lftp >/dev/null || die "lftp is not installed — brew install lftp"

# ---------------------------------------------------------------- the checks

if [ -n "$(git status --porcelain)" ]; then
  echo "warning: the working tree is dirty; you are about to deploy uncommitted work."
fi

echo "==> checks"
just test-frontend
just test-backend
just check-data

echo "==> build"
rm -rf frontend/dist
just build

# --------------------------------------------------------------- the staging
#
# Assembled rather than pushed piecemeal: one directory that *is* the web root,
# so the mirror is a single idempotent operation and it is obvious by looking
# what ends up public.

STAGE=".deploy"
tools/stage.sh "$STAGE"

echo "==> staged $(find "$STAGE" -type f | wc -l | tr -d ' ') files for $FTP_REMOTE_DIR/"

# ---------------------------------------------------------------- the mirror

# The PHP version selector lives at the FTP root, beside www/, not inside it —
# so it is a separate upload, outside the mirror.
PUT_OVHCONFIG="put -O / ovhconfig -o .ovhconfig"

if [ "$DRY_RUN" = true ]; then
  MIRROR_FLAGS="--dry-run --verbose"
  PUT_OVHCONFIG="echo would upload .ovhconfig"
  echo "==> dry run: nothing will be written"
else
  MIRROR_FLAGS="--verbose"
  if [ "$ASSUME_YES" != true ]; then
    echo
    echo "About to mirror $STAGE/ onto ftp://$FTP_HOST/$FTP_REMOTE_DIR/"
    echo "Files there and not here WILL BE DELETED."
    read -r -p "Continue? [y/N] " reply
    [ "$reply" = "y" ] || [ "$reply" = "Y" ] || die "aborted"
  fi
fi

# FTPS throughout: OVH offers plain FTP too, and these credentials are the only
# thing standing between the internet and every Session on the host.
lftp -u "$FTP_USER,$FTP_PASSWORD" "$FTP_HOST" <<EOF
set ftp:ssl-force true
set ftp:ssl-protect-data true
set ssl:verify-certificate true
set net:max-retries 3
set cmd:fail-exit true

$PUT_OVHCONFIG
mirror --reverse --delete --continue $MIRROR_FLAGS $STAGE/ $FTP_REMOTE_DIR/
bye
EOF

echo "==> done — https://quelprenom.xyz"
