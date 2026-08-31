// Package secretredact implements a Bifrost LLM plugin that scans prompt and
// conversation content for leaked credentials (API keys, tokens, private keys,
// passwords) and rewrites them before the request is sent to the model provider.
//
// Redaction happens in PreRequestHook - the once-per-request phase whose
// mutations are committed to the request and observed by every subsequent
// plugin, the provider call, and every fallback attempt. The plugin is
// fail-open: it never blocks or fails a request, it only rewrites text.
//
// The plugin detects:
//   - PEM private key blocks (header through footer, multiline)
//   - AI/LLM provider keys (OpenAI, Anthropic, OpenRouter, Hugging Face, Perplexity)
//   - Cloud credentials (AWS access key IDs, Google API keys)
//   - Source control and registry tokens (GitHub, GitLab, npm, PyPI)
//   - SaaS tokens (Slack, Stripe, SendGrid, Telegram)
//   - JWTs
//   - Context-dependent leaks (Authorization: Bearer ..., user:pass@host URLs,
//     key=value assignments) guarded by a Shannon-entropy floor to avoid
//     flagging placeholders such as "your-api-key-here"
//
// Custom rules can be added via config. Known false positives can be allowlisted
// with substring keywords.
package secretredact

import (
	"fmt"
	"strings"
	"sync/atomic"

	"github.com/maximhq/bifrost/core/schemas"
)

// PluginName is the identifier used in config.json's plugins array and the
// plugin management API.
const PluginName = "secretredact"

// defaultPlaceholderTemplate is the replacement used when Config.Placeholder is
// empty. The {rule} marker is substituted with the rule ID that fired, which
// makes false positives debuggable without ever logging the secret itself.
const defaultPlaceholderTemplate = "[REDACTED:{rule}]"

// Config is the plugin configuration, supplied via config.json:
//
//	"plugins": [{
//	  "name": "secretredact",
//	  "enabled": true,
//	  "config": {
//	    "ignored_keywords": ["example", "dummy"],
//	    "custom_rules": [{ "id": "internal-key", "pattern": "acme_[A-Za-z0-9]{20,}" }]
//	  }
//	}]
//
// The plugin-level "enabled" flag on the PluginConfig gates registration; this
// struct configures behavior once registered.
type Config struct {
	// Placeholder is the replacement text for detected secrets. It may contain
	// the {rule} marker, which is substituted with the rule ID that fired.
	// Default: "[REDACTED:{rule}]".
	Placeholder string `json:"placeholder,omitempty"`

	// IgnoredKeywords lists substrings (case-insensitive) that suppress a
	// detection when contained in the matched value. Use it to allowlist stable
	// test fixtures such as "example" or "dummy". Keep it narrow: a broad entry
	// can hide real leaks.
	IgnoredKeywords []string `json:"ignored_keywords,omitempty"`

	// CustomRules adds organization-specific regex rules on top of (or instead
	// of, see DisableDefaults) the built-in set.
	CustomRules []CustomRule `json:"custom_rules,omitempty"`

	// DisableDefaults turns off the built-in rule set so only CustomRules run.
	DisableDefaults bool `json:"disable_defaults,omitempty"`

	// MinEntropy overrides the Shannon-entropy floor (bits per byte) applied to
	// the entropy-gated built-in rules (bearer tokens, basic-auth URLs, generic
	// key=value assignments). 0 keeps the per-rule defaults (3.5, or 3.0 for
	// basic-auth URLs). Raising it reduces false positives; lowering it catches
	// lower-entropy secrets at the cost of noisier rewrites. It does not affect
	// literal-prefix rules (sk-..., ghp_..., AKIA...) or custom rules.
	MinEntropy float64 `json:"min_entropy,omitempty"`
}

// Plugin implements schemas.LLMPlugin. It is safe for concurrent use: rules are
// immutable after Init and statistics use atomics.
type Plugin struct {
	config          Config
	rules           []compiledRule
	ruleHits        []atomic.Int64
	placeholderTpl  string
	ignoredKeywords []string
	logger          schemas.Logger

	requestsScanned atomic.Int64
	secretsRedacted atomic.Int64
}

