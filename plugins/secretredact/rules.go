package secretredact

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

// defaultMinEntropy is the Shannon entropy floor applied to rules that carry
// MinEntropy > 0. Values below gitleaks' generic-api-key threshold (3.5) let
// dictionary-shaped strings such as "your-api-key-here" through, so 3.5 is the
// default. Literal-prefix rules (sk-ant-..., ghp_..., AKIA...) do not use an
// entropy gate: their prefix is already proof of shape.
const defaultMinEntropy = 3.5

// ruleSpec is the declarative form of a detection rule before compilation.
// RedactGroup selects which capture group (1-based) is replaced; 0 replaces the
// whole match. Rules with RedactGroup > 0 keep surrounding context
// (`Authorization: Bearer <REDACTED>`) intact so the request stays parseable.
type ruleSpec struct {
	ID          string
	Pattern     string
	RedactGroup int
	MinEntropy  float64 // 0 = no entropy check; applies to the redacted value
}

// defaultRuleSpecs is the built-in rule set. Order is meaningful: rules run in
// sequence over the already-rewritten text, so more specific prefixes must come
// before generic ones (anthropic-api-key before openai-api-key, jwt before
// bearer-token) to claim their matches first. Patterns are Go RE2; no lookaheads.
var defaultRuleSpecs = []ruleSpec{
	// --- PEM private key blocks: header through footer, multiline ---
	{ID: "private-key-block", Pattern: `-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----(?s:.*?)-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----`},

	// --- AI/LLM provider keys ---
	// sk-ant- keys come in api01/api03/admin shapes; the sk-ant- prefix itself is
	// distinctive enough that matching its remainder broadly is safe, and this
	// rule must claim the match before the looser openai rule sees it.
	{ID: "anthropic-api-key", Pattern: `sk-ant-[A-Za-z0-9-]{20,}`},
	{ID: "openai-api-key", Pattern: `sk-(proj-)?[A-Za-z0-9_-]{32,}`},
	{ID: "openrouter-api-key", Pattern: `sk-or-(v1-)?[A-Za-z0-9]{32,}`},
	{ID: "huggingface-token", Pattern: `hf_[A-Za-z0-9]{30,}`},
	{ID: "perplexity-api-key", Pattern: `pplx-[A-Za-z0-9]{40,}`},

	// --- Cloud provider credentials ---
	{ID: "aws-access-key-id", Pattern: `\b(A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}\b`},
	{ID: "google-api-key", Pattern: `AIza[0-9A-Za-z_\-]{35}`},

	// --- Source control / CI tokens ---
	{ID: "github-token", Pattern: `gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}`},
	{ID: "gitlab-token", Pattern: `glpat-[A-Za-z0-9_-]{20,}`},
	{ID: "npm-token", Pattern: `npm_[A-Za-z0-9]{36}`},
	{ID: "pypi-token", Pattern: `pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}`},

	// --- SaaS / messaging / payments ---
	{ID: "slack-token", Pattern: `xox[baprse]-[A-Za-z0-9-]{10,}`},
	{ID: "slack-webhook-url", Pattern: `https://hooks\.slack\.com/services/T[A-Za-z0-9_]+/B[A-Za-z0-9_]+/[A-Za-z0-9]+`},
	{ID: "stripe-secret-key", Pattern: `\b(sk|rk)_live_[0-9a-zA-Z]{20,}\b`},
	{ID: "sendgrid-api-key", Pattern: `SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}`},
	{ID: "telegram-bot-token", Pattern: `\b[0-9]{8,10}:AA[A-Za-z0-9_-]{33}\b`},

	// --- Structured tokens ---
	{ID: "jwt", Pattern: `eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`},

	// --- Context-dependent rules: keyword + value, entropy-gated ---
	// Keep the key name, replace only the value (group 1).
	{ID: "bearer-token", Pattern: `(?i)bearer\s+([A-Za-z0-9_\-.=+/]{20,})`, RedactGroup: 1, MinEntropy: defaultMinEntropy},
	{ID: "basic-auth-url", Pattern: `(?i)[a-z0-9._%+-]+:([^\s@/'"<>]{6,})@[a-z0-9.-]+\.[a-z]{2,}`, RedactGroup: 1, MinEntropy: 3.0},
	{ID: "generic-secret-assignment", Pattern: `(?i)(?:api[_-]?key|apikey|secret|token|passwd|password|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["']?([A-Za-z0-9+/_=\-.]{16,})["']?`, RedactGroup: 1, MinEntropy: defaultMinEntropy},
}

