package server

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/maximhq/bifrost/transports/bifrost-http/handlers"
)

const (
	modelProbeConcurrency = 4
	modelProbeCallTimeout = 90 * time.Second
	modelProbeRunTimeout  = 45 * time.Minute
	modelProbeMaxModels   = 2000
	modelProbeDailyHour   = 1
)

type modelProbeCandidate struct {
	provider schemas.ModelProvider
	model    string
	id       string
}

// stripProbeProviderPrefix removes a leading "<provider>/" from a model name.
// Custom provider names are not recognized by schemas.ParseModelString, so the
// prefix check is done directly against the provider being probed.
func stripProbeProviderPrefix(provider schemas.ModelProvider, model string) string {
	model = strings.TrimSpace(model)
	prefix := string(provider) + "/"
	if provider != "" && len(model) > len(prefix) && strings.EqualFold(model[:len(prefix)], prefix) {
		return model[len(prefix):]
	}
	return model
}

// ProbeVirtualKeyModels checks every model the virtual key can reach by making
// a real, short chat completion through the gateway as that virtual key. A
// model is available when the provider answers with any 2xx response; transient
// and non-chat errors leave it unprobed. Results are persisted on the virtual
// key and enforced by the governance plugin for /v1/models and inference.
func (s *BifrostHTTPServer) ProbeVirtualKeyModels(ctx context.Context, vkID string) (*handlers.ModelProbeResult, error) {
	if s.Config == nil || s.Config.ConfigStore == nil || s.Client == nil {
		return nil, errors.New("server is not ready for model probing")
	}
	if !s.beginModelProbe(vkID) {
		return nil, handlers.ErrModelProbeInProgress
	}
	defer s.finishModelProbe(vkID)

	vk, err := s.Config.ConfigStore.GetVirtualKey(ctx, vkID)
	if err != nil {
		return nil, err
	}
	if vk == nil {
		return nil, configstore.ErrNotFound
	}
	if !vk.ModelProbeEnabled {
		return nil, handlers.ErrModelProbeDisabled
	}
	if !vk.IsActiveValue() || vk.IsExpiredAt(time.Now().UTC()) {
		return nil, handlers.ErrModelProbeInactive
	}

	started := time.Now()
	probeCtx := schemas.NewBifrostContext(ctx, time.Now().Add(modelProbeRunTimeout))
	defer probeCtx.Cancel()
	probeCtx.SetValue(schemas.BifrostContextKeyVirtualKey, vk.Value.GetValue())
	probeCtx.SetValue(schemas.BifrostContextKeySkipBudgetAndRateLimits, true)
	probeCtx.SetValue(schemas.BifrostContextKeySkipVirtualKeyUsageTracking, true)
	probeCtx.SetValue(schemas.BifrostContextKeySkipModelProbeGating, true)

	candidates, listErrors := s.collectModelProbeCandidates(probeCtx, vk)
	if len(candidates) == 0 {
		message := "no models were found to probe"
		if len(listErrors) > 0 {
			message = fmt.Sprintf("%s: %s", message, summarizeProbeErrors(listErrors))
		}
		s.persistModelProbeResult(ctx, vk, nil, nil, nil, message)
		return &handlers.ModelProbeResult{
			VirtualKeyID:      vk.ID,
			CheckedAt:         time.Now().UTC(),
			AvailableModels:   append([]string{}, vk.ModelProbeAvailableModels...),
			UnavailableModels: append([]string{}, vk.ModelProbeUnavailableModels...),
			Errors:            listErrors,
			Total:             0,
			DurationMS:        time.Since(started).Milliseconds(),
		}, nil
	}
	if len(candidates) > modelProbeMaxModels {
		candidates = candidates[:modelProbeMaxModels]
	}

	available, unavailable, probeErrors := s.runModelProbeCalls(probeCtx, candidates)
	if err := probeCtx.Err(); err != nil {
		// The run budget expired while some models were still being probed.
		// Persisting the partial outcome would hide every unprobed model, so
		// keep the previous result and surface the failure instead.
		logger.Warn("model probe for virtual key %s was cancelled before completion; keeping previous result", vk.ID)
		return nil, fmt.Errorf("model probe was cancelled before completion: %w", err)
	}
	checkedAt := time.Now().UTC()
	errorMessage := ""
	if len(listErrors) > 0 {
		errorMessage = fmt.Sprintf("some providers could not be listed: %s", summarizeProbeErrors(listErrors))
	}
	if len(available) == 0 {
		// An all-failed run is far more likely to be a systemic problem (bad
		// credentials, provider outage, non-chat models) than proof that every
		// model is down. Persisting it would turn a transient failure into a
		// VK-wide lockout, so keep the previous outcome and fail open.
		errorMessage = "no model responded successfully"
		if len(probeErrors) > 0 {
			errorMessage = fmt.Sprintf("no model responded successfully (%d checked): %s", len(probeErrors), summarizeProbeErrors(probeErrors))
		}
		s.persistModelProbeResult(ctx, vk, nil, nil, &checkedAt, errorMessage)
		return &handlers.ModelProbeResult{
			VirtualKeyID:      vk.ID,
			CheckedAt:         checkedAt,
			AvailableModels:   append([]string{}, vk.ModelProbeAvailableModels...),
			UnavailableModels: append([]string{}, vk.ModelProbeUnavailableModels...),
			Errors:            probeErrors,
			Total:             len(candidates),
			DurationMS:        time.Since(started).Milliseconds(),
		}, nil
	}
	s.persistModelProbeResult(ctx, vk, available, unavailable, &checkedAt, errorMessage)

	result := &handlers.ModelProbeResult{
		VirtualKeyID:      vk.ID,
		CheckedAt:         checkedAt,
		AvailableModels:   available,
		UnavailableModels: unavailable,
		Errors:            probeErrors,
		Total:             len(candidates),
		DurationMS:        time.Since(started).Milliseconds(),
	}
	// Return list-errors too, they explain why a provider contributed no candidates.
	if len(listErrors) > 0 {
		if result.Errors == nil {
			result.Errors = map[string]string{}
		}
		for key, value := range listErrors {
			result.Errors[key] = value
		}
	}
	return result, nil
}

