#!/usr/bin/env python3
"""
sync_lib.py — core logic for syncing Bifrost Lite with upstream maximhq/bifrost.

Bifrost Lite is an orphan-history fork (no git merge-base with upstream), so a
normal `git merge origin/main` is impossible.  This tool syncs by SNAPSHOT
3-way merge instead:

    for every path changed upstream (base..tip):
        - if the path is in denylist.txt  -> SKIP  (enterprise / lite-deleted; never touched)
        - else, if file exists in both    -> 3-way `git merge-file` (ours=lite, base=fork base, theirs=upstream)
                clean -> apply to worktree
                conflict -> keep lite version in worktree, save full 3-way attempt under
                            scripts/upstream-sync/sync-output/conflicts/ for human review
        - else (added by upstream)        -> checkout from tip (new OSS feature)
        - renames                         -> follow the new path (skip if the new path is denied)

Guards after merging: scan merged Go files for imports of deleted packages
(core/mcp, plugins/prompts, ...) and merged UI files for imports of deleted
API modules.  Real compilation gates live in sync.sh (`go build`, `tsc`).

Subcommands:
    denylist   Regenerate denylist.txt from the current lite tree vs base commit.
    merge      Apply the base..tip delta to the working tree (must be on a sync branch).
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip())
DIR = ROOT / "scripts" / "upstream-sync"
OUT = DIR / "sync-output"
CONFLICTS_DIR = OUT / "conflicts"

# Packages/modules deleted in Lite.  If any merged Go file imports these, the
# sync is considered broken unless a human fixes the file.
DELETED_GO_PKGS = [
    "github.com/maximhq/bifrost/core/mcp",
    "github.com/maximhq/bifrost/plugins/prompts",
]
# UI modules deleted in Lite (relative to ui/).  Merged .ts/.tsx files importing
# these need a human fix.
DELETED_UI_MODULES = [
    "@/lib/store/apis/mcpApi",
    "@/lib/store/apis/mcpLogsApi",
    "@/lib/store/apis/mcpPerUserHeadersApi",
    "@/lib/store/apis/mcpSessionsApi",
    "@/lib/store/apis/oauth2ConsentApi",
    "@/lib/store/apis/oauth2SessionsApi",
    "@/lib/store/apis/promptsApi",
    "@/lib/store/apis/skillsApi",
    "@/lib/store/apis/webhooksApi",
    "@/lib/types/mcp",
    "@/lib/types/mcpPerUserHeaders",
    "@/lib/types/mcpSessions",
    "@/lib/types/prompts",
    "@/lib/types/skills",
    "@/lib/types/webhooks",
]


def run(args, **kw):
    return subprocess.run(args, capture_output=True, text=True, check=True, **kw)


def ls_tree(rev):
    return set(run(["git", "ls-tree", "-r", "--name-only", rev]).stdout.split())


def read_denylist():
    """Return the set of denied path prefixes.  A path P is skipped when it
    starts with any entry E (pure prefix rule: E, E/, E<anything>).  Directory
    entries are written without a trailing slash; a single entry like
    `transports/bifrost-http/handlers/mcp` covers mcp.go, mcpoauth2*.go and any
    future mcp_*_test.go file."""
    entries = []
    for raw in (DIR / "denylist.txt").read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        entries.append(line)
    return entries


def is_skipped(path, denylist):
    for e in denylist:
        if path.startswith(e):
            return True
    return False


def compute_delta(base, tip):
    """Return list of (status-code, old-path, new-path) upstream changes."""
    # -M rename detection only; -C copy detection produces 'C' statuses which we
    # treat as plain additions, and -C can suppress R entries we do care about.
    out = run(["git", "diff", "--name-status", "-M", base, tip]).stdout
    delta = []
    for line in out.splitlines():
        parts = line.split("\t")
        st = parts[0]
        if st.startswith("R"):
            delta.append((st, parts[1], parts[2]))
        elif st.startswith("C"):
            # copy detection leftovers: new path is a copy -> treat as addition
            delta.append(("A", parts[2] if len(parts) > 2 else parts[1], parts[2] if len(parts) > 2 else parts[1]))
        else:
            delta.append((st, parts[1], parts[1]))
    return delta


def cmd_denylist(args):
    base = (DIR / "base.txt").read_text().strip()
    up = ls_tree(base)
    lite = ls_tree("HEAD")
    gone = up - lite  # upstream files absent from lite == the "enterprise / deleted" set

    dirs = set()
    for f in up:
        parts = f.split("/")
        for i in range(1, len(parts)):
            dirs.add("/".join(parts[:i]))

    fully = [
        d
        for d in dirs
        if any(f for f in up if f.startswith(d + "/"))
        and all(f in gone for f in up if f.startswith(d + "/"))
    ]
    maximal = [d for d in fully if not any(d != p and d.startswith(p + "/") for p in fully)]
    scattered = sorted(f for f in gone if not any(f.startswith(d + "/") for d in maximal))

    # Collapse deleted file groups into future-proof stem prefixes so that
    # upstream files added later under the same name family are also skipped.
    STEMS = [
        "transports/bifrost-http/handlers/mcp",
        "ui/lib/store/apis/mcp",
        "ui/lib/store/apis/oauth2",
        "ui/lib/types/mcp",
    ]
    for stem in STEMS:
        scattered = [f for f in scattered if not f.startswith(stem)]
    scattered += [s for s in STEMS if s not in scattered]

    lines = [
        "# Auto-generated by `sync_lib.py denylist` — edit with care, then re-run.",
        "#",
        "# Paths in this file are NEVER touched by the sync: they are the",
        "# enterprise-exclusive / lite-deleted features.  Skip rule: a path is",
        "# skipped when it starts with any entry (pure prefix).",
        "",
        "# --- directories fully deleted in Lite ---",
    ]
    lines += sorted(maximal)
    lines += ["", "# --- scattered files deleted in Lite ---"]
    lines += scattered
    lines += ["", "# --- curated: enterprise features upstream added AFTER the fork ---"]
    curated = [
        "ui/app/agent",  # MCP-agent handover (enterprise; imports @enterprise view)
        "ui/app/workspace/config/license",  # enterprise licensing page (IS_ENTERPRISE gated)
        "ui/app/workspace/config/branding",  # enterprise custom branding page
        "ui/app/workspace/edge-control",  # enterprise Edge Control pages
    ]
    lines += curated
    (DIR / "denylist.txt").write_text("\n".join(lines) + "\n")
    print(f"denylist.txt written: {len(maximal)} dirs + {len(scattered)} scattered + {len(curated)} curated")


def git_show(rev, path):
    r = subprocess.run(["git", "show", f"{rev}:{path}"], capture_output=True)
    if r.returncode != 0:
        return None
    return r.stdout


def three_way_merge(path, base, tip, tmpdir):
    """3-way merge lite current vs base vs tip for a path retained in both trees.
    Returns (status, merged_bytes) where status in {"clean", "conflict"}."""
    ours = git_show("HEAD", path)
    base_b = git_show(base, path)
    theirs = git_show(tip, path)
    if ours is None or base_b is None or theirs is None:
        return ("error", None)
    ours_p, base_p, theirs_p = (
        tmpdir / "ours", tmpdir / "base", tmpdir / "theirs",
    )
    ours_p.write_bytes(ours)
    base_p.write_bytes(base_b)
    theirs_p.write_bytes(theirs)
    r = subprocess.run(
        ["git", "merge-file", str(ours_p), str(base_p), str(theirs_p)],
        capture_output=True,
    )
    merged = ours_p.read_bytes()
    return ("clean" if r.returncode == 0 else "conflict", merged)


def cmd_merge(args):
    base = args.base or (DIR / "base.txt").read_text().strip()
    tip = args.tip
    denylist = read_denylist()
    out_dir = OUT
    conflicts_dir = CONFLICTS_DIR
    if args.dry_run:
        out_dir = OUT / "dryrun"
        conflicts_dir = out_dir / "conflicts"
    out_dir.mkdir(parents=True, exist_ok=True)
    conflicts_dir.mkdir(parents=True, exist_ok=True)
    if not args.dry_run:
        shutil.rmtree(conflicts_dir)
        conflicts_dir.mkdir(parents=True)

    import tempfile

    lite = ls_tree("HEAD")
    up = ls_tree(base)
    delta = compute_delta(base, tip)

    skip = []
    clean_merge = []
    conflicts = []
    added = []
    renames = []
    deleted_merge = []

    tmpdir = Path(tempfile.mkdtemp(prefix="bifrost-sync-"))

    try:
        for st, old, new in delta:
            s = st[0]
            if s == "D":
                if not is_skipped(old, denylist):
                    # upstream deleted a retained path (rare); mirror the deletion
                    if old in lite:
                        deleted_merge.append(old)
                        if not args.dry_run:
                            (ROOT / old).unlink(missing_ok=True)
                continue
            if s == "R":
                renames.append((st, old, new))
                continue
            if s == "A":
                if not is_skipped(new, denylist):
                    added.append(new)
                else:
                    skip.append((st, new))
                continue
            # st == "M"
            if is_skipped(new, denylist):
                skip.append((st, new))
                continue
            if new not in lite:
                # upstream-base file exists but lite lacks it -> should have been
                # covered by denylist; if it wasn't, treat as new file
                added.append(new)
                continue
            status, merged = three_way_merge(new, base, tip, tmpdir)
            if status in ("clean", "conflict"):
                if not args.dry_run:
                    target = ROOT / new
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(merged)
                if status == "clean":
                    clean_merge.append(new)
                else:
                    conflicts.append(new)
                    if not args.dry_run:
                        (conflicts_dir / new).parent.mkdir(parents=True, exist_ok=True)
                        (conflicts_dir / new).write_bytes(merged)
                        # keep lite's own version in the worktree (safe default)
                        ours = git_show("HEAD", new)
                        target.write_bytes(ours)
            else:
                conflicts.append(new)

        # additions: checkout from tip
        for p in added:
            data = git_show(tip, p)
            if data is None:
                continue
            if args.dry_run:
                continue
            target = ROOT / p
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)

        # renames: old -> new.  If new is denied, ignore entirely (lite keeps its tree).
        for st, old, new in renames:
            if is_skipped(new, denylist):
                continue
            if not args.dry_run:
                data = git_show(tip, new)
                if data is not None:
                    target = ROOT / new
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
            if old in lite and not is_skipped(old, denylist):
                deleted_merge.append(old)
                if not args.dry_run:
                    (ROOT / old).unlink(missing_ok=True)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    # ---- summary ----
    print("=== sync merge summary ===")
    print(f"upstream delta paths : {len(delta)}")
    print(f"skipped (enterprise) : {len(skip)}")
    print(f"clean 3-way merges   : {len(clean_merge)}")
    print(f"conflicts (keep lite): {len(conflicts)}")
    print(f"added (new upstream) : {len(added)}")
    print(f"renames              : {len(renames)}")
    print(f"upstream deletions   : {len(deleted_merge)}")

    # ---- dependency guards ----
    go_fail, ui_fail = [], []
    if not args.dry_run:
        changed = clean_merge + added + [n for _, _, n in renames]
        for p in changed:
            if p.endswith(".go"):
                # read merged content from the worktree
                fp = ROOT / p
                if not fp.exists():
                    continue
                content = fp.read_bytes().decode("utf-8", "replace")
                for pkg in DELETED_GO_PKGS:
                    if pkg in content:
                        go_fail.append((p, pkg))
                        break
            elif p.endswith((".ts", ".tsx")):
                fp = ROOT / p
                if not fp.exists():
                    continue
                content = fp.read_bytes().decode("utf-8", "replace")
                for mod in DELETED_UI_MODULES:
                    if re.search(r'["\']' + re.escape(mod) + r'["\']', content):
                        ui_fail.append((p, mod))
                        break

    print(f"guard: merged Go files importing deleted pkg : {len(go_fail)}")
    for p, m in go_fail:
        print("   ", p, "<-", m)
    print(f"guard: merged UI files importing deleted mod  : {len(ui_fail)}")
    for p, m in ui_fail:
        print("   ", p, "<-", m)

    # ---- write report fragments ----
    out_dir = OUT if not args.dry_run else OUT / "dryrun"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "merged.txt").write_text("\n".join(sorted(clean_merge + added)) + "\n")
    (out_dir / "conflicts.txt").write_text("\n".join(sorted(conflicts)) + "\n")
    (out_dir / "skipped.txt").write_text("\n".join(f"{s}\t{p}" for s, p in skip) + "\n")
    (out_dir / "guards.txt").write_text(
        "\n".join(f"GO\t{p}\t{m}" for p, m in go_fail)
        + "\n"
        + "\n".join(f"UI\t{p}\t{m}" for p, m in ui_fail)
    )

    print("\nreport fragments written to", out_dir)


def cmd_report(args):
    """Write a human-readable sync report from merge fragments + build logs."""
    base, tip = args.base, args.tip
    def read(name):
        p = OUT / name
        return [l for l in p.read_text().splitlines() if l.strip()] if p.exists() else []

    merged = read("merged.txt")
    conflicts = read("conflicts.txt")
    skipped = read("skipped.txt")
    guards = read("guards.txt")
    added = [p for p in merged if p not in ls_tree(base)]  # files not in base = added

    lines = []
    lines.append("# Bifrost Lite — upstream sync report")
    lines.append("")
    lines.append(f"- base (last synced): `{base}`")
    lines.append(f"- tip (upstream)    : `{tip}` ({run(['git','log','-1','--format=%ci %s',tip]).stdout.strip()})")
    lines.append(f"- delta paths       : {len(skipped) + len(merged)} (from `git diff --name-status -M {base}..{tip}`)")
    lines.append(f"- SKIPPED (enterprise/deleted): {len(skipped)}")
    lines.append(f"- merged clean      : {len(merged) - len(added) - len(conflicts)} modified + {len(added)} added")
    lines.append(f"- CONFLICTS (worktree kept lite version; 3-way attempt in `sync-output/conflicts/`): {len(conflicts)}")
    lines.append("")

    nconf = Counter()
    for p in conflicts:
        parts = p.split("/")
        nconf["/".join(parts[:3] if len(parts) >= 3 else parts)] += 1
    lines.append("## Conflicts by area")
    for k, v in nconf.most_common(30):
        lines.append(f"- {v:4d}  {k}")
    lines.append("")
    lines.append("## Conflict details (upstream change size per file)")
    for p in sorted(conflicts):
        st = run(["git", "diff", "--stat", f"{base}..{tip}", "--", p]).stdout.strip()
        if st:
            lines.append(f"- `{p}`  {st.splitlines()[-1].strip()}")
        else:
            lines.append(f"- `{p}`")
    lines.append("")
    lines.append("## Skipped (enterprise / lite-deleted — never merged)")
    lines.append("<details><summary>show {n}</summary>".format(n=len(skipped)))
    for s in skipped:
        lines.append(f"- {s}")
    lines.append("</details>")
    lines.append("")
    lines.append("## Added files (new upstream features — review for enterprise content)")
    for p in sorted(added):
        lines.append(f"- {p}")
    lines.append("")
    lines.append("## Dependency guards")
    if guards:
        for g in guards:
            lines.append(f"- ⚠️ {g}")
    else:
        lines.append("- none (no merged file imports deleted packages)")
    lines.append("")
    for logname in ("go-build.log", "tsc.log"):
        lp = OUT / logname
        if lp.exists() and lp.stat().st_size:
            txt = lp.read_text()
            marker = txt.count("<<<<<<<")
            lines.append(f"## Build log: `{logname}` (exit captured in sync.sh; conflict markers in log: {marker})")
            lines.append("<details><summary>show tail</summary>")
            lines.append("```")
            lines += txt.splitlines()[-60:]
            lines.append("```")
            lines.append("</details>")
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    print("wrote", OUT / "report.md")


def main():
    ap = argparse.ArgumentParser(description="Bifrost Lite upstream sync helper")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("merge", help="apply base..tip delta to working tree")
    m.add_argument("--base", default=None)
    m.add_argument("--tip", required=True)
    m.add_argument("--dry-run", action="store_true", help="classify only, change nothing")
    d = sub.add_parser("denylist", help="regenerate denylist.txt")
    d.add_argument("--base", default=None)
    r = sub.add_parser("report", help="write sync-report.md from fragments")
    r.add_argument("--base", default=None)
    r.add_argument("--tip", required=True)
    args = ap.parse_args()
    if args.cmd == "merge":
        cmd_merge(args)
    elif args.cmd == "denylist":
        cmd_denylist(args)
    elif args.cmd == "report":
        args.base = args.base or (DIR / "base.txt").read_text().strip()
        cmd_report(args)


if __name__ == "__main__":
    main()