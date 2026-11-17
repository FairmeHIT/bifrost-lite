package governance

import (
	"context"
	"strings"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
)

// modelProbeGatingSkipped reports whether the current request is an internal
// model-probe call. Probes must not be gated by the previous probe result,
// otherwise a model that failed a run could never be re-tested.
func modelProbeGatingSkipped(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	skip, _ := ctx.Value(schemas.BifrostContextKeySkipModelProbeGating).(bool)
	return skip
}

// modelProbeAppliesToRequestType limits probe-based blocking to model types the
// probe can actually exercise (chat-style completions). Embeddings, speech,
// images and other non-chat operations are left alone: a model that cannot chat
// must not become unavailable for them.
func modelProbeAppliesToRequestType(requestType schemas.RequestType) bool {
	switch requestType {
	case schemas.TextCompletionRequest, schemas.TextCompletionStreamRequest,
		schemas.ChatCompletionRequest, schemas.ChatCompletionStreamRequest,
		schemas.ResponsesRequest, schemas.ResponsesStreamRequest:
		return true
	default:
		return false
	}
}

// stripProbeProviderPrefix removes a leading "<provider>/" from a model name.
// It deliberately does not use schemas.ParseModelString: that helper only
// recognizes standard providers, while virtual keys frequently target custom
// providers (shangtang, kimi, ...), whose names would otherwise be kept in the
// model half of the key.
func stripProbeProviderPrefix(provider schemas.ModelProvider, model string) string {
	model = strings.TrimSpace(model)
	prefix := string(provider) + "/"
	if provider != "" && len(model) > len(prefix) && strings.EqualFold(model[:len(prefix)], prefix) {
		return model[len(prefix):]
	}
	return model
}

// splitProbeEntry splits a persisted "<provider>/<model>" entry. Provider names
// never contain a slash; model names may.
func splitProbeEntry(entry string) (schemas.ModelProvider, string, bool) {
	entry = strings.TrimSpace(entry)
	idx := strings.Index(entry, "/")
	if idx <= 0 || idx == len(entry)-1 {
		return "", "", false
	}
	return schemas.ModelProvider(entry[:idx]), entry[idx+1:], true
}

// modelProbeEntryKey normalizes a (provider, model) pair into the
// provider-qualified form persisted on the virtual key.
func modelProbeEntryKey(provider schemas.ModelProvider, model string) string {
	return string(provider) + "/" + stripProbeProviderPrefix(provider, model)
}

// modelProbeEntryMatches reports whether a persisted provider-qualified entry
// refers to the same provider/model pair.
func modelProbeEntryMatches(entry string, provider schemas.ModelProvider, model string) bool {
	entryProvider, entryModel, ok := splitProbeEntry(entry)
	if !ok {
		return false
	}
	requestModel := stripProbeProviderPrefix(provider, model)
	return strings.EqualFold(string(entryProvider), string(provider)) &&
		strings.EqualFold(entryModel, requestModel)
}

// modelProbeUnavailable reports whether the latest probe marked this exact
// provider/model pair unavailable. Models that were never probed are allowed
// (fail-open) so a failed probe run cannot lock a virtual key out.
func modelProbeUnavailable(vk *configstoreTables.TableVirtualKey, provider schemas.ModelProvider, model string) bool {
	if vk == nil || !vk.ModelProbeEnabled || model == "" {
		return false
	}
	for _, entry := range vk.ModelProbeUnavailableModels {
		if modelProbeEntryMatches(entry, provider, model) {
			return true
		}
	}
	// Requests routed by model alone can still carry a provider-qualified model
	// name (for example "shangtang/deepseek-v4-flash"). Match that pair too so
	// the request is rejected before provider selection, rather than only being
	// excluded later by load balancing.
	if provider == "" {
		if entryProvider, entryModel, ok := splitProbeEntry(model); ok {
			for _, entry := range vk.ModelProbeUnavailableModels {
				if modelProbeEntryMatches(entry, entryProvider, entryModel) {
					return true
				}
			}
		}
	}
	return false
}

// modelProbeUnavailableInList filters a model returned by /v1/models. List
// responses may omit the provider, so a bare model name is hidden only when
// the probe found no provider serving it and at least one provider failed it.
func modelProbeUnavailableInList(vk *configstoreTables.TableVirtualKey, modelID string) bool {
	if vk == nil || !vk.ModelProbeEnabled || modelID == "" {
		return false
	}
	modelID = strings.TrimSpace(modelID)

	if provider, modelName, ok := splitProbeEntry(modelID); ok && modelProbeUnavailable(vk, provider, modelName) {
		return true
	}

	// List responses may return a bare model name even though probe entries are
	// provider-qualified, so compare against the model half of every entry too.
	for _, entry := range vk.ModelProbeAvailableModels {
		if _, availableModel, ok := splitProbeEntry(entry); ok && strings.EqualFold(availableModel, modelID) {
			return false
		}
	}
	for _, entry := range vk.ModelProbeUnavailableModels {
		if _, unavailableModel, ok := splitProbeEntry(entry); ok && strings.EqualFold(unavailableModel, modelID) {
			return true
		}
	}
	return false
}