func (s *BifrostHTTPServer) beginModelProbe(vkID string) bool {
	s.modelProbeInFlightMu.Lock()
	defer s.modelProbeInFlightMu.Unlock()
	if s.modelProbeInFlight == nil {
		s.modelProbeInFlight = map[string]struct{}{}
	}
	if _, exists := s.modelProbeInFlight[vkID]; exists {
		return false
	}
	s.modelProbeInFlight[vkID] = struct{}{}
	return true
}

func (s *BifrostHTTPServer) finishModelProbe(vkID string) {
	s.modelProbeInFlightMu.Lock()
	delete(s.modelProbeInFlight, vkID)
	s.modelProbeInFlightMu.Unlock()
}

func (s *BifrostHTTPServer) collectModelProbeCandidates(ctx *schemas.BifrostContext, vk *configstoreTables.TableVirtualKey) ([]modelProbeCandidate, map[string]string) {
	candidates := make([]modelProbeCandidate, 0, 64)
	seen := map[string]struct{}{}
	errorsByModel := map[string]string{}

	add := func(provider schemas.ModelProvider, raw string) {
		modelName := stripProbeProviderPrefix(provider, raw)
		if modelName == "" {
			return
		}
		id := string(provider) + "/" + modelName
		if _, exists := seen[id]; exists {
			return
		}
		seen[id] = struct{}{}
		candidates = append(candidates, modelProbeCandidate{provider: provider, model: modelName, id: id})
	}

	providerOrder := make([]schemas.ModelProvider, 0, len(vk.ProviderConfigs))
	providerSeen := map[schemas.ModelProvider]struct{}{}
	providerUnrestricted := map[schemas.ModelProvider]bool{}
	for _, pc := range vk.ProviderConfigs {
		provider := schemas.ModelProvider(strings.TrimSpace(pc.Provider))
		if provider == "" {
			continue
		}
		if _, exists := providerSeen[provider]; exists {
			continue
		}
		providerSeen[provider] = struct{}{}
		providerUnrestricted[provider] = pc.AllowedModels.IsUnrestricted()
		providerOrder = append(providerOrder, provider)
		for _, model := range pc.AllowedModels {
			if model == "*" {
				continue
			}
			add(provider, model)
		}
	}

	for _, provider := range providerOrder {
		listed := 0
		response, bifrostErr := s.Client.ListModelsRequest(ctx, &schemas.BifrostListModelsRequest{Provider: provider})
		if bifrostErr != nil {
			errorsByModel[string(provider)] = probeErrorMessage(bifrostErr)
			continue
		}
		if response != nil {
			for _, model := range response.Data {
				listed++
				add(provider, model.ID)
			}
		}
		if listed == 0 && providerUnrestricted[provider] && s.Config.ModelCatalog != nil {
			// Discovery returned nothing for an unrestricted provider (custom
			// provider without list-models, or every model filtered out). Fall
			// back to the catalog so the probe still has candidates. Providers
			// with an explicit allowlist already contributed those models above;
			// falling back for them would probe models the VK cannot use.
			for _, model := range s.Config.ModelCatalog.GetModelsForProvider(provider) {
				add(provider, model)
			}
		}
	}

	// Re-probe models that failed last time even though /v1/models hides them.
	for _, entry := range vk.ModelProbeUnavailableModels {
		entry = strings.TrimSpace(entry)
		idx := strings.Index(entry, "/")
		if idx <= 0 || idx == len(entry)-1 {
			continue
		}
		provider := schemas.ModelProvider(entry[:idx])
		if _, configured := providerSeen[provider]; !configured {
			continue
		}
		add(provider, entry[idx+1:])
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].provider == candidates[j].provider {
			return candidates[i].model < candidates[j].model
		}
		return candidates[i].provider < candidates[j].provider
	})
	return candidates, errorsByModel
}

