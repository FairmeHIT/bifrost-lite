---
name: public-expose
description: Expose a locally running Bifrost Lite production instance to the public internet. Two channels covered - (A) Cloudflare Tunnel (preferred, needs a CF-hosted domain, gives HTTPS + hides IP + no server needed) and (B) frp TCP tunnel through a rented cloud server (fallback, needs security-group coordination). Also covers the production build (make build LOCAL=1), the data-preserving app-dir symlink, dual launchd watchdogs, anti-scanner hardening, DNS propagation gotchas, and end-to-end verification. Invoked with /public-expose or when the user asks to expose/update the public URL of the local gateway, switch its public port or domain, or check the watchdog setup.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, AskUserQuestion
---

# Bifrost Lite → Public Internet (Cloudflare Tunnel + frp fallback)

Turn a locally built Bifrost Lite gateway into a stable public service while
keeping all provider keys/config and keeping scanners from burning traffic.

Two channels exist on this machine. **Prefer A** (Cloudflare Tunnel); keep
B (frp) as a fallback or retire it.

| | A. Cloudflare Tunnel | B. frp → rented server |
|---|---|---|
| Public URL | `https://bifrost.fairme.cc.cd` | `http://47.112.174.22:38421` |
| Measured latency | ~760 ms/req (CF edge RTT 163 ms, overseas) | **~50 ms/req** (server RTT 14 ms) — frp is 15× faster |
| Stability | Rock solid (0 failures across all probes) | Fixed 2026-09-06 after intermittent server-side drops; re-verified 100/100 |
| TLS | Automatic (CF edge) | None (plain HTTP) |
| Needs a server | No (outbound-only to CF) | Yes (frps + security group) |
| Hides real IP | Yes | No (server IP exposed) |
| Anti-scan | CF filters junk at edge | High port only |
| Best for | UI in browser, sharing, mobile, fallback | SDK/API calls where latency matters |
| Weak spot | Domain must stay on CF; LAN DNS negative-cache can lag | Depends on rented server health — see Case #1 |

## Architecture

```
                    [A] Cloudflare Tunnel (preferred)
Internet ──https──> *.fairme.cc.cd (CF edge)
                        │  outbound-only QUIC/tunnel, launchd-guarded
                        ▼
   cloudflared (config.yml ingress: bifrost.fairme.cc.cd → 127.0.0.1:8090)
                        │
                    [B] frp tunnel (fallback)
Internet ──http───> 47.112.174.22:38421  (frps + security group allow)
                        │  frp control: server:7000
                        ▼
            frpc (local, launchd-guarded, localPort 8090)
                        │
                        ▼
        bifrost-http :8090  (scripts/start.sh, launchd-guarded, app-dir=bifrost-data)
                        │
                        ▼
        ~/.config/bifrost/{config.db, logs.db}   (data preserved via symlink)
```

Key facts that are easy to get wrong:
- The data dir is **outside** the repo: the repo's `bifrost-data` is a
  **symlink → `~/.config/bifrost`**. Never delete it or the instance boots
  into an empty DB (no providers/keys).
- A TCP `remotePort` change in frpc is NOT enough: the cloud security group
  must also allow the new port inbound, or the public side times out.
- Scanning bots hammer 8080/80/443. A random high port (e.g. 38421) drops
  most bulk scans; CF Tunnel avoids the problem entirely; and
  `enforce_auth_on_inference` stops the rest from burning upstream quota.
- launchd agents keep things alive: `com.fairme.bifrost-watchdog` (bifrost
  via scripts/start.sh), `com.fairme.frpc-watchdog` (frpc),
  `com.fairme.cloudflared.ai-insights` (cloudflared, hosts ALL CF domains on
  this machine — restarting it blips every site for ~2-3 s).
- The sandbox blocks writes outside the repo and `kill` on launchd-managed
  processes; run those with full access / direct user shell.

## Step 1 — Production build (embed UI + binary)

From the repo root. The UI is built first and copied into
`transports/bifrost-http/ui`, then statically linked into one binary.

```bash
cd /Users/fairme/Codes/bifrost-lite
GOCACHE="$PWD/tmp/gocache" make build LOCAL=1    # tmp/bifrost-http
```

- `LOCAL=1` keeps `go.work` enabled (needed in this fork).
- If the Go build cache under `~/Library/Caches/go-build` is unwritable
  (sandbox), point `GOCACHE` into the repo as above.
- Output: `tmp/bifrost-http` (a ~110 MB self-contained binary, vdev-build).
- Takes ~2 min (npm build + typecheck + go build). Run it in the background
  and poll, don't block.

