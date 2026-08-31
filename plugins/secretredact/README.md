# secretredact

A Bifrost LLM plugin that scans prompt and conversation content for leaked
credentials - API keys, tokens, private keys, passwords - and rewrites them
**before the request is sent to the model provider**. Fully local, no external
service, no per-request cost. It is the open-source equivalent of the
enterprise Guardrails "Secrets Detection" runtime redaction: detect, rewrite,
never block.

## How it works

Redaction runs in `PreRequestHook` - the once-per-request plugin phase whose
mutations are committed before routing and are observed by every subsequent
plugin, the provider call, and **every fallback attempt**. The plugin is
fail-open: it never blocks, rejects, or fails a request; it only rewrites text
in place.

Covered request shapes:

| Request | Redacted fields |
|---|---|
| Chat Completions (+stream) | every message's `Content` string, text/refusal content blocks, raw body* |
| Responses API (+stream), CountTokens | input message content strings and text blocks, raw body* |
| Text Completions (+stream) | `prompt` string and prompt array, raw body* |
| Compaction | input messages + `instructions` |
| Embeddings | input text / texts, raw body* |

\* The raw request body is rewritten only when raw-body passthrough
(`x-bf-use-raw-request-body`) is enabled on the request context, because that
is the only mode where the raw bytes are what gets sent to the provider.

## Built-in rules

222-rule gitleaks parity is *not* the goal here; this is a curated set of
high-precision rules. Order matters - rules run in sequence over the rewritten
text, so specific prefixes (anthropic) claim matches before generic ones
(openai):

- **PEM private key blocks** (header through footer, multiline)
- **AI/LLM keys**: OpenAI (`sk-`, `sk-proj-`), Anthropic (`sk-ant-`), OpenRouter, Hugging Face, Perplexity
- **Cloud**: AWS access key IDs, Google API keys
- **Source control / registries**: GitHub (classic + fine-grained PATs), GitLab, npm, PyPI
- **SaaS**: Slack tokens + webhook URLs, Stripe live keys, SendGrid, Telegram bot tokens
- **JWTs** (three-segment `eyJ...`)
- **Context-dependent**, entropy-gated: `Authorization: Bearer <token>`, `user:pass@host` URLs, and `key=value` assignments (`api_key`, `secret`, `token`, `password`, ...)

The entropy gate (Shannon entropy, default 3.5 bits/char, 3.0 for basic-auth
URLs) keeps placeholder-shaped strings such as `your-api-key-here` or
`changeme123456789` from being rewritten while still catching random secrets.

## Configuration

```json
{
  "plugins": [
    {
      "name": "secretredact",
      "enabled": true,
      "config": {
        "placeholder": "[REDACTED:{rule}]",
        "ignored_keywords": ["example", "dummy"],
        "min_entropy": 3.5,
        "custom_rules": [
          { "id": "internal-key", "pattern": "acme_[A-Za-z0-9]{20,}" },
          { "id": "kv", "pattern": "license_key[\"']?\\s*[:=]\\s*[\"']?([A-Za-z0-9]{16,})[\"']?", "redact_group": 1 }
        ],
        "disable_defaults": false
      }
    }
  ]
}
```

| Field | Default | Description |
|---|---|---|
| `placeholder` | `[REDACTED:{rule}]` | Replacement text. `{rule}` substitutes the rule ID that fired; omit it for a verbatim placeholder. |
| `ignored_keywords` | `[]` | Substrings (case-insensitive) that suppress a detection when contained in the matched value. Keep narrow - broad entries hide real leaks. |
| `min_entropy` | `3.5` | Overrides the entropy floor for the built-in entropy-gated rules. Does not affect literal-prefix rules or custom rules. |
| `custom_rules` | `[]` | Extra regex rules (Go RE2). `redact_group` replaces only that capture group (1-based), keeping surrounding text parseable; `min_entropy` gates the rule by value entropy. |
| `disable_defaults` | `false` | Run only `custom_rules`. |

## Statistics

The plugin exposes `GetStats()` (also visible via the plugin management API
status):

```json
{
  "requests_scanned": 1204,
  "secrets_redacted": 7,
  "rule_hits": { "github-token": 4, "generic-secret-assignment": 3 }
}
```

## Design notes and limitations

- **Never logs secret values.** Only counts, rule IDs, and request types are
  logged (one `Warn` line per request that had redactions).
- **Idempotent.** Placeholders contain characters (`[`, `:`, `]`) that no rule
  character class matches, so re-running the pipeline (e.g. fallback attempts,
  retries) never double-redacts.
- **Fail-open by design.** A regex engine error or unexpected payload shape
  never blocks traffic. If you need blocking, that is governance territory.
- **Output is not redacted.** The plugin covers request content only; a model
  echoing a secret back is out of scope.
- **Tool-call arguments are not rewritten** (only message content). Tool
  arguments arrive as JSON strings and are a natural follow-up.
- **JSON-escaped values in raw bodies** (e.g. `\u0041`) will not match their
  regex form; the placeholder itself never requires JSON escaping, so
  rewrites cannot corrupt the body.
- **Text-based only** - image, audio, and file blocks are not inspected.