type modelProbeOutcome int

const (
	modelProbeAvailable modelProbeOutcome = iota
	modelProbeUnavailable
	modelProbeSkipped
)

func (s *BifrostHTTPServer) runModelProbeCalls(ctx *schemas.BifrostContext, candidates []modelProbeCandidate) ([]string, []string, map[string]string) {
	available := make([]string, 0, len(candidates))
	unavailable := make([]string, 0, len(candidates))
	probeErrors := map[string]string{}

	var mu sync.Mutex
	sem := make(chan struct{}, modelProbeConcurrency)
	var wg sync.WaitGroup
	for _, candidate := range candidates {
		candidate := candidate
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			outcome, message := s.probeModel(ctx, candidate)
			mu.Lock()
			defer mu.Unlock()
			switch outcome {
			case modelProbeAvailable:
				available = append(available, candidate.id)
			case modelProbeUnavailable:
				unavailable = append(unavailable, candidate.id)
			}
			if message != "" {
				probeErrors[candidate.id] = message
			}
		}()
	}
	wg.Wait()

	sort.Strings(available)
	sort.Strings(unavailable)
	return available, unavailable, probeErrors
}

func (s *BifrostHTTPServer) probeModel(ctx *schemas.BifrostContext, candidate modelProbeCandidate) (modelProbeOutcome, string) {
	callCtx := schemas.NewBifrostContext(ctx, time.Now().Add(modelProbeCallTimeout))
	defer callCtx.Cancel()

	content := "Hello! Reply with OK."
	request := &schemas.BifrostChatRequest{
		Provider: candidate.provider,
		Model:    candidate.model,
		Input: []schemas.ChatMessage{{
			Role:    schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{ContentStr: &content},
		}},
		Params: &schemas.ChatParameters{
			MaxCompletionTokens: bifrost.Ptr(64),
		},
	}
	_, bifrostErr := s.Client.ChatCompletionRequest(callCtx, request)
	if bifrostErr == nil {
		// A successful provider response is the availability signal. Requiring a
		// literal "OK" reply would falsely fail reasoning models, models that
		// answer conversationally, and any model that ignores the prompt.
		return modelProbeAvailable, ""
	}
	message := probeErrorMessage(bifrostErr)
	if modelProbeErrorIsSkippable(bifrostErr) {
		// Transient or non-chat failures say nothing about whether the model is
		// usable; leave it unprobed (fail open) instead of blocking it.
		return modelProbeSkipped, message
	}
	return modelProbeUnavailable, message
}

// modelProbeErrorIsSkippable reports whether a probe error should leave the
// model unprobed rather than mark it unavailable. Rate limits, server errors,
// timeouts, and "this model cannot chat" errors are not evidence that the model
// is permanently unavailable; treating them as such would block valid models for
// up to a day.
func modelProbeErrorIsSkippable(bifrostErr *schemas.BifrostError) bool {
	if bifrostErr == nil {
		return false
	}
	message := strings.ToLower(probeErrorMessage(bifrostErr))
	for _, hint := range []string{"deadline exceeded", "timeout", "timed out", "context canceled", "connection refused", "connection reset"} {
		if strings.Contains(message, hint) {
			return true
		}
	}
	if bifrostErr.StatusCode == nil {
		return false
	}
	code := *bifrostErr.StatusCode
	if code == 408 || code == 425 || code == 429 || code >= 500 {
		return true
	}
	if code == 400 || code == 404 || code == 405 || code == 422 {
		for _, hint := range []string{"not found", "does not exist", "unsupported", "not supported", "not a chat", "invalid model", "unknown model", "no such model", "not available in this"} {
			if strings.Contains(message, hint) {
				return true
			}
		}
	}
	return false
}

func probeErrorMessage(bifrostErr *schemas.BifrostError) string {
	if bifrostErr == nil {
		return ""
	}
	message := ""
	if bifrostErr.Error != nil {
		message = bifrostErr.Error.Message
	}
	if message == "" {
		message = "provider request failed"
	}
	if len(message) > 300 {
		message = message[:300] + "..."
	}
	return message
}

