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

// modelProbeAppliesToRequestType restricts the whitelist to model inference,
// leaving metadata and resource-management requests unaffected.
func modelProbeAppliesToRequestType(requestType schemas.RequestType) bool {
	switch requestType {
	case schemas.TextCompletionRequest, schemas.TextCompletionStreamRequest,
		schemas.ChatCompletionRequest, schemas.ChatCompletionStreamRequest,
		schemas.ResponsesRequest, schemas.ResponsesStreamRequest,
		schemas.EmbeddingRequest, schemas.SpeechRequest, schemas.SpeechStreamRequest,
		schemas.TranscriptionRequest, schemas.TranscriptionStreamRequest,
		schemas.ImageGenerationRequest, schemas.ImageGenerationStreamRequest,
		schemas.ImageEditRequest, schemas.ImageEditStreamRequest, schemas.ImageVariationRequest,
		schemas.VideoGenerationRequest, schemas.VideoRemixRequest,
		schemas.RerankRequest, schemas.OCRRequest, schemas.CountTokensRequest,
		schemas.CompactionRequest, schemas.WebSocketResponsesRequest, schemas.RealtimeRequest:
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

// modelProbeProviderExempt reports whether the provider is on the model-probe
// exemption list. Exempt providers are never probed and never gated by probe
// results — their models are always treated as available.
func modelProbeProviderExempt(vk *configstoreTables.TableVirtualKey, provider schemas.ModelProvider) bool {
	if vk == nil || len(vk.ModelProbeExemptProviders) == 0 {
		return false
	}
	for _, exempt := range vk.ModelProbeExemptProviders {
		if strings.EqualFold(strings.TrimSpace(exempt), string(provider)) {
			return true
		}
	}
	return false
}

// modelProbeUnavailable enforces the latest available provider/model whitelist.
func modelProbeUnavailable(vk *configstoreTables.TableVirtualKey, provider schemas.ModelProvider, model string) bool {
	if vk == nil || !vk.ModelProbeEnabled {
		return false
	}
	if modelProbeProviderExempt(vk, provider) {
		return false
	}
	if strings.TrimSpace(model) == "" {
		return true
	}
	if provider == "" {
		var ok bool
		provider, model, ok = splitProbeEntry(model)
		if !ok {
			return true
		}
	}
	for _, entry := range vk.ModelProbeAvailableModels {
		if modelProbeEntryMatches(entry, provider, model) {
			return false
		}
	}
	return true
}

// modelProbeUnavailableInList handles IDs with or without a provider prefix.
// Configured provider prefixes are authoritative, including custom providers.
func modelProbeUnavailableInList(vk *configstoreTables.TableVirtualKey, modelID string) bool {
	if vk == nil || !vk.ModelProbeEnabled {
		return false
	}
	modelID = strings.TrimSpace(modelID)
	if provider, _, ok := splitProbeEntry(modelID); ok && modelProbeProviderExempt(vk, provider) {
		return false
	}
	if provider, model, ok := splitProbeEntry(modelID); ok {
		for _, pc := range vk.ProviderConfigs {
			if strings.EqualFold(pc.Provider, string(provider)) {
				return modelProbeUnavailable(vk, provider, model)
			}
		}
		if schemas.IsKnownProvider(string(provider)) {
			return modelProbeUnavailable(vk, provider, model)
		}
	}
	for _, entry := range vk.ModelProbeAvailableModels {
		provider, model, ok := splitProbeEntry(entry)
		if ok && (strings.EqualFold(model, modelID) || modelProbeEntryMatches(entry, provider, modelID)) {
			return false
		}
	}
	return true
}
