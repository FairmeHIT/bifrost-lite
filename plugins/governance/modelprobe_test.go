package governance

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
)

func TestModelProbeEntryKeyNormalizesProviderPrefix(t *testing.T) {
	tests := []struct {
		name     string
		provider schemas.ModelProvider
		model    string
		want     string
	}{
		{name: "bare model", provider: schemas.ModelProvider("shangtang"), model: "deepseek-v4-flash", want: "shangtang/deepseek-v4-flash"},
		{name: "provider qualified", provider: schemas.ModelProvider("shangtang"), model: "shangtang/deepseek-v4-flash", want: "shangtang/deepseek-v4-flash"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := modelProbeEntryKey(tc.provider, tc.model); got != tc.want {
				t.Fatalf("modelProbeEntryKey() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestModelProbeUnavailable(t *testing.T) {
	vk := &configstoreTables.TableVirtualKey{
		ModelProbeEnabled:           true,
		ModelProbeAvailableModels:   schemas.WhiteList{"shangtang/deepseek-v4-flash"},
		ModelProbeUnavailableModels: schemas.WhiteList{"shangtang/kimi-k2"},
	}

	if !modelProbeUnavailable(vk, schemas.ModelProvider("shangtang"), "kimi-k2") {
		t.Fatal("expected kimi-k2 to be unavailable")
	}
	if !modelProbeUnavailable(vk, schemas.ModelProvider("shangtang"), "shangtang/kimi-k2") {
		t.Fatal("expected provider-qualified kimi-k2 to be unavailable")
	}
	if modelProbeUnavailable(vk, schemas.ModelProvider("shangtang"), "deepseek-v4-flash") {
		t.Fatal("expected deepseek-v4-flash to be available")
	}
	if !modelProbeUnavailable(vk, schemas.OpenAI, "deepseek-v4-flash") {
		t.Fatal("a different provider must not inherit an available result")
	}
	if !modelProbeUnavailable(vk, schemas.ModelProvider("shangtang"), "never-probed") {
		t.Fatal("never-probed models must be blocked")
	}
	if !modelProbeUnavailable(vk, "", "shangtang/kimi-k2") {
		t.Fatal("expected a provider-qualified model to be unavailable when the request has no provider yet")
	}
	if modelProbeUnavailable(vk, "", "shangtang/deepseek-v4-flash") {
		t.Fatal("expected the provider-qualified available model to stay available")
	}

	vk.ModelProbeEnabled = false
	if modelProbeUnavailable(vk, schemas.ModelProvider("shangtang"), "kimi-k2") {
		t.Fatal("probe results must be ignored when the probe is disabled")
	}
}

func TestModelProbeUnavailableInList(t *testing.T) {
	vk := &configstoreTables.TableVirtualKey{
		ModelProbeEnabled:           true,
		ModelProbeAvailableModels:   schemas.WhiteList{"shangtang/deepseek-v4-flash"},
		ModelProbeUnavailableModels: schemas.WhiteList{"shangtang/kimi-k2", "shangtang/openrouter/free"},
	}

	if !modelProbeUnavailableInList(vk, "openrouter/free") {
		t.Fatal("expected a bare model containing a slash to match the model half of a provider-qualified entry")
	}

	if !modelProbeUnavailableInList(vk, "shangtang/kimi-k2") {
		t.Fatal("expected provider-qualified list entry to be hidden")
	}
	if modelProbeUnavailableInList(vk, "shangtang/deepseek-v4-flash") {
		t.Fatal("expected available model to stay listed")
	}
	if !modelProbeUnavailableInList(vk, "kimi-k2") {
		t.Fatal("expected bare unavailable model to be hidden when no provider serves it")
	}
	if modelProbeUnavailableInList(vk, "deepseek-v4-flash") {
		t.Fatal("expected bare available model to stay listed")
	}
	if !modelProbeUnavailableInList(vk, "another-model") {
		t.Fatal("never-probed models must be hidden")
	}
	if !modelProbeUnavailableInList(vk, "openai/deepseek-v4-flash") {
		t.Fatal("a different provider must not inherit availability")
	}
	vk.ModelProbeAvailableModels = nil
	if !modelProbeUnavailableInList(vk, "shangtang/deepseek-v4-flash") || !modelProbeUnavailable(vk, "shangtang", "deepseek-v4-flash") {
		t.Fatal("an empty available list must deny models")
	}
}

func TestModelProbeGovernanceIntegration(t *testing.T) {
	logger := NewMockLogger()
	vk := buildVirtualKey("vk1", "sk-bf-test", "Test VK", true)
	vk.ProviderConfigs = []configstoreTables.TableVirtualKeyProviderConfig{buildProviderConfig("openai", []string{"*"}), buildProviderConfig("anthropic", []string{"*"})}
	vk.ModelProbeEnabled = true
	vk.ModelProbeAvailableModels = schemas.WhiteList{"openai/allowed"}
	store, err := NewLocalGovernanceStore(context.Background(), logger, nil, &configstore.GovernanceConfig{VirtualKeys: []configstoreTables.TableVirtualKey{*vk}}, nil)
	require.NoError(t, err)
	plugin := &GovernancePlugin{store: store, resolver: NewBudgetResolver(store, nil, logger, nil), logger: logger}
	cases := []struct {
		name        string
		provider    schemas.ModelProvider
		model       string
		requestType schemas.RequestType
		skip        bool
		want        Decision
	}{
		{"allowed", schemas.OpenAI, "allowed", schemas.ChatCompletionRequest, false, DecisionAllow},
		{"unknown", schemas.OpenAI, "unknown", schemas.ChatCompletionRequest, false, DecisionModelUnavailable},
		{"other provider", schemas.Anthropic, "allowed", schemas.ChatCompletionRequest, false, DecisionModelUnavailable},
		{"non chat", schemas.OpenAI, "unknown", schemas.EmbeddingRequest, false, DecisionModelUnavailable},
		{"probe", schemas.OpenAI, "unknown", schemas.ChatCompletionRequest, true, DecisionAllow},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := schemas.NewBifrostContext(context.Background(), time.Now().Add(time.Minute))
			if tc.skip {
				ctx.SetValue(schemas.BifrostContextKeySkipModelProbeGating, true)
			}
			result, _ := plugin.EvaluateGovernanceRequest(ctx, &EvaluationRequest{VirtualKey: "sk-bf-test", Provider: tc.provider, Model: tc.model}, tc.requestType)
			require.Equal(t, tc.want, result.Decision)
		})
	}
	ctx := schemas.NewBifrostContext(context.Background(), time.Now().Add(time.Minute))
	models := []schemas.Model{{ID: "openai/allowed"}, {ID: "openai/unknown"}, {ID: "anthropic/allowed"}}
	require.Equal(t, []schemas.Model{{ID: "openai/allowed"}}, plugin.filterModelsForVirtualKey(ctx, models, "sk-bf-test"))
	ctx.SetValue(schemas.BifrostContextKeySkipModelProbeGating, true)
	require.Equal(t, models, plugin.filterModelsForVirtualKey(ctx, models, "sk-bf-test"))
}

func TestModelProbeGatingSkipped(t *testing.T) {
	if modelProbeGatingSkipped(context.Background()) {
		t.Fatal("background context must not skip probe gating")
	}
	ctx := schemas.NewBifrostContext(context.Background(), time.Now().Add(time.Minute))
	ctx.SetValue(schemas.BifrostContextKeySkipModelProbeGating, true)
	if !modelProbeGatingSkipped(ctx) {
		t.Fatal("probe context must skip probe gating")
	}
}

func TestModelProbeAppliesToRequestType(t *testing.T) {
	cases := map[schemas.RequestType]bool{
		schemas.ChatCompletionRequest:       true,
		schemas.ChatCompletionStreamRequest: true,
		schemas.ResponsesRequest:            true,
		schemas.ResponsesStreamRequest:      true,
		schemas.TextCompletionRequest:       true,
		schemas.TextCompletionStreamRequest: true,
		schemas.EmbeddingRequest:            true,
		schemas.SpeechRequest:               true,
		schemas.ImageGenerationRequest:      true,
		schemas.TranscriptionRequest:        true,
		schemas.ListModelsRequest:           false,
	}
	for requestType, want := range cases {
		if got := modelProbeAppliesToRequestType(requestType); got != want {
			t.Fatalf("modelProbeAppliesToRequestType(%q) = %v, want %v", requestType, got, want)
		}
	}
}
