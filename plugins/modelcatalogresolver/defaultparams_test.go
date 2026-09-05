package modelcatalogresolver

import (
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

func f64ptr(v float64) *float64 { return &v }
func intptr(v int) *int         { return &v }
func strptr(v string) *string   { return &v }

func TestApplyChatDefaultParametersFillsUnsetOnly(t *testing.T) {
	chatReq := &schemas.BifrostChatRequest{
		Params: &schemas.ChatParameters{
			// caller explicitly set temperature — must survive
			Temperature: f64ptr(0.2),
		},
	}
	dp := &schemas.DefaultParameters{
		Temperature:        f64ptr(0.9), // must NOT overwrite 0.2
		TopP:               f64ptr(0.8),
		FrequencyPenalty:   f64ptr(0.1),
		MaxTokens:          intptr(4096),
		ReasoningEffort:    strptr("xhigh"),
		ReasoningMaxTokens: intptr(2000),
	}

	applied := applyChatDefaultParameters(chatReq, dp)

	if *chatReq.Params.Temperature != 0.2 {
		t.Errorf("temperature = %v, want caller's 0.2 untouched", *chatReq.Params.Temperature)
	}
	if chatReq.Params.TopP == nil || *chatReq.Params.TopP != 0.8 {
		t.Errorf("top_p not filled from default: %+v", chatReq.Params.TopP)
	}
	if chatReq.Params.FrequencyPenalty == nil || *chatReq.Params.FrequencyPenalty != 0.1 {
		t.Errorf("frequency_penalty not filled from default: %+v", chatReq.Params.FrequencyPenalty)
	}
	// DefaultParameters.MaxTokens maps to MaxCompletionTokens
	if chatReq.Params.MaxCompletionTokens == nil || *chatReq.Params.MaxCompletionTokens != 4096 {
		t.Errorf("max_completion_tokens not filled from default: %+v", chatReq.Params.MaxCompletionTokens)
	}
	if chatReq.Params.Reasoning == nil ||
		chatReq.Params.Reasoning.Effort == nil || *chatReq.Params.Reasoning.Effort != "xhigh" {
		t.Errorf("reasoning effort not filled from default: %+v", chatReq.Params.Reasoning)
	}
	if chatReq.Params.Reasoning == nil ||
		chatReq.Params.Reasoning.MaxTokens == nil || *chatReq.Params.Reasoning.MaxTokens != 2000 {
		t.Errorf("reasoning max_tokens not filled from default: %+v", chatReq.Params.Reasoning)
	}

	wantApplied := "frequency_penalty,max_completion_tokens,reasoning_effort,reasoning_max_tokens,top_p"
	if joined := joinSorted(applied); joined != wantApplied {
		t.Errorf("applied = %q, want %q", joined, wantApplied)
	}
}

func TestApplyChatDefaultParametersPreservesExplicitReasoning(t *testing.T) {
	chatReq := &schemas.BifrostChatRequest{
		Params: &schemas.ChatParameters{
			Reasoning: &schemas.ChatReasoning{Effort: strptr("low")},
		},
	}
	dp := &schemas.DefaultParameters{ReasoningEffort: strptr("high")}

	applyChatDefaultParameters(chatReq, dp)

	if *chatReq.Params.Reasoning.Effort != "low" {
		t.Errorf("reasoning effort = %q, want caller's low untouched", *chatReq.Params.Reasoning.Effort)
	}
}

func TestApplyChatDefaultParametersAllocatesNilParams(t *testing.T) {
	chatReq := &schemas.BifrostChatRequest{} // Params == nil
	dp := &schemas.DefaultParameters{ReasoningEffort: strptr("medium")}

	applied := applyChatDefaultParameters(chatReq, dp)

	if chatReq.Params == nil || chatReq.Params.Reasoning == nil ||
		*chatReq.Params.Reasoning.Effort != "medium" {
		t.Errorf("nil Params not allocated/filled: %+v", chatReq.Params)
	}
	if joinSorted(applied) != "reasoning_effort" {
		t.Errorf("applied = %v, want [reasoning_effort]", applied)
	}
}

func TestApplyChatDefaultParametersNoDefaultsIsNoop(t *testing.T) {
	chatReq := &schemas.BifrostChatRequest{}
	dp := &schemas.DefaultParameters{}

	if applied := applyChatDefaultParameters(chatReq, dp); applied != nil {
		t.Errorf("applied = %v, want nil", applied)
	}
	if chatReq.Params != nil {
		t.Errorf("Params allocated for empty defaults: %+v", chatReq.Params)
	}
	// nil dp is also a no-op
	if applied := applyChatDefaultParameters(chatReq, nil); applied != nil {
		t.Errorf("applied = %v, want nil for nil defaults", applied)
	}
}

func TestApplyChatDefaultParametersCustomMergeAndCoercion(t *testing.T) {
	chatReq := &schemas.BifrostChatRequest{
		Params: &schemas.ChatParameters{
			ExtraParams: map[string]interface{}{
				"top_k": 7, // caller already sent top_k — must survive
			},
		},
	}
	dp := &schemas.DefaultParameters{
		Custom: map[string]string{
			"top_k":            "15",   // must NOT overwrite the caller's 7
			"verbosity":        "high", // bare string stays string
			"presence_penalty": "0.5",  // numeric coercion
			"enable_beta":      "true", // bool coercion
			"model":            "evil", // denylisted — dropped
			"temperature":      "0.9",  // denylisted — dropped
		},
	}

	applyChatDefaultParameters(chatReq, dp)

	if got := chatReq.Params.ExtraParams["top_k"]; got != 7 {
		t.Errorf("custom top_k = %v, want caller's 7 untouched", got)
	}
	if got, ok := chatReq.Params.ExtraParams["verbosity"].(string); !ok || got != "high" {
		t.Errorf("custom verbosity = %#v, want string \"high\"", chatReq.Params.ExtraParams["verbosity"])
	}
	if got, ok := chatReq.Params.ExtraParams["presence_penalty"].(float64); !ok || got != 0.5 {
		t.Errorf("custom presence_penalty = %#v, want float64 0.5", chatReq.Params.ExtraParams["presence_penalty"])
	}
	if got, ok := chatReq.Params.ExtraParams["enable_beta"].(bool); !ok || !got {
		t.Errorf("custom enable_beta = %#v, want bool true", chatReq.Params.ExtraParams["enable_beta"])
	}
	for _, banned := range []string{"model", "temperature"} {
		if _, exists := chatReq.Params.ExtraParams[banned]; exists {
			t.Errorf("denylisted custom key %q landed in ExtraParams", banned)
		}
	}
}

func TestCoerceCustomParam(t *testing.T) {
	cases := []struct {
		in   string
		want interface{}
	}{
		{"0.7", float64(0.7)},
		{"true", true},
		{"false", false},
		{"42", float64(42)},
		{`"high"`, "high"},
		{"high", "high"},
		{`["a","b"]`, []interface{}{"a", "b"}},
		{"", ""},
		{"  0.7  ", float64(0.7)},
	}
	for _, tc := range cases {
		got := coerceCustomParam(tc.in)
		switch want := tc.want.(type) {
		case []interface{}:
			gotSlice, ok := got.([]interface{})
			if !ok || len(gotSlice) != len(want) {
				t.Errorf("coerceCustomParam(%q) = %#v, want %#v", tc.in, got, tc.want)
				continue
			}
			for i := range want {
				if gotSlice[i] != want[i] {
					t.Errorf("coerceCustomParam(%q)[%d] = %#v, want %#v", tc.in, i, gotSlice[i], want[i])
				}
			}
		default:
			if got != tc.want {
				t.Errorf("coerceCustomParam(%q) = %#v, want %#v", tc.in, got, tc.want)
			}
		}
	}
}

// fakeCatalog is a stand-in for *modelcatalog.ModelCatalog serving one
// (provider, model) → *schemas.Model mapping. It deliberately returns the
// SAME pointers every call so the mutation-leak test below verifies that
// injection takes ownership at the boundary rather than relying on the
// catalog handing out copies.
type fakeCatalog struct {
	provider schemas.ModelProvider
	model    string
	info     *schemas.Model
}

func (f *fakeCatalog) GetModelInfo(provider schemas.ModelProvider, model string) *schemas.Model {
	if provider != f.provider || model != f.model {
		return nil
	}
	return f.info
}

// TestInjectDefaultParametersEndToEnd drives injection through the same entry
// point the PreRequestHook uses, verifying the lookup, fill-only-unset
// behavior, and that mutating the injected request never leaks back into the
// catalog (GetModelInfo must hand back caller-owned copies).
func TestInjectDefaultParametersEndToEnd(t *testing.T) {
	provider := schemas.ModelProvider("shangtang")
	model := "deepseek-v4-flash"
	catalog := &fakeCatalog{
		provider: provider,
		model:    model,
		info: &schemas.Model{
			ID: model,
			DefaultParameters: &schemas.DefaultParameters{
				ReasoningEffort: strptr("xhigh"),
				Custom:          map[string]string{"top_k": "8"},
			},
		},
	}

	ctx := schemas.NewBifrostContext(nil, time.Time{})
	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{Provider: provider, Model: model},
	}
	injectModelDefaultParameters(catalog, ctx, req, provider, model)

	if req.ChatRequest.Params == nil || req.ChatRequest.Params.Reasoning == nil ||
		*req.ChatRequest.Params.Reasoning.Effort != "xhigh" {
		t.Fatalf("effort not injected: %+v", req.ChatRequest.Params)
	}
	if got, ok := req.ChatRequest.Params.ExtraParams["top_k"].(float64); !ok || got != 8 {
		t.Errorf("custom top_k = %#v, want float64 8", req.ChatRequest.Params.ExtraParams["top_k"])
	}

	// Mutating the injected values must not leak back into the catalog.
	*req.ChatRequest.Params.Reasoning.Effort = "mutated"
	delete(req.ChatRequest.Params.ExtraParams, "top_k")

	fresh := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{Provider: provider, Model: model},
	}
	injectModelDefaultParameters(catalog, schemas.NewBifrostContext(nil, time.Time{}), fresh, provider, model)
	if *fresh.ChatRequest.Params.Reasoning.Effort != "xhigh" {
		t.Errorf("catalog default mutated via injected request: %q", *fresh.ChatRequest.Params.Reasoning.Effort)
	}
	if _, ok := fresh.ChatRequest.Params.ExtraParams["top_k"]; !ok {
		t.Error("catalog custom default lost after request-side mutation")
	}
}

// TestInjectDefaultParametersNoEntryIsNoop covers the guard clauses: nil
// catalog, unknown (provider, model), and entry without defaults.
func TestInjectDefaultParametersNoEntryIsNoop(t *testing.T) {
	provider := schemas.ModelProvider("p")
	req := &schemas.BifrostRequest{
		RequestType: schemas.ChatCompletionRequest,
		ChatRequest: &schemas.BifrostChatRequest{Provider: provider, Model: "m"},
	}
	ctx := schemas.NewBifrostContext(nil, time.Time{})

	injectModelDefaultParameters(nil, ctx, req, provider, "m") // nil catalog
	injectModelDefaultParameters(&fakeCatalog{provider: provider, model: "other"}, ctx, req, provider, "m")
	injectModelDefaultParameters(&fakeCatalog{provider: provider, model: "m"}, ctx, req, provider, "m") // no info

	if req.ChatRequest.Params != nil {
		t.Errorf("Params allocated for no-op injections: %+v", req.ChatRequest.Params)
	}
}

func joinSorted(ss []string) string {
	sorted := append([]string(nil), ss...)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j] < sorted[j-1]; j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}
	out := ""
	for i, s := range sorted {
		if i > 0 {
			out += ","
		}
		out += s
	}
	return out
}
