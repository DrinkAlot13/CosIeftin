#!/bin/sh
# The wrapper cron runs INSIDE the container. Linux/POSIX sibling of nightly.ps1 (Windows Task
# Scheduler), same reasoning: the dated log file is created BEFORE anything that can fail, so an
# absent file means cron never fired us, a file with only the banner means we died immediately,
# and a file with a tail means the run failed and the tail says how.
#
# This is what makes `npm run nightly` inspectable from the admin panel afterward
# (/admin/logs) — without it, a container restart between "cron ran" and "someone asks what
# happened" leaves nothing to look at, since stdout from `docker exec` goes nowhere unless
# something captures it.
#
# Run via cron as:  docker exec cosmic sh scripts/nightly.sh
set -eu

cd "$(dirname "$0")/.."

STAMP=$(date +%Y-%m-%d)
LOG_DIR="logs/nightly"
LOG="$LOG_DIR/$STAMP.log"
mkdir -p "$LOG_DIR"

{
  echo "=== nightly started $(date '+%Y-%m-%d %H:%M:%S %z') ==="
  echo "    cwd  : $(pwd)"
  echo "    user : $(id -un 2>/dev/null || echo unknown)"
} >> "$LOG"

set +e
npm run nightly >> "$LOG" 2>&1
CODE=$?
set -e

{
  echo ""
  echo "=== nightly finished $(date '+%Y-%m-%d %H:%M:%S') exit=$CODE ==="
} >> "$LOG"

exit "$CODE"
