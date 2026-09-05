// Per-(provider, model) default request-parameter injection. The defaults are
// configured through the model catalog (governance_model_pricing.
// default_parameters), surfaced on schemas.Model.DefaultParameters via
// modelcatalog.ApplyModelInfo, and injected here into chat requests whose
// caller did not already specify the value — explicit request values always
// win. Runs as part of the model-catalog resolver's PreRequestHook so it fires
// after every other routing plugin has settled the final (provider, model)
// pair and before any PreLLMHook (governance evaluation, logging) observes
// the request.
package modelcatalogresolver

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
)

// customParamDenylist blocks Custom keys that would collide with request-shape
// or structured-default fields. Structured defaults (temperature, top_p, …)
// are injected through the typed ChatParameters fields, so a Custom key with
// the same wire name must not also land in ExtraParams — and core fields
// (model, messages, stream, …) must never be overridable by a model default.
var customParamDenylist = map[string]bool{
	// core request shape — never overridable
	"model": true, "messages": true, "stream": true, "provider": true,
	"fallbacks": true, "tools": true, "tool_choice": true,
	// structured defaults — handled through typed fields above
	"temperature": true, "top_p": true, "frequency_penalty": true,
	"max_tokens": true, "max_completion_tokens": true,
	"reasoning": true, "reasoning_effort": true, "reasoning_max_tokens": true,
}

// modelInfoGetter is the slice of *modelcatalog.ModelCatalog the default-
// parameter injection path depends on. Split out as an interface so tests can
// drive injection without standing up a full catalog (whose pricing rows come
// from a config store, not the URL datasheet).
type modelInfoGetter interface {
	GetModelInfo(provider schemas.ModelProvider, model string) *schemas.Model
}

// injectDefaultParameters fills unset chat request parameters from the model
// catalog's per-(provider, model) defaults. No-op when the catalog has no
// entry or the entry carries no defaults. Only chat completion requests are
// handled — the Responses API has its own parameter shape and text
// completions convert to/from chat outside this hook's reach.
func (p *Plugin) injectDefaultParameters(ctx *schemas.BifrostContext, req *schemas.BifrostRequest, provider schemas.ModelProvider, model string) {
	injectModelDefaultParameters(p.catalog, ctx, req, provider, model)
}

func injectModelDefaultParameters(catalog modelInfoGetter, ctx *schemas.BifrostContext, req *schemas.BifrostRequest, provider schemas.ModelProvider, model string) {
	if catalog == nil || req == nil || req.ChatRequest == nil || provider == "" || model == "" {
		return
	}

	info := catalog.GetModelInfo(provider, model)
	if info == nil || info.DefaultParameters == nil {
		return
	}

	applied := applyChatDefaultParameters(req.ChatRequest, info.DefaultParameters)
	if len(applied) == 0 {
		return
	}

	// GetModelInfo hands back a caller-owned copy of the defaults, but Params
	// on the request is shared state — reflect what actually landed so it is
	// observable in routing engine logs (and therefore the UI request log).
	ctx.AppendRoutingEngineLog(schemas.RoutingEngineModelCatalog, schemas.LogLevelInfo, fmt.Sprintf(
		"Applied model default parameter(s) for %s/%s: %s",
		provider, model, strings.Join(applied, ", "),
	))
}

// applyChatDefaultParameters merges dp into chatReq.Params, filling only
// fields that are currently unset. Returns the wire names of the values it
// set, in a stable order for logging. Allocates chatReq.Params when a default
// exists but Params was nil.
func applyChatDefaultParameters(chatReq *schemas.BifrostChatRequest, dp *schemas.DefaultParameters) []string {
	if chatReq == nil || dp == nil {
		return nil
	}
	// Take ownership up front: whatever GetModelInfo handed back, the pointers
	// planted into the request must not alias catalog state — a later write
	// through a request-side pointer would otherwise rewrite the defaults for
	// every concurrent request reading the same catalog row.
	dp = dp.Clone()
	if chatReq.Params == nil {
		if !hasStructuredDefault(dp) && len(dp.Custom) == 0 {
			return nil
		}
		chatReq.Params = &schemas.ChatParameters{}
	}
	params := chatReq.Params
	var applied []string

	if dp.Temperature != nil && params.Temperature == nil {
		params.Temperature = dp.Temperature
		applied = append(applied, "temperature")
	}
	if dp.TopP != nil && params.TopP == nil {
		params.TopP = dp.TopP
		applied = append(applied, "top_p")
	}
	if dp.FrequencyPenalty != nil && params.FrequencyPenalty == nil {
		params.FrequencyPenalty = dp.FrequencyPenalty
		applied = append(applied, "frequency_penalty")
	}
	// DefaultParameters.MaxTokens maps to ChatParameters.MaxCompletionTokens —
	// the neutral layer's name for the output token cap.
	if dp.MaxTokens != nil && params.MaxCompletionTokens == nil {
		params.MaxCompletionTokens = dp.MaxTokens
		applied = append(applied, "max_completion_tokens")
	}
	if dp.ReasoningEffort != nil || dp.ReasoningMaxTokens != nil {
		if params.Reasoning == nil {
			params.Reasoning = &schemas.ChatReasoning{}
		}
		if dp.ReasoningEffort != nil && params.Reasoning.Effort == nil {
			params.Reasoning.Effort = dp.ReasoningEffort
			applied = append(applied, "reasoning_effort")
		}
		if dp.ReasoningMaxTokens != nil && params.Reasoning.MaxTokens == nil {
			params.Reasoning.MaxTokens = dp.ReasoningMaxTokens
			applied = append(applied, "reasoning_max_tokens")
		}
	}

	// Custom keys merge into ExtraParams (provider-consumed dynamic params),
	// skipping denylisted names and keys the caller already sent. Values are
	// stored as strings; coerce via JSON first so "0.7" lands as a number and
	// "true" as a bool rather than everything arriving as a string.
	if len(dp.Custom) > 0 {
		keys := make([]string, 0, len(dp.Custom))
		for k := range dp.Custom {
			keys = append(keys, k)
		}
		sort.Strings(keys) // stable application + log order
		for _, k := range keys {
			if customParamDenylist[k] {
				continue
			}
			if params.ExtraParams != nil {
				if _, exists := params.ExtraParams[k]; exists {
					continue
				}
			}
			if params.ExtraParams == nil {
				params.ExtraParams = make(map[string]interface{}, len(dp.Custom))
			}
			params.ExtraParams[k] = coerceCustomParam(dp.Custom[k])
			applied = append(applied, k)
		}
	}

	sort.Strings(applied)
	return applied
}

// hasStructuredDefault reports whether dp carries any structured (non-Custom)
// default, used to decide whether a nil Params needs allocating.
func hasStructuredDefault(dp *schemas.DefaultParameters) bool {
	return dp != nil && (dp.Temperature != nil ||
		dp.TopP != nil ||
		dp.FrequencyPenalty != nil ||
		dp.MaxTokens != nil ||
		dp.ReasoningEffort != nil ||
		dp.ReasoningMaxTokens != nil)
}

// coerceCustomParam converts a stored string into the JSON value it denotes:
// valid JSON ("0.7", "true", "\"high\"", "[1,2]") parses to its natural type,
// anything else (bare "high") stays a string.
func coerceCustomParam(raw string) interface{} {
	trimmed := strings.TrimSpace(raw)
	if trimmed != "" {
		var parsed interface{}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			return parsed
		}
	}
	return raw
}