// Init creates a new plugin instance. It compiles and validates all rules
// (built-in and custom) up front so the per-request path never sees a regex
// error.
func Init(config *Config, logger schemas.Logger) (*Plugin, error) {
	if config == nil {
		config = &Config{}
	}

	specs := make([]ruleSpec, 0, len(defaultRuleSpecs)+len(config.CustomRules))
	if !config.DisableDefaults {
		specs = append(specs, defaultRuleSpecs...)
	}

	rules, err := compileRuleSpecs(specs)
	if err != nil {
		return nil, err
	}

	customRules, err := compileCustomRules(config.CustomRules)
	if err != nil {
		return nil, err
	}
	rules = append(rules, customRules...)

	// Apply the global entropy override to built-in entropy-gated rules.
	if config.MinEntropy > 0 {
		for i := range rules {
			if rules[i].minEntropy > 0 {
				rules[i].minEntropy = config.MinEntropy
			}
		}
	}

	placeholder := config.Placeholder
	if placeholder == "" {
		placeholder = defaultPlaceholderTemplate
	}

	return &Plugin{
		config:          *config,
		rules:           rules,
		ruleHits:        make([]atomic.Int64, len(rules)),
		placeholderTpl:  placeholder,
		ignoredKeywords: normalizeIgnoredKeywords(config.IgnoredKeywords),
		logger:          logger,
	}, nil
}

// GetName returns the plugin identifier.
func (p *Plugin) GetName() string {
	return PluginName
}

// Cleanup resets statistics. Compiled rules are kept; the plugin registry drops
// the instance on unload.
func (p *Plugin) Cleanup() error {
	p.requestsScanned.Store(0)
	p.secretsRedacted.Store(0)
	for i := range p.ruleHits {
		p.ruleHits[i].Store(0)
	}
	return nil
}

// Stats is a point-in-time snapshot of plugin counters.
type Stats struct {
	RequestsScanned int64            `json:"requests_scanned"` // prompt-bearing requests seen
	SecretsRedacted int64            `json:"secrets_redacted"` // total replacements applied
	RuleHits        map[string]int64 `json:"rule_hits"`        // replacements per rule ID
}

// GetStats returns a snapshot of plugin statistics.
func (p *Plugin) GetStats() Stats {
	stats := Stats{
		RequestsScanned: p.requestsScanned.Load(),
		SecretsRedacted: p.secretsRedacted.Load(),
		RuleHits:        make(map[string]int64, len(p.rules)),
	}
	for i := range p.rules {
		if hits := p.ruleHits[i].Load(); hits > 0 {
			stats.RuleHits[p.rules[i].id] = hits
		}
	}
	return stats
}

// PreRequestHook is the redaction phase. It runs once per top-level request,
// before any PreLLMHook and before routing decisions commit, and its mutations
// are observed by every subsequent plugin, the provider call, and all fallback
// attempts. Redaction is fail-open: this hook never aborts a request.
func (p *Plugin) PreRequestHook(ctx *schemas.BifrostContext, req *schemas.BifrostRequest) error {
	if req == nil {
		return nil
	}

	var total int
	scanned := true
	switch {
	case req.ChatRequest != nil:
		total = p.redactChatRequest(ctx, req.ChatRequest)
	case req.TextCompletionRequest != nil:
		total = p.redactTextCompletionRequest(ctx, req.TextCompletionRequest)
	case req.ResponsesRequest != nil:
		total = p.redactResponsesRequest(ctx, req.ResponsesRequest)
	case req.CountTokensRequest != nil:
		total = p.redactResponsesRequest(ctx, req.CountTokensRequest)
	case req.CompactionRequest != nil:
		total = p.redactCompactionRequest(req.CompactionRequest)
	case req.EmbeddingRequest != nil:
		total = p.redactEmbeddingRequest(ctx, req.EmbeddingRequest)
	default:
		scanned = false
	}

	if !scanned {
		return nil
	}
	p.requestsScanned.Add(1)
	if total > 0 {
		p.secretsRedacted.Add(int64(total))
		if p.logger != nil {
			p.logger.Warn("secretredact: redacted %d secret(s) from %s request", total, string(req.RequestType))
		}
	}
	return nil
}

