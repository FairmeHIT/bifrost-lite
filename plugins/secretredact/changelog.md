# Changelog

## v1.0.0

- Initial release.
- `PreRequestHook`-phase redaction of leaked credentials in chat, responses,
  text completion, compaction, and embedding request content, committed before
  routing so all fallback attempts see the redacted text.
- Built-in rule set: PEM private key blocks, AI/LLM provider keys (OpenAI,
  Anthropic, OpenRouter, Hugging Face, Perplexity), AWS access key IDs, Google
  API keys, GitHub/GitLab/npm/PyPI tokens, Slack/Stripe/SendGrid/Telegram
  tokens, JWTs, and entropy-gated context rules (Bearer tokens, basic-auth
  URLs, generic key=value assignments).
- Shannon-entropy gating (configurable floor) to avoid rewriting
  placeholder-shaped values.
- Custom regex rules with optional capture-group-scoped replacement and
  per-rule entropy gates.
- False-positive allowlist via `ignored_keywords`.
- Raw request body rewriting when raw-body passthrough is enabled.
- Statistics via `GetStats()`.
