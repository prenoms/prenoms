#!/usr/bin/env bash
#
# Deploys quelprenom.xyz to OVH shared hosting over SFTP.
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
FTP_PORT="${FTP_PORT:-22}"

# The mirror runs with --delete, so the one thing that must never happen is it
# being pointed at the FTP home: `prenoms-data/` is a sibling of `www/` there,
# and everybody's Verdicts would go with the stale assets (ADR 0003, and
# docs/deployment.md § The remote layout).
case "$FTP_REMOTE_DIR" in
  "" | "." | "./" | "/" | "~" | "~/")
    die "FTP_REMOTE_DIR is '$FTP_REMOTE_DIR' — that is the FTP home, and mirroring it with --delete would erase prenoms-data/. Set it to www."
    ;;
  *prenoms-data*)
    die "FTP_REMOTE_DIR points into the Session data ($FTP_REMOTE_DIR). Set it to www."
    ;;
esac

command -v lftp >/dev/null || die "lftp is not installed — brew install lftp"

# lftp speaks SFTP by running ssh, which will not take a password from lftp.
# sshpass feeds it the one from .env; without sshpass the key in ~/.ssh has to
# be authorised on the host.
if command -v sshpass >/dev/null; then
  SSH_PROGRAM="sshpass -e ssh"
  export SSHPASS="$FTP_PASSWORD"
else
  echo "warning: sshpass not installed (brew install sshpass) — falling back to SSH key auth"
  SSH_PROGRAM="ssh"
fi

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

if [ "$DRY_RUN" = true ]; then
  MIRROR_FLAGS="--dry-run --verbose"
  echo "==> dry run: nothing will be written"
else
  MIRROR_FLAGS="--verbose"
  if [ "$ASSUME_YES" != true ]; then
    echo
    echo "About to mirror $STAGE/ onto sftp://$FTP_HOST/$FTP_REMOTE_DIR/"
    echo "Files there and not here WILL BE DELETED (prenoms-data/ is outside it, and is not touched)."
    read -r -p "Continue? [y/N] " reply
    [ "$reply" = "y" ] || [ "$reply" = "Y" ] || die "aborted"
  fi
fi

# SFTP throughout: the transport is SSH, so there is no FTPS certificate in
# play at all — certificate verification is turned off because nothing here
# presents one, and the host key is trusted on first use instead.
lftp -u "$FTP_USER,$FTP_PASSWORD" "sftp://$FTP_HOST:$FTP_PORT" <<EOF
set sftp:auto-confirm yes
set sftp:connect-program "$SSH_PROGRAM -a -x -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
set ssl:verify-certificate no
set net:max-retries 3
set cmd:fail-exit true

mirror --reverse --delete --continue --exclude-glob prenoms-data/ $MIRROR_FLAGS $STAGE/ $FTP_REMOTE_DIR/
bye
EOF

echo "==> done — https://quelprenom.xyz"