## Step 2 — Data dir (do once, verify each time)

`scripts/start.sh` passes `-app-dir "$ROOT/bifrost-data"`. Real data lives at
`~/.config/bifrost`; keep a symlink so the process opens the original DBs:

```bash
ls -la /Users/fairme/Codes/bifrost-lite/bifrost-data   # symlink → ~/.config/bifrost
# if missing: ln -s ~/.config/bifrost /Users/fairme/Codes/bifrost-lite/bifrost-data
```

`bifrost-data` is in `.gitignore`, so the symlink never pollutes git.

## Step 3 — Start the instance

```bash
cd /Users/fairme/Codes/bifrost-lite
./scripts/start.sh        # -port 8090 -host 127.0.0.1 -app-dir bifrost-data
```

- Binds 127.0.0.1:8090 only — public reachability comes exclusively from frpc.
- First run needs access to `~/.config/bifrost`; under a sandbox, start it
  with full access or it dies with
  `unable to open database file: no such file or directory`.
- If the launchd watchdog is installed, you can instead kill the running
  binary and let the watchdog relaunch it within ~65 s:

```bash
kill -9 <pid>                 # old binary out, watchdog pulls the new one
sleep 65 && pgrep -fl "tmp/bifrost-http -port 8090"
```

## Step 4 — frp tunnel

Config: `/Users/fairme/frpc-bifrost.toml`

```toml
serverAddr = "47.112.174.22"
serverPort = 7000
auth.token = "frp-secure-token-2024"

[[proxies]]
name = "web-8080"          # proxy name is cosmetic; keep it stable
type = "tcp"
localIP = "127.0.0.1"
localPort = 8090           # the local bifrost port — DO NOT change
remotePort = 38421         # the public port — change only with step 5
```

Restart frpc after any config edit:

```bash
pkill -f "frpc -c /Users/fairme/frpc-bifrost.toml"
# the frpc-watchdog relaunches it within ~60 s, or start manually:
nohup /opt/homebrew/Cellar/frpc/0.71.0/bin/frpc -c /Users/fairme/frpc-bifrost.toml \
  >> /private/tmp/frpc.log 2>&1 &
sleep 3 && tail -5 /private/tmp/frpc.log     # expect: start proxy success
```

## Step 5 — Switch the public port (needs cloud console)

1. In the cloud console (Alibaba/Tencent security group) for the server,
   **allow the new TCP port inbound** (e.g. `38421/TCP`). Without this the
   frp registration succeeds but public connections time out.
2. Verify reachability *before* cutting over (frps allows any remotePort —
   only the security group gates it):

```bash
# temporary probe tunnel on the new port, pointing at a throwaway local
# HTTP server on 18099 → verifies frps + security group end to end
# then: curl http://<server-ip>:<new-port>/  → expect HTTP 200
```

3. Edit `remotePort` in the frpc config, restart frpc (Step 4).
4. Confirm old port dead, new port live:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://<server-ip>:<new>/health   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://<server-ip>:<old>/health   # 000/timeout
```

## Step 5A — Cloudflare Tunnel (preferred channel)

Expose as `https://bifrost.fairme.cc.cd` — no server, no open port, automatic
TLS. Prereq: a domain whose DNS is hosted on Cloudflare (this machine already
has `fairme.cc.cd`) and `cloudflared` installed (`brew install cloudflared`).

This machine already runs ONE shared tunnel hosting several sites. Adding a
new service = 3 small edits, never create a second tunnel unless the domain
changes:

1. **Add ingress** to `~/.cloudflared/config.yml` (before the catch-all
   `http_status:404` rule — order matters, first match wins):

```yaml
ingress:
  - hostname: ai-insights.fairme.cc.cd
    service: http://127.0.0.1:18080
  - hostname: new-api.fairme.cc.cd
    service: http://127.0.0.1:3000
  - hostname: git.fairme.cc.cd
    service: http://127.0.0.1:3333
  - hostname: bifrost.fairme.cc.cd        # ← new: local bifrost
    service: http://127.0.0.1:8090
  - service: http_status:404              # catch-all must stay last
```

2. **Create DNS** (one CNAME per hostname; `-f` overwrites an existing record):

```bash
cloudflared tunnel route dns -f ai-insights bifrost.fairme.cc.cd
# expect: "Added CNAME bifrost.fairme.cc.cd which will route to this tunnel"
```

3. **Restart the launchd agent** to load the new ingress — this briefly
   (~2-3 s) blips EVERY site on the tunnel, so mention it before doing it:

