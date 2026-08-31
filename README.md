# Bifrost Lite

> **Bifrost Lite** is a streamlined fork of [maximhq/bifrost](https://github.com/maximhq/bifrost) — a high-performance AI gateway that unifies access to 20+ LLM providers through a single OpenAI-compatible API — with all core gateway functionality preserved, plus a fully localized Chinese/English web UI.

## Key Differences from Upstream

### Removed (for a lighter, focused codebase)
- MCP Gateway (Model Context Protocol server)
- Plugins management UI (plugin engine still works via config)
- Alerting, Guardrails, Webhooks management
- Edge Control, Cluster Config, Adaptive Routing
- Prompt Repository, Skills Repository
- Enterprise demo booking, trial/contact forms

### Preserved
- **Core gateway** — inference, streaming, fallbacks, load balancing, key management
- **Governance** — virtual keys, teams, customers, budgets, rate limiting, RBAC
- **Observability** — logs, analytics, dashboards, Prometheus metrics, OTEL tracing
- **Provider configuration** — 20+ providers via UI, API, or config file
- **All plugins** — governance, logging, semantic cache, telemetry, mock, etc.
- **Web UI** — fully functional, with built-in English/Chinese language switching (default: Chinese), click-to-toggle language and theme controls

## Quick Start

### Build from source

```bash
# Clone the repository
git clone git@github.com:FairmeHIT/bifrost-lite-ops.git
cd bifrost-lite-ops

# Build (requires Go 1.26+, Node.js 22+)
make build LOCAL=1

# Run
./tmp/bifrost-http
```

The web UI is available at `http://localhost:8080`.

### Configure via Web UI

1. Open `http://localhost:8080` in your browser
2. Click **Dashboard** to view real-time metrics
3. Navigate to **Models → Providers** to add API keys
4. Navigate to **Governance → Virtual Keys** to create virtual keys for API access

### Make your first API call

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-bf-<your-virtual-key>" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Repository Structure

```
bifrost/
├── core/               # Core gateway — inference, streaming, provider interface
│   ├── providers/      # Provider implementations (OpenAI, Anthropic, Bedrock, …)
│   └── schemas/        # Shared types and interfaces
├── framework/          # Data persistence (configstore, logstore, vectorstore)
├── transports/         # HTTP gateway transport
│   └── bifrost-http/   # Web server, API handlers, embedded UI
├── ui/                 # React + Vite web interface (Chinese/English)
├── plugins/            # Extensible plugin system
│   ├── governance/     # Budget management, rate limiting, RBAC
│   ├── logging/        # Request/response logging
│   ├── secretredact/   # Secret detection & redaction before provider calls
│   ├── semanticcache/  # Semantic response caching
│   ├── telemetry/      # Prometheus metrics
│   └── …
├── docs/               # Documentation
└── tests/              # Test suites
```

## Key Features (Preserved)

- **Unified API** — Single OpenAI-compatible API for all providers
- **Multi-Provider** — OpenAI, Anthropic, AWS Bedrock, Google Vertex, Azure, and 15+ more
- **Automatic Fallbacks** — Seamless failover between providers and models
- **Load Balancing** — Weighted distribution across multiple API keys
- **Governance** — Virtual keys, teams, customers, budgets, rate limiting
- **Observability** — Real-time dashboard, logs, Prometheus metrics, OTEL tracing
- **Semantic Caching** — Reduce costs with intelligent response caching
- **Web UI** — Full configuration via browser, with English/Chinese language toggle
- **Secrets Management** — Environment variable and deployment secret references

## Localization

The web UI supports both English and Chinese. Language can be toggled at the bottom-left of the sidebar. Configuration is persisted in localStorage.

- Default language: Chinese (中文)
- Toggle: click the **中/EN** button in the sidebar footer
- Scope: all pages, including form validation messages, export dialogs, and toast notifications

## Development

```bash
# Start development environment (UI + API with hot reload)
make dev

# Start UI dev server only (separate API needed)
cd ui && npm run dev

# Type check
cd ui && npx tsc --noEmit

# Build production binary
make build LOCAL=1
```

## License

Apache 2.0 — see [LICENSE](LICENSE).