// PreLLMHook passes the request through unchanged. Redaction already happened
// in PreRequestHook; keeping this hook a no-op avoids re-running rules once per
// fallback attempt.
func (p *Plugin) PreLLMHook(_ *schemas.BifrostContext, req *schemas.BifrostRequest) (*schemas.BifrostRequest, *schemas.LLMPluginShortCircuit, error) {
	return req, nil, nil
}

// PostLLMHook passes the response through unchanged. Output-side redaction
// (model echoing a secret back) is not covered by this plugin.
func (p *Plugin) PostLLMHook(_ *schemas.BifrostContext, resp *schemas.BifrostResponse, bifrostErr *schemas.BifrostError) (*schemas.BifrostResponse, *schemas.BifrostError, error) {
	return resp, bifrostErr, nil
}

// --- request traversal ---

// redactChatRequest rewrites secrets in chat message content (string form and
// content-block form), plus the raw request body when raw-body passthrough is
// enabled on the context.
func (p *Plugin) redactChatRequest(ctx *schemas.BifrostContext, cr *schemas.BifrostChatRequest) int {
	if cr == nil {
		return 0
	}
	total := 0
	for i := range cr.Input {
		content := cr.Input[i].Content
		if content == nil {
			continue
		}
		total += p.redactStringPtr(&content.ContentStr)
		for j := range content.ContentBlocks {
			block := &content.ContentBlocks[j]
			total += p.redactStringPtr(&block.Text)
			total += p.redactStringPtr(&block.Refusal)
		}
	}
	total += p.redactRawBody(ctx, &cr.RawRequestBody)
	return total
}

// redactTextCompletionRequest rewrites secrets in the completion prompt.
func (p *Plugin) redactTextCompletionRequest(ctx *schemas.BifrostContext, tc *schemas.BifrostTextCompletionRequest) int {
	if tc == nil {
		return 0
	}
	total := p.redactStringPtr(&tc.Input.PromptStr)
	for i := range tc.Input.PromptArray {
		if rewritten, n := p.redactString(tc.Input.PromptArray[i]); n > 0 {
			tc.Input.PromptArray[i] = rewritten
			total += n
		}
	}
	total += p.redactRawBody(ctx, &tc.RawRequestBody)
	return total
}

// redactResponsesRequest rewrites secrets in Responses API input messages.
// It also covers CountTokensRequest, which shares the request type.
func (p *Plugin) redactResponsesRequest(ctx *schemas.BifrostContext, rr *schemas.BifrostResponsesRequest) int {
	if rr == nil {
		return 0
	}
	total := p.redactResponsesMessages(rr.Input)
	total += p.redactRawBody(ctx, &rr.RawRequestBody)
	return total
}

// redactCompactionRequest rewrites secrets in compaction input and instructions.
func (p *Plugin) redactCompactionRequest(cr *schemas.BifrostCompactionRequest) int {
	if cr == nil {
		return 0
	}
	total := p.redactResponsesMessages(cr.Input)
	total += p.redactStringPtr(&cr.Instructions)
	return total
}

// redactEmbeddingRequest rewrites secrets in embedding text input.
func (p *Plugin) redactEmbeddingRequest(ctx *schemas.BifrostContext, er *schemas.BifrostEmbeddingRequest) int {
	if er == nil || er.Input == nil {
		return 0
	}
	total := p.redactStringPtr(&er.Input.Text)
	for i := range er.Input.Texts {
		if rewritten, n := p.redactString(er.Input.Texts[i]); n > 0 {
			er.Input.Texts[i] = rewritten
			total += n
		}
	}
	total += p.redactRawBody(ctx, &er.RawRequestBody)
	return total
}

// redactResponsesMessages rewrites secrets across Responses API message content.
func (p *Plugin) redactResponsesMessages(messages []schemas.ResponsesMessage) int {
	total := 0
	for i := range messages {
		content := messages[i].Content
		if content == nil {
			continue
		}
		total += p.redactStringPtr(&content.ContentStr)
		for j := range content.ContentBlocks {
			total += p.redactStringPtr(&content.ContentBlocks[j].Text)
		}
	}
	return total
}