```bash
launchctl unload ~/Library/LaunchAgents/com.fairme.cloudflared.ai-insights.plist
sleep 2
launchctl load   ~/Library/LaunchAgents/com.fairme.cloudflared.ai-insights.plist
sleep 4 && pgrep -fl "cloudflared tunnel"   # new pid, running
```

4. **Verify — beware local DNS negative caching.** Public resolvers pick the
   record up in minutes, but a LAN resolver (e.g. `10.x.x.x`) may keep
   serving NXDOMAIN long after. Test the real chain by pinning the CF edge
   IP; do NOT conclude "broken" from a plain curl that fails DNS:

```bash
nslookup bifrost.fairme.cc.cd 8.8.8.8            # CF edge IPs (104.21.x / 172.67.x)
curl -s --resolve bifrost.fairme.cc.cd:443:<edge-ip> \
     https://bifrost.fairme.cc.cd/health          # expect 200 {"status":"ok"}
```

First-time setup (no existing tunnel) looks like:
`cloudflared tunnel login` → `tunnel create <name>` → write `config.yml`
(`tunnel:` + `credentials-file:` + `ingress:`) → `tunnel route dns` per
hostname → run via launchd (`KeepAlive` plist pointing at
`cloudflared tunnel --config ... run <name|uuid>`) → same DNS-cache caveat.

Quick throwaway URL (no account/domain, random URL each run, NOT for
production): `cloudflared tunnel --url http://localhost:8090`.

## Step 6 — Watchdogs (installed once, verify on every deployment)

Two launchd agents (`~/Library/LaunchAgents/`):
- `com.fairme.bifrost-watchdog.plist` → `/Users/fairme/bifrost-watchdog.sh`
- `com.fairme.frpc-watchdog.plist` → `/Users/fairme/frpc-watchdog.sh`

Both are `KeepAlive=true` bash loops checking every 60 s with a 300 s
restart cooldown. bifrost watchdog probes `nc -z 127.0.0.1 8090` and relaunch
via `scripts/start.sh`; frpc watchdog checks the TCP connection to the server.

```bash
launchctl list | grep -E "bifrost|frp"        # both loaded
pgrep -fl "bifrost-watchdog|frpc-watchdog"    # both running
```

Reload a watchdog after editing its script/plist:

```bash
launchctl unload ~/Library/LaunchAgents/com.fairme.bifrost-watchdog.plist
launchctl load   ~/Library/LaunchAgents/com.fairme.bifrost-watchdog.plist
```

## Step 7 — Verify end to end

```bash
# local
curl -s http://127.0.0.1:8090/health
# public via Cloudflare Tunnel (pin edge IP if LAN DNS still has negative cache)
curl -s https://bifrost.fairme.cc.cd/health
# public via frp fallback
curl -s http://47.112.174.22:38421/health
# data really preserved (process must hold the original DB files)
lsof -p <pid> | grep -E "config.db$|logs.db$"   # → ~/.config/bifrost/...
# binary really the new build (process inode == disk inode)
lsof -p <pid> | grep "tmp/bifrost-http$"
stat -f "%i" /Users/fairme/Codes/bifrost-lite/tmp/bifrost-http
```

## Step 8 — Anti-scanner hardening

| Threat | Fix |
|---|---|
| Bulk scans on 8080/80/443 | CF Tunnel sidesteps ports entirely; frp fallback uses a high random port (Step 5) |
| Unauthenticated calls burning upstream quota | Settings → Security → "Enforce Virtual Keys on Inference" (`enforce_auth_on_inference = true`), after creating a virtual key |
| Admin password leak | Already safe: bcrypt hash in DB, `/api/config` → 401 publicly, redacted responses |
| Provider keys at rest | Stored plain_text in `config.db` (local only; keep the host clean / enable DB encryption if desired) |

## Gotchas

- **frpc config lives OUTSIDE the repo** (`/Users/fairme/frpc-bifrost.toml`),
  edits need full sandbox access. Same for `~/.cloudflared/config.yml`,
  `bifrost-watchdog.sh`, `frpc-watchdog.sh`, and the LaunchAgents.
- `remotePort` change alone ⇒ public timeout. Always confirm the security
  group first (Step 5 probe).
- The proxy name `web-8080` in frpc is legacy/cosmetic — keep it, don't
  rename; a rename can transiently collide on the frp server.
- A fresh instance that lost the data symlink logs
  `config file not found ... initializing with default values` then fails on
  sqlite — the symlink is the first thing to check.
- Watchdog relaunch latency is ~65 s max (60 s poll + start); don't report
  "down" until a full cycle has passed after a kill.