func summarizeProbeErrors(errorsByModel map[string]string) string {
	if len(errorsByModel) == 0 {
		return ""
	}
	keys := make([]string, 0, len(errorsByModel))
	for key := range errorsByModel {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, 3)
	for _, key := range keys {
		if len(parts) == 3 {
			break
		}
		parts = append(parts, key+": "+errorsByModel[key])
	}
	return strings.Join(parts, "; ")
}

func (s *BifrostHTTPServer) persistModelProbeResult(ctx context.Context, vk *configstoreTables.TableVirtualKey, available, unavailable []string, checkedAt *time.Time, errorMessage string) {
	if vk == nil {
		return
	}
	// Re-read the key before writing: a probe can run for minutes, and
	// UpdateVirtualKey writes the whole selected row, so using the snapshot
	// loaded at the start of the probe could overwrite concurrent edits.
	fresh, err := s.Config.ConfigStore.GetVirtualKey(ctx, vk.ID)
	if err != nil || fresh == nil {
		logger.Warn("model probe: virtual key %s disappeared before its result could be saved", vk.ID)
		return
	}
	if !fresh.ModelProbeEnabled {
		// The feature was switched off while the probe was running; discard the
		// result instead of resurrecting state the user just cleared.
		return
	}
	vk = fresh
	if checkedAt != nil {
		vk.ModelProbeCheckedAt = checkedAt
	}
	if available != nil || unavailable != nil {
		vk.ModelProbeAvailableModels = schemas.WhiteList(available)
		vk.ModelProbeUnavailableModels = schemas.WhiteList(unavailable)
	}
	vk.ModelProbeError = errorMessage
	if err := s.Config.ConfigStore.UpdateVirtualKey(ctx, vk); err != nil {
		logger.Error("failed to persist model probe result for virtual key %s: %v", vk.ID, err)
		return
	}
	if _, err := s.ReloadVirtualKey(ctx, vk.ID); err != nil {
		logger.Error("failed to reload virtual key %s after model probe: %v", vk.ID, err)
	}
}

// startModelProbeScheduler starts the daily probe loop. It is safe to call more
// than once: the previous loop is stopped first.
func (s *BifrostHTTPServer) startModelProbeScheduler(ctx context.Context) {
	s.modelProbeSchedulerMu.Lock()
	defer s.modelProbeSchedulerMu.Unlock()
	if s.modelProbeSchedulerStop != nil {
		s.modelProbeSchedulerStop()
	}
	schedulerCtx, cancel := context.WithCancel(ctx)
	s.modelProbeSchedulerStop = cancel
	go func() {
		logger.Info("virtual-key model probe scheduler started; next run at %s", nextModelProbeTime(time.Now()).Format(time.RFC3339))
		for {
			next := nextModelProbeTime(time.Now())
			timer := time.NewTimer(time.Until(next))
			select {
			case <-schedulerCtx.Done():
				timer.Stop()
				return
			case <-timer.C:
				s.runScheduledModelProbes(schedulerCtx)
			}
		}
	}()
}

func (s *BifrostHTTPServer) stopModelProbeScheduler() {
	s.modelProbeSchedulerMu.Lock()
	defer s.modelProbeSchedulerMu.Unlock()
	if s.modelProbeSchedulerStop != nil {
		s.modelProbeSchedulerStop()
		s.modelProbeSchedulerStop = nil
	}
}

func nextModelProbeTime(now time.Time) time.Time {
	next := time.Date(now.Year(), now.Month(), now.Day(), modelProbeDailyHour, 0, 0, 0, now.Location())
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

func (s *BifrostHTTPServer) runScheduledModelProbes(ctx context.Context) {
	if s.Config == nil || s.Config.ConfigStore == nil {
		return
	}
	virtualKeys, err := s.Config.ConfigStore.GetVirtualKeys(ctx)
	if err != nil {
		logger.Error("model probe: failed to list virtual keys: %v", err)
		return
	}
	probed := 0
	for i := range virtualKeys {
		vk := &virtualKeys[i]
		if !vk.ModelProbeEnabled || !vk.IsActiveValue() {
			continue
		}
		if vk.IsExpiredAt(time.Now().UTC()) {
			continue
		}
		result, err := s.ProbeVirtualKeyModels(ctx, vk.ID)
		if err != nil {
			logger.Warn("model probe for virtual key %s failed: %v", vk.ID, err)
			continue
		}
		probed++
		logger.Info("model probe for virtual key %s: %d available, %d unavailable", vk.ID, len(result.AvailableModels), len(result.UnavailableModels))
	}
	logger.Info("model probe run finished: %d virtual keys probed", probed)
}