// redactRawBody rewrites secrets in the raw request body, but only when
// raw-body passthrough is enabled on the context - otherwise the parsed input
// is authoritative and the bytes are never sent to the provider.
//
// Limitation: values that are JSON-escaped in the raw bytes (e.g. \u0041) will
// not match their regex form; the placeholder contains no characters requiring
// escaping, so rewrites never break JSON validity.
func (p *Plugin) redactRawBody(ctx *schemas.BifrostContext, raw *[]byte) int {
	if raw == nil || *raw == nil {
		return 0
	}
	if useRaw, ok := ctx.Value(schemas.BifrostContextKeyUseRawRequestBody).(bool); !ok || !useRaw {
		return 0
	}
	rewritten, n := p.redactString(string(*raw))
	if n > 0 {
		*raw = []byte(rewritten)
	}
	return n
}

// --- core rewriting ---

// redactString applies every rule in order. Rules run sequentially over the
// already-rewritten text, so a match claimed by an earlier rule (e.g.
// anthropic-api-key) cannot be re-matched by a later, more generic one
// (openai-api-key). The rewrite is idempotent: placeholders contain brackets
// and colons that no rule's character class matches.
func (p *Plugin) redactString(s string) (string, int) {
	if s == "" {
		return s, 0
	}
	total := 0
	for i := range p.rules {
		var n int
		s, n = p.applyRule(s, &p.rules[i], &p.ruleHits[i])
		total += n
	}
	return s, total
}

// applyRule rewrites all non-overlapping matches of one rule. When the rule has
// a redact group, only that capture group is replaced so surrounding context
// (the key name in `api_key: "..."`, the scheme in `user:pass@host`) survives
// and the request stays parseable.
func (p *Plugin) applyRule(s string, rule *compiledRule, hits *atomic.Int64) (string, int) {
	matches := rule.re.FindAllStringSubmatchIndex(s, -1)
	if len(matches) == 0 {
		return s, 0
	}

	var b strings.Builder
	b.Grow(len(s))
	last := 0
	count := 0
	for _, m := range matches {
		start, end := m[0], m[1]
		if rule.redactGroup > 0 && 2*rule.redactGroup+1 < len(m) && m[2*rule.redactGroup] >= 0 {
			start, end = m[2*rule.redactGroup], m[2*rule.redactGroup+1]
		}
		if !p.shouldRedact(rule, s[start:end]) {
			continue
		}
		b.WriteString(s[last:start])
		b.WriteString(p.placeholderFor(rule.id))
		last = end
		count++
	}
	if count == 0 {
		return s, 0
	}
	b.WriteString(s[last:])
	hits.Add(int64(count))
	return b.String(), count
}

// shouldRedact applies the entropy floor and the ignored-keyword allowlist to a
// matched value.
func (p *Plugin) shouldRedact(rule *compiledRule, value string) bool {
	if rule.minEntropy > 0 && shannonEntropy(value) < rule.minEntropy {
		return false
	}
	if len(p.ignoredKeywords) > 0 {
		lower := strings.ToLower(value)
		for _, keyword := range p.ignoredKeywords {
			if strings.Contains(lower, keyword) {
				return false
			}
		}
	}
	return true
}

// placeholderFor resolves the replacement text for a rule, substituting the
// {rule} marker when the configured placeholder template contains it.
func (p *Plugin) placeholderFor(ruleID string) string {
	if strings.Contains(p.placeholderTpl, "{rule}") {
		return strings.ReplaceAll(p.placeholderTpl, "{rule}", ruleID)
	}
	return p.placeholderTpl
}

// redactStringPtr rewrites a *string field in place (by replacing the pointer,
// never by writing through it, so aliased values elsewhere are untouched).
func (p *Plugin) redactStringPtr(sp **string) int {
	if sp == nil || *sp == nil {
		return 0
	}
	rewritten, n := p.redactString(**sp)
	if n > 0 {
		*sp = &rewritten
	}
	return n
}

// Compile-time interface conformance check.
var _ schemas.LLMPlugin = (*Plugin)(nil)

// String renders a compact description for logs.
func (p *Plugin) String() string {
	return fmt.Sprintf("%s (rules: %d)", PluginName, len(p.rules))
}