- **frps can die while its port still answers**: seen 2026-09 — TCP connect
  to `:7000` OK, ping OK, but frpc login loops on
  `connection write timeout` and frpc's `loginFailExit` (default true) makes
  it exit instantly, so the frpc-watchdog restart-loop logs "restarted" every
  minute while the tunnel stays down. Fix is server-side (`systemctl restart
  frps`; Aliyun console → 云助手 can send the command without SSH). Diagnose
  by watching `/private/tmp/frpc-watchdog.log` vs `/private/tmp/frpc.log`.
- **cloudflared restart blips all CF-hosted sites** on this machine (~2-3 s)
  — the one `com.fairme.cloudflared.ai-insights` agent carries every
  `*.fairme.cc.cd` ingress; warn before restarting it.
- **LAN DNS negative cache**: new CF hostnames resolve via public resolvers
  minutes before a LAN resolver (10.x) stops answering NXDOMAIN. Always
  verify with `curl --resolve` before assuming the tunnel is broken.
- **UI symptom "An unexpected error occurred"** (logs page) is RTK Query's
  fallback message for `FETCH_ERROR` — network-level drops, not server
  errors. If it appears on the frp channel but NOT on CF, suspect frps-side
  intermittent drops (Case #1). The logs page also polls every 10 s
  (`pollingInterval: 10000` in `logs/page.tsx`) and hits slow aggregates
  (`/api/logs/filterdata`, `/api/logs/stats?period=7d` can take 1-2 s on a
  17 GB logs.db), which makes every network blip visible as an error toast.

## Case #1 — frps intermittent connection drops (2026-09, FIXED)

A real incident, kept here as the diagnostic playbook. Symptom had TWO
distinct phases; do not confuse them:

**Phase 1 — frps fully down** (server reboot/hang): TCP connect to `:7000`
succeeds, ping OK, but frpc login times out (`connection write timeout`) and
exits instantly (`loginFailExit` defaults true), so frpc-watchdog restarts it
every 60 s forever ("restarted" in the log every minute) while the public
port stays dead. Fix is server-side: Aliyun console → 云助手 → `systemctl
restart frps` (no SSH needed).

**Phase 2 — frps up but intermittently dropping** (after Phase 1 fix):
Channel works most of the time, but fails in CLUSTERS lasting ~30 s:

- 100-request burst: first ~26 OK, then all fail with
  `Couldn't connect ... after 17 ms` — instant RST, NOT a timeout
- Control port `:7000` flaps **in sync** (`nc -z`: 10 ok / 10 FAIL)
- Same moment: local `:8090` and CF channel were 0-failure → isolate to
  server/link, not the local machine
- Self-heals in ~30 s; frpc-watchdog restarts frpc once in between
- UI effect: logs-page polling gets cut → "An unexpected error occurred"

**Diagnosis checklist** (run during a failure cluster):

```bash
# 1. cluster shape — failures should appear in runs, not scattered
for i in $(seq 1 100); do curl -s -o /dev/null -w "%{http_code} " \
  --max-time 5 http://47.112.174.22:38421/health; done; echo

# 2. control port in sync?
for i in $(seq 1 20); do nc -z -w 3 47.112.174.22 7000 && printf ok || printf FAIL; sleep 0.3; done

# 3. failure fingerprint: instant-RST (17 ms) vs timeout (max-time) —
#    RST ⇒ server/firewall actively rejecting; timeout ⇒ link loss
curl -sv -o /dev/null --max-time 6 http://47.112.174.22:38421/health 2>&1 | grep -E "Connected|Failed"

# 4. control-plane view
tail -5 /private/tmp/frpc-watchdog.log; tail -5 /private/tmp/frpc.log
```

Server-side (Aliyun console → 云助手, no SSH needed):
`systemctl status frps` and `journalctl -u frps --since "1 hour ago"`.

**Post-fix verification** (all must pass to call it fixed):

```bash
# a. 100-request burst — zero failures, no clusters
# b. 20× nc -z :7000               — 20/20 ok
# c. 50 samples @1 s               — 100% success, latency spread < ±10 ms
# d. 90 s sustained @3 s           — 30/30, max latency ≈ baseline
# e. concurrency 10×5 rounds       — 50/50 (simulates UI polling + SDK)
# f. frpc-watchdog log             — only "healthy" lines during the window
```

Verified 2026-09-06 after the user fixed frps on the server: 100/100 burst,
20/20 control port, 50/50 @ ~49 ms ±5 ms, 30/30 sustained, 50/50 concurrent,
watchdog untouched throughout.
