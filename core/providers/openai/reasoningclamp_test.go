package openai

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

// sensenovaLevels mirrors a real OpenAI-compatible gateway whose deepseek-v4
// deployment only accepts low/medium/high/none (rejects "max", "xhigh").
var sensenovaLevels = []string{"none", "low", "medium", "high"}

func TestClampReasoningEffortToLevels(t *testing.T) {
	tests := []struct {
		name     string
		effort   string
		levels   []string
		expected string
	}{
		{"no levels leaves value untouched", "max", nil, "max"},
		{"empty levels leaves value untouched", "max", []string{}, "max"},
		{"declared value passes through", "medium", sensenovaLevels, "medium"},
		{"declared none passes through", "none", sensenovaLevels, "none"},
		{"declared high passes through", "high", sensenovaLevels, "high"},
		{"clamps max down to high", "max", sensenovaLevels, "high"},
		{"clamps xhigh down to high", "xhigh", sensenovaLevels, "high"},
		{"clamps minimal down to none", "minimal", sensenovaLevels, "none"},
		{"clamps low below lowest declared level to lowest", "none", []string{"low", "medium", "high"}, "low"},
		{"clamps minimal below lowest declared level to lowest", "minimal", []string{"low", "medium", "high"}, "low"},
		{"non-canonical value passes through", "ultra", sensenovaLevels, "ultra"},
		{"non-canonical declared level passes through", "ultra", []string{"none", "ultra"}, "ultra"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := clampReasoningEffortToLevels(tt.effort, tt.levels); got != tt.expected {
				t.Fatalf("clampReasoningEffortToLevels(%q, %v) = %q, want %q", tt.effort, tt.levels, got, tt.expected)
			}
		})
	}
}

func TestClampCustomProviderReasoningEffort(t *testing.T) {
	t.Run("nil ctx is a no-op", func(t *testing.T) {
		effort := schemas.Ptr("max")
		if got := clampCustomProviderReasoningEffort(nil, effort); got != effort {
			t.Fatal("nil ctx must return the original effort pointer")
		}
	})

	t.Run("nil effort is a no-op", func(t *testing.T) {
		ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
		ctx.SetValue(schemas.BifrostContextKeyReasoningEffortLevels, sensenovaLevels)
		if got := clampCustomProviderReasoningEffort(ctx, nil); got != nil {
			t.Fatal("nil effort must stay nil")
		}
	})

	t.Run("no levels declared is a no-op", func(t *testing.T) {
		ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
		effort := schemas.Ptr("max")
		if got := clampCustomProviderReasoningEffort(ctx, effort); got != effort {
			t.Fatal("provider without declared levels must keep passthrough behavior")
		}
	})

	t.Run("clamps to declared levels", func(t *testing.T) {
		ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
		ctx.SetValue(schemas.BifrostContextKeyReasoningEffortLevels, sensenovaLevels)
		got := clampCustomProviderReasoningEffort(ctx, schemas.Ptr("max"))
		if got == nil || *got != "high" {
			t.Fatalf("expected clamped effort high, got %v", got)
		}
	})

	t.Run("declared value returns the same pointer", func(t *testing.T) {
		ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
		ctx.SetValue(schemas.BifrostContextKeyReasoningEffortLevels, sensenovaLevels)
		effort := schemas.Ptr("medium")
		if got := clampCustomProviderReasoningEffort(ctx, effort); got != effort {
			t.Fatal("an in-range effort must not be replaced")
		}
	})
}

// TestToOpenAIChatRequest_CustomProviderClampsReasoningEffort pins the chat
// completions path: a custom OpenAI-compatible provider (which skips
// filterOpenAISpecificParameters entirely) must clamp reasoning_effort to the
// levels its upstream declares instead of forwarding values like "max" that the
// upstream would reject with a 400.
func TestToOpenAIChatRequest_CustomProviderClampsReasoningEffort(t *testing.T) {
	tests := []struct {
		name     string
		levels   []string
		effort   string
		expected string
	}{
		{"clamps max to high", sensenovaLevels, "max", "high"},
		{"clamps xhigh to high", sensenovaLevels, "xhigh", "high"},
		{"passes declared high", sensenovaLevels, "high", "high"},
		{"passes declared medium", sensenovaLevels, "medium", "medium"},
		{"passes declared none", sensenovaLevels, "none", "none"},
		{"clamps minimal down to none", sensenovaLevels, "minimal", "none"},
		{"no declared levels keeps max", nil, "max", "max"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
			ctx.SetValue(schemas.BifrostContextKeyIsCustomProvider, true)
			ctx.SetValue(schemas.BifrostContextKeyReasoningEffortLevels, tt.levels)

			out := ToOpenAIChatRequest(ctx, &schemas.BifrostChatRequest{
				Provider: schemas.ModelProvider("sensenova"),
				Model:    "deepseek-v4-flash",
				Input: []schemas.ChatMessage{{
					Role: schemas.ChatMessageRoleUser,
					Content: &schemas.ChatMessageContent{
						ContentStr: schemas.Ptr("hello"),
					},
				}},
				Params: &schemas.ChatParameters{
					Reasoning: &schemas.ChatReasoning{
						Effort: schemas.Ptr(tt.effort),
					},
				},
			})
			if out == nil {
				t.Fatal("expected OpenAI chat request")
			}
			if out.Reasoning == nil || out.Reasoning.Effort == nil {
				t.Fatal("expected reasoning effort to be set")
			}
			if got := *out.Reasoning.Effort; got != tt.expected {
				t.Fatalf("expected reasoning effort %q, got %q", tt.expected, got)
			}
		})
	}
}

// TestToOpenAIResponsesRequest_CustomProviderClampsReasoningEffort pins the
// responses path: normalization preserves "max" for deepseek-v4 models, and the
// custom provider's declared levels must then clamp it before it crosses the
// wire.
func TestToOpenAIResponsesRequest_CustomProviderClampsReasoningEffort(t *testing.T) {
	tests := []struct {
		name     string
		levels   []string
		effort   string
		expected string
	}{
		{"clamps max to high", sensenovaLevels, "max", "high"},
		{"clamps xhigh to high", sensenovaLevels, "xhigh", "high"},
		{"passes declared high", sensenovaLevels, "high", "high"},
		{"passes declared medium", sensenovaLevels, "medium", "medium"},
		{"passes declared none", sensenovaLevels, "none", "none"},
		{"no declared levels keeps max", nil, "max", "max"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
			ctx.SetValue(schemas.BifrostContextKeyIsCustomProvider, true)
			ctx.SetValue(schemas.BifrostContextKeyReasoningEffortLevels, tt.levels)

			out := ToOpenAIResponsesRequest(ctx, &schemas.BifrostResponsesRequest{
				Provider: schemas.ModelProvider("sensenova"),
				Model:    "deepseek-v4-flash",
				Input: []schemas.ResponsesMessage{{
					Role:    schemas.Ptr(schemas.ResponsesInputMessageRoleUser),
					Content: &schemas.ResponsesMessageContent{ContentStr: schemas.Ptr("hello")},
				}},
				Params: &schemas.ResponsesParameters{
					Reasoning: &schemas.ResponsesParametersReasoning{
						Effort: schemas.Ptr(tt.effort),
					},
				},
			})
			if out == nil {
				t.Fatal("expected OpenAI responses request")
			}
			if out.Reasoning == nil || out.Reasoning.Effort == nil {
				t.Fatal("expected reasoning effort to be set")
			}
			if got := *out.Reasoning.Effort; got != tt.expected {
				t.Fatalf("expected reasoning effort %q, got %q", tt.expected, got)
			}
		})
	}
}
