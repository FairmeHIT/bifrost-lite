package governance

import (
	"context"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
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
	if modelProbeUnavailable(vk, schemas.OpenAI, "kimi-k2") {
		t.Fatal("a different provider must not inherit the result")
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
	if modelProbeUnavailableInList(vk, "another-model") {
		t.Fatal("never-probed models must remain listed")
	}
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
		schemas.EmbeddingRequest:            false,
		schemas.SpeechRequest:               false,
		schemas.ImageGenerationRequest:      false,
		schemas.TranscriptionRequest:        false,
		schemas.ListModelsRequest:           false,
	}
	for requestType, want := range cases {
		if got := modelProbeAppliesToRequestType(requestType); got != want {
			t.Fatalf("modelProbeAppliesToRequestType(%q) = %v, want %v", requestType, got, want)
		}
	}
}