// CustomRule is a user-supplied detection rule from plugin config.
type CustomRule struct {
	ID          string  `json:"id"`                     // Rule identifier used in the placeholder and stats
	Pattern     string  `json:"pattern"`                // Go RE2 regular expression
	RedactGroup int     `json:"redact_group,omitempty"` // Capture group to replace (1-based); 0 = whole match
	MinEntropy  float64 `json:"min_entropy,omitempty"`  // Shannon entropy floor for the redacted value; 0 = disabled
}

// compiledRule pairs a compiled regex with its replacement semantics.
type compiledRule struct {
	id          string
	re          *regexp.Regexp
	redactGroup int
	minEntropy  float64
}

// compileRuleSpecs compiles rule specs, returning an error naming the failing rule.
func compileRuleSpecs(specs []ruleSpec) ([]compiledRule, error) {
	compiled := make([]compiledRule, 0, len(specs))
	for _, spec := range specs {
		re, err := regexp.Compile(spec.Pattern)
		if err != nil {
			return nil, fmt.Errorf("rule %q: invalid pattern %q: %w", spec.ID, spec.Pattern, err)
		}
		if spec.RedactGroup > re.NumSubexp() {
			return nil, fmt.Errorf("rule %q: redact_group %d exceeds %d capture groups in pattern", spec.ID, spec.RedactGroup, re.NumSubexp())
		}
		compiled = append(compiled, compiledRule{
			id:          spec.ID,
			re:          re,
			redactGroup: spec.RedactGroup,
			minEntropy:  spec.MinEntropy,
		})
	}
	return compiled, nil
}

// compileCustomRules converts config-declared custom rules into compiledRule.
// Custom rules run AFTER the defaults so built-in precedence is preserved.
func compileCustomRules(rules []CustomRule) ([]compiledRule, error) {
	specs := make([]ruleSpec, 0, len(rules))
	for _, r := range rules {
		if r.ID == "" {
			return nil, fmt.Errorf("custom rule with empty id")
		}
		if r.Pattern == "" {
			return nil, fmt.Errorf("custom rule %q: empty pattern", r.ID)
		}
		specs = append(specs, ruleSpec{ID: r.ID, Pattern: r.Pattern, RedactGroup: r.RedactGroup, MinEntropy: r.MinEntropy})
	}
	return compileRuleSpecs(specs)
}

// shannonEntropy returns the Shannon entropy (bits per byte) of s.
// Random credentials score ~4-6; dictionary words and placeholders ~2.5-3.4.
func shannonEntropy(s string) float64 {
	if len(s) == 0 {
		return 0
	}
	var freq [256]int
	for i := 0; i < len(s); i++ {
		freq[s[i]]++
	}
	n := float64(len(s))
	var h float64
	for _, c := range freq {
		if c == 0 {
			continue
		}
		p := float64(c) / n
		h -= p * math.Log2(p)
	}
	return h
}

// normalizeIgnoredKeywords trims, lowercases, dedupes and drops empties so the
// allowlist check is a cheap substring test on the lowercased match.
func normalizeIgnoredKeywords(keywords []string) []string {
	seen := make(map[string]struct{}, len(keywords))
	out := make([]string, 0, len(keywords))
	for _, kw := range keywords {
		kw = strings.ToLower(strings.TrimSpace(kw))
		if kw == "" {
			continue
		}
		if _, ok := seen[kw]; ok {
			continue
		}
		seen[kw] = struct{}{}
		out = append(out, kw)
	}
	return out
}
