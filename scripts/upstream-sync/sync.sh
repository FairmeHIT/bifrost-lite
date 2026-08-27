#!/usr/bin/env bash
#
# sync.sh — periodic Bifrost Lite <-> upstream maximhq/bifrost sync driver.
#
#     1. fetches upstream, computes base..tip delta
#     2. 3-way merges retained paths, skips denylisted (enterprise) paths
#     3. runs guards + build gates, writes a human report
#     4. leaves a WIP commit on a dedicated sync branch (never on main)
#
# Usage:
#   bash scripts/upstream-sync/sync.sh               # plan + apply on a fresh branch
#   bash scripts/upstream-sync/sync.sh --branch x    # apply on branch x (must not be main)
#   bash scripts/upstream-sync/sync.sh --dry-run     # report only, change nothing
#
# Scheduling ideas: local cron ("0 3 * * 1") or GitHub Actions (schedule +
# workflow_dispatch) that runs this and opens a PR.  See README.md.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
DIR="scripts/upstream-sync"
PY="python3 $DIR/sync_lib.py"

UPSTREAM="${UPSTREAM:-origin}"
REMOTE_BRANCH="${REMOTE_BRANCH:-main}"
BASE="$(cat "$DIR/base.txt")"

BRANCH=""
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "==> fetching upstream ($UPSTREAM/$REMOTE_BRANCH) ..."
git fetch "$UPSTREAM" "$REMOTE_BRANCH"
TIP="$UPSTREAM/$REMOTE_BRANCH"
echo "    base = $BASE"
echo "    tip  = $(git rev-parse --short "$TIP") $(git log -1 --format='%ci %s' "$TIP" | cut -c1-80)"

CUR="$(git branch --show-current)"
if [[ "$CUR" == "main" || "$CUR" == "master" ]]; then
  echo "!! refusing to sync on '$CUR' — create/switch to a sync branch first (--branch)" >&2
  exit 1
fi

if [[ $DRY_RUN -eq 1 ]]; then
  echo "==> dry run: classifying the delta without touching the worktree"
  $PY merge --base "$BASE" --tip "$TIP" --dry-run
  exit 0
fi

DATE="$(date +%Y-%m-%d)"
if [[ -z "$BRANCH" ]]; then
  BRANCH="sync/upstream-$DATE"
  if git rev-parse --verify -q "$BRANCH" >/dev/null; then
    echo "!! branch $BRANCH exists; pass --branch <name>"; exit 1
  fi
fi
git switch -c "$BRANCH" 2>/dev/null || git switch "$BRANCH"
echo "==> on branch: $BRANCH"

echo "==> applying 3-way merge (denylist-aware) ..."
$PY merge --base "$BASE" --tip "$TIP"

echo "==> staging merged files ..."
git add -A -- . ':(exclude)scripts/upstream-sync/sync-output/'

echo "==> guards: deleted-package imports in merged Go/UI files ..."
grep -q GO "$DIR/sync-output/guards.txt" 2>/dev/null && { echo "!! guard violations:"; cat "$DIR/sync-output/guards.txt"; echo "!! resolve and re-run before merging this branch"; } || true

echo "==> go.work: list newly discovered modules (go.work is untracked; add them before building) ..."
for m in $(find . -name go.mod -not -path './node_modules/*' 2>/dev/null | sed 's#^\./##; s#/go.mod$##' | sort); do
  if ! grep -q "^	\./$m\$" go.work 2>/dev/null; then
    echo "    NEW module: $m"
  fi
done

echo "==> build gates (go build + ui tsc) ..."
set +e
go build ./... > "$DIR/sync-output/go-build.log" 2>&1; GO_RC=$?
( cd ui && npx tsc --noEmit > ../"$DIR"/sync-output/tsc.log 2>&1 ); TS_RC=$?
set -e
echo "    go build rc=$GO_RC   tsc rc=$TS_RC  (logs: $DIR/sync-output/)"

echo "==> writing report ..."
"$PY" report --base "$BASE" --tip "$TIP" 2>/dev/null || true

echo
echo "DONE.  Next steps:"
echo "  - review scripts/upstream-sync/sync-report.md"
echo "  - resolve ./scripts/upstream-sync/sync-output/conflicts/ (worktree kept the lite version for those)"
echo "  - fix go-build.log / tsc.log errors, re-run guards, then merge '$BRANCH' into main yourself"
echo "  - after a successful merge, bump scripts/upstream-sync/base.txt to $(git rev-parse --short "$TIP")"