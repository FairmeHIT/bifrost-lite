package secretredact

import (
	"strings"
	"testing"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

func newTestCtx(t *testing.T) *schemas.BifrostContext {
	t.Helper()
	return schemas.NewBifrostContext(nil, time.Now().Add(time.Minute))
}

func strPtr(s string) *string { return &s }

func rolePtr(r schemas.ResponsesMessageRoleType) *schemas.ResponsesMessageRoleType { return &r }

// --- redactString: rule coverage ---

func TestRedactStringRuleCoverage(t *testing.T) {
	plugin, err := Init(&Config{}, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	cases := []struct {
		name     string
		input    string
		contains string // placeholder fragment expected in output
		notWant  string // raw secret fragment that must be gone
	}{
		{
			name:     "openai key",
			input:    "my key is sk-abc123def456ghi789jklmno456pqrstuvwxyztuvwxyzab",
			contains: "[REDACTED:openai-api-key]",
			notWant:  "sk-abc123def456",
		},
		{
			name:     "anthropic key takes precedence over openai rule",
			input:    "use sk-ant-api03-AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIII",
			contains: "[REDACTED:anthropic-api-key]",
			notWant:  "sk-ant-api03-AAAABBBB",
		},
		{
			name:     "github pat",
			input:    "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl",
			contains: "[REDACTED:github-token]",
			notWant:  "ghp_ABCDEFGHIJ",
		},
		{
			name:     "aws access key id",
			input:    "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
			contains: "[REDACTED:aws-access-key-id]",
			notWant:  "AKIAIOSFODNN7",
		},
		{
			name:     "slack bot token",
			input:    "xoxb-123456789012-1234567890123-AbCdEfGhIjKlMnOpQrStUvWx",
			contains: "[REDACTED:slack-token]",
			notWant:  "xoxb-123456789012",
		},
		{
			name:     "jwt",
			input:    "jwt: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c",
			contains: "[REDACTED:jwt]",
			notWant:  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
		},
		{
			name:  "private key block",
			input: "here is my key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA7x9zTF5m\n-----END RSA PRIVATE KEY-----\nuse it wisely",
			// Whole block (header+body+footer) collapses into the placeholder.
			contains: "[REDACTED:private-key-block]",
			notWant:  "MIIEpAIBAAKCAQEA7x9zTF5m",
		},
		{
			name:     "google api key",
			input:    "key=AIzaSyA1234567890abcdefghijklmnopqrstuvw",
			contains: "[REDACTED:google-api-key]",
			notWant:  "AIzaSyA1234567890",
		},
		{
			name:     "generic assignment keeps the key name",
			input:    `config says api_key = "Zr43tNq8vXwYpL2sD9cB"`,
			contains: `api_key = "[REDACTED:generic-secret-assignment]"`,
			notWant:  "Zr43tNq8vXwYpL2sD9cB",
		},
		{
			name:     "bearer token keeps the scheme",
			input:    "Authorization: Bearer abcdef1234567890ABCDEF1234567890abcdef",
			contains: "Authorization: Bearer [REDACTED:bearer-token]",
			notWant:  "abcdef1234567890ABCDEF",
		},
		{
			name:     "basic auth url keeps the user and host",
			input:    "postgres://admin:s3cr3tP4ssw0rd@db.example.com:5432/prod",
			contains: "postgres://admin:[REDACTED:basic-auth-url]@db.example.com:5432/prod",
			notWant:  "s3cr3tP4ssw0rd",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, n := plugin.redactString(tc.input)
			if n == 0 {
				t.Fatalf("expected at least one redaction, got none; output: %q", out)
			}
			if !strings.Contains(out, tc.contains) {
				t.Errorf("output missing %q; got: %q", tc.contains, out)
			}
			if strings.Contains(out, tc.notWant) {
				t.Errorf("output still contains raw secret fragment %q; got: %q", tc.notWant, out)
			}
		})
	}
}

func TestRedactStringEntropyGate(t *testing.T) {
	plugin, err := Init(&Config{}, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// Placeholder-shaped values below the entropy floor must survive.
	clean := `api_key: "your-api-key-here"`
	if out, n := plugin.redactString(clean); n != 0 {
		t.Errorf("low-entropy placeholder value was redacted (n=%d): %q", n, out)
	}

	// High-entropy value in the same shape must be redacted.
	secret := `api_key: "Zr43tNq8vXwYpL2sD9cB"`
	if out, n := plugin.redactString(secret); n != 1 {
		t.Errorf("high-entropy value should be redacted exactly once, got n=%d: %q", n, out)
	}
}

func TestRedactIdempotent(t *testing.T) {
	plugin, _ := Init(&Config{}, bifrost.NewNoOpLogger())
	input := "key sk-abc123def456ghi789jklmno456pqrstuvwxyztuvwxyzab and ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl"

	once, _ := plugin.redactString(input)
	twice, n := plugin.redactString(once)
	if n != 0 {
		t.Errorf("second pass redacted %d additional value(s); placeholders must not re-match: %q", n, twice)
	}
	if once != twice {
		t.Errorf("redaction not idempotent:\nfirst:  %q\nsecond: %q", once, twice)
	}
}

func TestIgnoredKeywords(t *testing.T) {
	plugin, err := Init(&Config{
		IgnoredKeywords: []string{"example", " DUMMY "},
	}, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// AKIA...EXAMPLE matches aws-access-key-id but contains the ignored keyword.
	out, n := plugin.redactString("key: AKIAIOSFODNN7EXAMPLE")
	if n != 0 {
		t.Errorf("allowlisted value was redacted: %q", out)
	}

	// Entropy-gated generic rule with an ignored dummy value.
	out, n = plugin.redactString(`token: "DUMMYtOkEn12345678"`)
	if n != 0 {
		t.Errorf("ignored keyword should suppress detection (keywords are normalized to lowercase+trimmed), got: %q", out)
	}
}

func TestCustomRules(t *testing.T) {
	plugin, err := Init(&Config{
		CustomRules: []CustomRule{
			{ID: "internal-key", Pattern: `acme_[A-Za-z0-9]{20,}`},
			{ID: "kv", Pattern: `license_key["']?\s*[:=]\s*["']?([A-Za-z0-9]{16,})["']?`, RedactGroup: 1},
		},
	}, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	out, n := plugin.redactString("internal: acme_abcdefghij1234567890")
	if n != 1 || !strings.Contains(out, "[REDACTED:internal-key]") {
		t.Errorf("custom whole-match rule failed (n=%d): %q", n, out)
	}

	// license_key is deliberately not a built-in keyword, so only the custom
	// group rule can claim this match.
	out, n = plugin.redactString(`license_key: "AbCdEf1234567890"`)
	if n != 1 || !strings.Contains(out, `license_key: "[REDACTED:kv]"`) {
		t.Errorf("custom group rule failed (n=%d): %q", n, out)
	}
}

func TestDisableDefaults(t *testing.T) {
	plugin, err := Init(&Config{
		DisableDefaults: true,
		CustomRules:     []CustomRule{{ID: "only", Pattern: `acme_[A-Za-z0-9]{20,}`}},
	}, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	// Built-in rule no longer fires.
	if out, n := plugin.redactString("sk-abc123def456ghi789jklmno456pqrstuvwxyztuvwxyzab"); n != 0 {
		t.Errorf("defaults should be disabled, got redaction: %q", out)
	}
	// Custom rule still fires.
	if out, n := plugin.redactString("acme_abcdefghij1234567890"); n != 1 {
		t.Errorf("custom rule should fire, got n=%d: %q", n, out)
	}
}

func TestCustomPlaceholder(t *testing.T) {
	plugin, err := Init(&Config{
		Placeholder: "***SECRET***",
	}, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}
	out, _ := plugin.redactString("token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl")
	if !strings.Contains(out, "***SECRET***") {
		t.Errorf("custom placeholder not applied: %q", out)
	}
}

func TestInitErrors(t *testing.T) {
	if _, err := Init(&Config{CustomRules: []CustomRule{{ID: "bad", Pattern: `[unclosed`}}}, bifrost.NewNoOpLogger()); err == nil {
		t.Error("invalid regex should fail Init")
	}
	if _, err := Init(&Config{CustomRules: []CustomRule{{ID: "grp", Pattern: `no-group`, RedactGroup: 1}}}, bifrost.NewNoOpLogger()); err == nil {
		t.Error("redact_group exceeding capture group count should fail Init")
	}
	if _, err := Init(&Config{CustomRules: []CustomRule{{ID: "", Pattern: `x`}}}, bifrost.NewNoOpLogger()); err == nil {
		t.Error("empty custom rule id should fail Init")
	}
}

// --- PreRequestHook traversal across request types ---

func TestPreRequestHookChatRequest(t *testing.T) {
	plugin, _ := Init(&Config{}, bifrost.NewNoOpLogger())
	ctx := newTestCtx(t)

	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{
			Input: []schemas.ChatMessage{
				{
					Role:    schemas.ChatMessageRoleUser,
					Content: &schemas.ChatMessageContent{ContentStr: strPtr("deploy with key sk-abc123def456ghi789jklmno456pqrstuvwxyztuvwxyzab now")},
				},
				{
					Role: schemas.ChatMessageRoleUser,
					Content: &schemas.ChatMessageContent{
						ContentBlocks: []schemas.ChatContentBlock{
							{Type: schemas.ChatContentBlockTypeText, Text: strPtr("also ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl")},
						},
					},
				},
			},
		},
	}

	if err := plugin.PreRequestHook(ctx, req); err != nil {
		t.Fatalf("PreRequestHook returned error: %v", err)
	}

	got := *req.ChatRequest.Input[0].Content.ContentStr
	if strings.Contains(got, "sk-abc123def456") || !strings.Contains(got, "[REDACTED:openai-api-key]") {
		t.Errorf("string content not redacted: %q", got)
	}

	gotBlock := *req.ChatRequest.Input[1].Content.ContentBlocks[0].Text
	if strings.Contains(gotBlock, "ghp_ABCDEFGHIJ") || !strings.Contains(gotBlock, "[REDACTED:github-token]") {
		t.Errorf("content block not redacted: %q", gotBlock)
	}

	stats := plugin.GetStats()
	if stats.RequestsScanned != 1 || stats.SecretsRedacted != 2 {
		t.Errorf("stats mismatch: %+v", stats)
	}
}

func TestPreRequestHookResponsesRequest(t *testing.T) {
	plugin, _ := Init(&Config{}, bifrost.NewNoOpLogger())
	ctx := newTestCtx(t)

	req := &schemas.BifrostRequest{
		RequestType: schemas.ResponsesRequest,
		ResponsesRequest: &schemas.BifrostResponsesRequest{
			Input: []schemas.ResponsesMessage{
				{
					Role:    rolePtr(schemas.ResponsesInputMessageRoleUser),
					Content: &schemas.ResponsesMessageContent{ContentStr: strPtr("aws key AKIAJQ3EXAMPLE12345X")},
				},
				{
					Role: rolePtr(schemas.ResponsesInputMessageRoleUser),
					Content: &schemas.ResponsesMessageContent{
						ContentBlocks: []schemas.ResponsesMessageContentBlock{
							{Type: schemas.ResponsesInputMessageContentBlockTypeText, Text: strPtr("hf_" + strings.Repeat("x", 34))},
						},
					},
				},
			},
		},
	}

	if err := plugin.PreRequestHook(ctx, req); err != nil {
		t.Fatalf("PreRequestHook returned error: %v", err)
	}

	if got := *req.ResponsesRequest.Input[0].Content.ContentStr; strings.Contains(got, "AKIAJQ3EXAMPLE") {
		t.Errorf("responses string content not redacted: %q", got)
	}
	if got := *req.ResponsesRequest.Input[1].Content.ContentBlocks[0].Text; strings.Contains(got, "hf_xxxx") {
		t.Errorf("responses content block not redacted: %q", got)
	}
}

func TestPreRequestHookTextCompletion(t *testing.T) {
	plugin, _ := Init(&Config{}, bifrost.NewNoOpLogger())
	ctx := newTestCtx(t)

	req := &schemas.BifrostRequest{
		RequestType: schemas.TextCompletionRequest,
		TextCompletionRequest: &schemas.BifrostTextCompletionRequest{
			Input: &schemas.TextCompletionInput{
				PromptStr: strPtr("complete: glpat-ABCDEFGHIJKLMNOPQRSTUV"),
			},
		},
	}

	if err := plugin.PreRequestHook(ctx, req); err != nil {
		t.Fatalf("PreRequestHook returned error: %v", err)
	}
	if got := *req.TextCompletionRequest.Input.PromptStr; !strings.Contains(got, "[REDACTED:gitlab-token]") {
		t.Errorf("text completion prompt not redacted: %q", got)
	}
}

func TestPreRequestHookEmbedding(t *testing.T) {
	plugin, _ := Init(&Config{}, bifrost.NewNoOpLogger())
	ctx := newTestCtx(t)

	req := &schemas.BifrostRequest{
		RequestType: schemas.EmbeddingRequest,
		EmbeddingRequest: &schemas.BifrostEmbeddingRequest{
			Input: &schemas.EmbeddingInput{
				Texts: []string{"embed " + strings.Repeat("x", 31) + " sk-or-v1-" + strings.Repeat("a", 40)},
			},
		},
	}

	if err := plugin.PreRequestHook(ctx, req); err != nil {
		t.Fatalf("PreRequestHook returned error: %v", err)
	}
	if got := req.EmbeddingRequest.Input.Texts[0]; strings.Contains(got, "sk-or-v1-aaaa") {
		t.Errorf("embedding text not redacted: %q", got)
	}
}

func TestPreRequestHookRawBody(t *testing.T) {
	plugin, _ := Init(&Config{}, bifrost.NewNoOpLogger())
	raw := []byte(`{"model":"gpt-4o","messages":[{"role":"user","content":"key: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl"}]}`)

	t.Run("raw mode enabled rewrites bytes", func(t *testing.T) {
		ctx := newTestCtx(t)
		ctx.SetValue(schemas.BifrostContextKeyUseRawRequestBody, true)
		req := &schemas.BifrostRequest{
			RequestType: schemas.ChatCompletionRequest,
			ChatRequest: &schemas.BifrostChatRequest{RawRequestBody: append([]byte(nil), raw...)},
		}
		if err := plugin.PreRequestHook(ctx, req); err != nil {
			t.Fatalf("PreRequestHook returned error: %v", err)
		}
		if strings.Contains(string(req.ChatRequest.RawRequestBody), "ghp_ABCDEFGHIJ") {
			t.Errorf("raw body not redacted: %s", req.ChatRequest.RawRequestBody)
		}
	})

	t.Run("raw mode off leaves bytes untouched", func(t *testing.T) {
		ctx := newTestCtx(t) // no UseRawRequestBody value
		req := &schemas.BifrostRequest{
			RequestType: schemas.ChatCompletionRequest,
			ChatRequest: &schemas.BifrostChatRequest{RawRequestBody: append([]byte(nil), raw...)},
		}
		if err := plugin.PreRequestHook(ctx, req); err != nil {
			t.Fatalf("PreRequestHook returned error: %v", err)
		}
		if !strings.Contains(string(req.ChatRequest.RawRequestBody), "ghp_ABCDEFGHIJ") {
			t.Errorf("raw body should be untouched when raw mode is off: %s", req.ChatRequest.RawRequestBody)
		}
	})
}

func TestInitNilConfigDefaults(t *testing.T) {
	// Registration gating happens at the PluginConfig level (config.json
	// "enabled" flag); once the plugin is constructed it is on, and a nil
	// config selects all defaults.
	plugin, err := Init(nil, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init(nil) failed: %v", err)
	}
	ctx := newTestCtx(t)

	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{
			Input: []schemas.ChatMessage{{
				Role:    schemas.ChatMessageRoleUser,
				Content: &schemas.ChatMessageContent{ContentStr: strPtr("sk-abc123def456ghi789jklmno456pqrstuvwxyztuvwxyzab")},
			}},
		},
	}

	if err := plugin.PreRequestHook(ctx, req); err != nil {
		t.Fatalf("PreRequestHook returned error: %v", err)
	}
	if got := *req.ChatRequest.Input[0].Content.ContentStr; !strings.Contains(got, "[REDACTED:openai-api-key]") {
		t.Errorf("nil-config plugin should redact with defaults: %q", got)
	}
}

func TestPreRequestHookNilAndUnsupported(t *testing.T) {
	plugin, _ := Init(&Config{}, bifrost.NewNoOpLogger())
	ctx := newTestCtx(t)

	// nil request must not panic.
	if err := plugin.PreRequestHook(ctx, nil); err != nil {
		t.Errorf("nil request should be a no-op, got error: %v", err)
	}

	// Request type without prompt content: not counted as scanned.
	req := &schemas.BifrostRequest{
		RequestType: schemas.ListModelsRequest,
		ListModelsRequest: &schemas.BifrostListModelsRequest{
			Provider: schemas.OpenAI,
		},
	}
	if err := plugin.PreRequestHook(ctx, req); err != nil {
		t.Errorf("list models request should be a no-op, got error: %v", err)
	}
	if stats := plugin.GetStats(); stats.RequestsScanned != 0 {
		t.Errorf("non-prompt request should not be counted: %+v", stats)
	}
}

// --- interface plumbing ---

func TestPluginInterfacePlumbing(t *testing.T) {
	plugin, err := Init(&Config{}, bifrost.NewNoOpLogger())
	if err != nil {
		t.Fatalf("Init failed: %v", err)
	}

	if plugin.GetName() != PluginName {
		t.Errorf("GetName() = %q, want %q", plugin.GetName(), PluginName)
	}

	var _ schemas.LLMPlugin = plugin // compile-time conformance

	// PreLLMHook passthrough.
	req := &schemas.BifrostRequest{RequestType: schemas.ChatCompletionRequest}
	gotReq, shortCircuit, err := plugin.PreLLMHook(newTestCtx(t), req)
	if gotReq != req || shortCircuit != nil || err != nil {
		t.Errorf("PreLLMHook should be a passthrough, got req=%v shortCircuit=%v err=%v", gotReq, shortCircuit, err)
	}

	// PostLLMHook passthrough with nil resp and nil error.
	resp, bifrostErr, err := plugin.PostLLMHook(newTestCtx(t), nil, nil)
	if resp != nil || bifrostErr != nil || err != nil {
		t.Errorf("PostLLMHook should pass through nils, got resp=%v err=%v pluginErr=%v", resp, bifrostErr, err)
	}

	// Cleanup resets counters.
	if err := plugin.Cleanup(); err != nil {
		t.Errorf("Cleanup returned error: %v", err)
	}
	if stats := plugin.GetStats(); stats.RequestsScanned != 0 || stats.SecretsRedacted != 0 || len(stats.RuleHits) != 0 {
		t.Errorf("Cleanup should reset stats: %+v", stats)
	}
}

func TestDefaultRulesCompile(t *testing.T) {
	// Every built-in pattern must compile and respect its declared group count.
	if _, err := compileRuleSpecs(defaultRuleSpecs); err != nil {
		t.Fatalf("default rules failed to compile: %v", err)
	}
	// Order guarantee: anthropic before openai, jwt before bearer.
	idx := func(id string) int {
		for i, r := range defaultRuleSpecs {
			if r.ID == id {
				return i
			}
		}
		return -1
	}
	if idx("anthropic-api-key") >= idx("openai-api-key") {
		t.Error("anthropic-api-key must precede openai-api-key")
	}
	if idx("jwt") >= idx("bearer-token") {
		t.Error("jwt must precede bearer-token")
	}
}
