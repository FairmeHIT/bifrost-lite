# Bifrost Lite — upstream sync tooling

Bifrost Lite is an **orphan-history fork** of `maximhq/bifrost`: its git history
has no common ancestor with upstream, so `git merge origin/main` cannot work.
This tool syncs by **snapshot 3-way merge** instead:

```
for every path changed upstream (base..tip):
    in denylist.txt (enterprise / lite-deleted) -> SKIP, never touched
    modified path retained by lite              -> git merge-file (ours lite / base fork / theirs upstream)
         clean   -> applied
         conflict-> worktree keeps the lite version; full 3-way saved to sync-output/conflicts/ for review
    added by upstream                            -> checked out (new OSS feature)
    renames                                     -> follow new path (skipped if new path is denied)
```

## Files

| file | purpose |
|---|---|
| `base.txt` | last-synced upstream commit (`d08b53112` at first run). **Bump it only after a successful sync merge.** |
| `denylist.txt` | paths never touched: enterprise-exclusive / lite-deleted features. Regenerate with `python3 sync_lib.py denylist`, then hand-edit curated additions. |
| `sync_lib.py` | the logic: `merge`, `denylist`, `report` subcommands |
| `sync.sh` | driver: fetch → branch → merge → guards → build gates → report |
| `sync-output/` | runtime artifacts (gitignored): `report.md`, `conflicts/`, `merged.txt`, `skipped.txt`, `guards.txt`, `go-build.log`, `tsc.log` |

## Denylist matching rule

An entry `E` skips a path `P` when `P == E`, `P` starts with `E/` (directory
rule), or `P` starts with `E` immediately followed by `.` (file-stem rule, e.g.
`transports/bifrost-http/handlers/mcp` also covers `mcpoauth2.go` and new
`mcp_*_test.go` files). When upstream adds a brand-new enterprise feature in a
new directory, add that directory here — this is the one part of the process
that needs a human eye.

## How to run

```bash
# make sure you are NOT on main (the tool refuses to run there)
git switch -c sync/upstream-2026-08-27        # or let sync.sh create one
bash scripts/upstream-sync/sync.sh            # fetch + merge + guards + build + report
```

Then:
1. read `scripts/upstream-sync/sync-output/report.md`
2. resolve the conflicts listed there (3-way attempts are in `sync-output/conflicts/`; the
   worktree deliberately kept the lite version, so lite stays buildable for those files)
3. fix anything reported by the guards (`sync-output/guards.txt`) and the build logs
   (`go-build.log`, `tsc.log`) — notably upstream Go files that re-import the deleted
   `core/mcp`, and UI files that re-import deleted API modules
4. merge the sync branch into `main` **only after** `go build ./...` and
   `cd ui && npx tsc --noEmit` pass
5. bump `base.txt` to the synced upstream tip

### Periodic automation

**cron** (weekly, Mon 03:00):

```
0 3 * * 1  cd /home/fairm/codes-wsl/74_bifrost && git switch main && git pull lite main && git switch -c sync/upstream-$(date +\%F) && bash scripts/upstream-sync/sync.sh >> /tmp/bifrost-sync.log 2>&1
```

**GitHub Actions** — add to the fork repo a workflow with
`schedule: cron '0 3 * * 1'` + `workflow_dispatch` that checks out the fork,
runs `sync.sh`, and opens a PR when the sync branch contains changes. Keep the
PR draft until the build gates pass.

### Environment notes (learned on a restricted network)

- **Go toolchain**: upstream now requires **Go 1.27.0** (`go.work` directive).
  If `GOTOOLCHAIN=auto` can't download it (proxy blocked), fetch the tarball from
  `dl.google.com` and point `PATH` at it; keep `GOTOOLCHAIN=local`.
- **Writable caches**: this sandbox mounts `$HOME` read-only. Point the Go caches
  into the repo before building:
  ```bash
  export GOMODCACHE="$PWD/.gomodcache" GOCACHE="$PWD/tmp/gocache"
  ```
  (both paths are gitignored). Without this, `go build` fails with
  `open /home/.../.cache/go-build/...: read-only file system`.
- **Module proxy**: if `proxy.golang.org` times out, use a reachable mirror,
  e.g. `export GOPROXY=https://goproxy.cn,direct`. `GOPROXY=direct` also works
  but is much slower (full git clones per module).
- **Checksum DB**: if `sum.golang.org` is unreachable/read-only, set
  `export GOSUMDB=off` (verify a trusted `go.sum` in CI instead).

## Guard rails ("don't break lite")

- the tool **refuses to run on `main`**; sync always happens on a branch
- denylisted paths are never written to
- after merging, merged Go files are scanned for imports of the deleted packages
  (`core/mcp`, `plugins/prompts`) and merged UI files for imports of deleted API
  modules; violations are listed in `guards.txt`
- `go build ./...` (go.work) and `ui tsc --noEmit` are the final gates
- conflicted files keep the lite version in the worktree, so the tree stays as
  close to a working lite as possible until a human resolves them
- `go.work` is **untracked in both repos** — after a sync that pulls in a new
  Go module (e.g. `plugins/routing`), add it to `go.work` before building