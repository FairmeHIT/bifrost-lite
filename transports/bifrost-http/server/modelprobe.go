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
	// Probes are independent, so run them wide: 16 in flight keeps a large
	// catalog inside the run budget even when every call hits its deadline.
	modelProbeConcurrency = 16
	// Each model gets its own short deadline. Slow or reasoning-heavy models
	// that exceed it are marked unavailable and can be retried in the next run.
	modelProbeCallTimeout    = 10 * time.Second
	modelProbeRunTimeout     = 45 * time.Minute
	modelProbePersistTimeout = 10 * time.Second
	modelProbeMaxModels      = 2000
	modelProbeDailyHour      = 1
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
// model is available only when its response text contains OK, ignoring case.
// Failed calls are unavailable and retried on subsequent runs. Results are persisted on the virtual
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
		unavailable := append(append([]string{}, vk.ModelProbeUnavailableModels...), vk.ModelProbeAvailableModels...)
		checkedAt := time.Now().UTC()
		persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), modelProbePersistTimeout)
		defer cancel()
		if err := s.persistModelProbeResult(persistCtx, vk, []string{}, unavailable, &checkedAt, message); err != nil {
			return nil, err
		}
		return &handlers.ModelProbeResult{
			VirtualKeyID:      vk.ID,
			CheckedAt:         checkedAt,
			AvailableModels:   []string{},
			UnavailableModels: unavailable,
			Errors:            listErrors,
			Total:             0,
			DurationMS:        time.Since(started).Milliseconds(),
		}, nil
	}
	var truncated []modelProbeCandidate
	if len(candidates) > modelProbeMaxModels {
		truncated = candidates[modelProbeMaxModels:]
		candidates = candidates[:modelProbeMaxModels]
	}

	available, unavailable, probeErrors := s.runModelProbeCalls(probeCtx, candidates)
	for _, candidate := range truncated {
		unavailable = append(unavailable, candidate.id)
	}
	if err := probeCtx.Err(); err != nil {
		// An incomplete run cannot validate any previous success.
		all := append(append([]string{}, vk.ModelProbeUnavailableModels...), vk.ModelProbeAvailableModels...)
		for _, candidate := range candidates {
			all = append(all, candidate.id)
		}
		now := time.Now().UTC()
		persistCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), modelProbePersistTimeout)
		defer cancel()
		if persistErr := s.persistModelProbeResult(persistCtx, vk, []string{}, all, &now, err.Error()); persistErr != nil {
			return nil, errors.Join(fmt.Errorf("model probe was cancelled before completion: %w", err), persistErr)
		}
		return nil, fmt.Errorf("model probe was cancelled before completion: %w", err)
	}
	checkedAt := time.Now().UTC()
	errorMessage := ""
	if len(available) == 0 {
		errorMessage = "no model responded successfully"
		if len(probeErrors) > 0 {
			errorMessage = fmt.Sprintf("no model responded successfully (%d checked): %s", len(probeErrors), summarizeProbeErrors(probeErrors))
		}
	}
	if len(listErrors) > 0 {
		// Some providers could not be listed, but other models were probed
		// successfully. Keep the successful outcome: a partial provider outage
		// should not surface as a probe error when the provider status badges
		// already report it, and the manual result still carries the details.
		logger.Warn("model probe for virtual key %s could not list some providers: %s", vk.ID, summarizeProbeErrors(listErrors))
		for _, entry := range vk.ModelProbeAvailableModels {
			if i := strings.Index(entry, "/"); i > 0 {
				if _, failed := listErrors[entry[:i]]; failed {
					found := false
					for _, id := range available {
						if id == entry {
							found = true
							break
						}
					}
					if !found {
						unavailable = append(unavailable, entry)
					}
				}
			}
		}
	}
	if err := s.persistModelProbeResult(ctx, vk, available, unavailable, &checkedAt, errorMessage); err != nil {
		return nil, err
	}

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
		if modelProbeProviderExemptServer(vk, provider) {
			// Exempt providers are not probed at all: no listing, no catalog
			// fallback, no chat calls. Their models are never gated by probe
			// results.
			continue
		}
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
	for _, entry := range append(append([]string{}, vk.ModelProbeUnavailableModels...), vk.ModelProbeAvailableModels...) {
		entry = strings.TrimSpace(entry)
		idx := strings.Index(entry, "/")
		if idx <= 0 || idx == len(entry)-1 {
			continue
		}
		provider := schemas.ModelProvider(entry[:idx])
		if _, configured := providerSeen[provider]; !configured {
			continue
		}
		if modelProbeProviderExemptServer(vk, provider) {
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
	response, bifrostErr := s.Client.ChatCompletionRequest(callCtx, request)
	if bifrostErr != nil {
		return modelProbeUnavailable, probeErrorMessage(bifrostErr)
	}
	if modelProbeResponseContainsOK(response) {
		return modelProbeAvailable, ""
	}
	return modelProbeUnavailable, "response text did not contain OK"
}

func modelProbeResponseContainsOK(response *schemas.BifrostChatResponse) bool {
	if response == nil {
		return false
	}
	for _, choice := range response.Choices {
		if choice.ChatNonStreamResponseChoice == nil || choice.Message == nil || choice.Message.Content == nil {
			continue
		}
		content := choice.Message.Content
		if content.ContentStr != nil && strings.Contains(strings.ToLower(*content.ContentStr), "ok") {
			return true
		}
		for _, block := range content.ContentBlocks {
			if block.Text != nil && strings.Contains(strings.ToLower(*block.Text), "ok") {
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

// modelProbeProviderExemptServer mirrors the governance plugin's exemption check
// locally: providers on the VK's model-probe exemption list are never probed.
func modelProbeProviderExemptServer(vk *configstoreTables.TableVirtualKey, provider schemas.ModelProvider) bool {
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

// filterExemptProbeEntries removes provider-qualified entries whose provider is
// on the exemption list. Returns nil when the input is nil.
func filterExemptProbeEntries(vk *configstoreTables.TableVirtualKey, entries []string) []string {
	if entries == nil || len(vk.ModelProbeExemptProviders) == 0 {
		return entries
	}
	kept := make([]string, 0, len(entries))
	for _, entry := range entries {
		idx := strings.Index(entry, "/")
		if idx > 0 && modelProbeProviderExemptServer(vk, schemas.ModelProvider(entry[:idx])) {
			continue
		}
		kept = append(kept, entry)
	}
	return kept
}

func (s *BifrostHTTPServer) persistModelProbeResult(ctx context.Context, vk *configstoreTables.TableVirtualKey, available, unavailable []string, checkedAt *time.Time, errorMessage string) error {
	if vk == nil {
		return errors.New("cannot persist model probe result for nil virtual key")
	}
	// Re-read the key before writing: a probe can run for minutes, and
	// UpdateVirtualKey writes the whole selected row, so using the snapshot
	// loaded at the start of the probe could overwrite concurrent edits.
	fresh, err := s.Config.ConfigStore.GetVirtualKey(ctx, vk.ID)
	if err != nil {
		return fmt.Errorf("model probe: read virtual key %s: %w", vk.ID, err)
	}
	if fresh == nil {
		return fmt.Errorf("model probe: virtual key %s not found: %w", vk.ID, configstore.ErrNotFound)
	}
	if !fresh.ModelProbeEnabled {
		// The feature was switched off while the probe was running; discard the
		// result instead of resurrecting state the user just cleared.
		return handlers.ErrModelProbeDisabled
	}
	vk = fresh
	// Drop entries for providers that became exempt since the probe ran, so a
	// newly-exempted provider's stale probe outcome cannot gate its models.
	if len(vk.ModelProbeExemptProviders) > 0 && (available != nil || unavailable != nil) {
		available = filterExemptProbeEntries(vk, available)
		unavailable = filterExemptProbeEntries(vk, unavailable)
	}
	if checkedAt != nil {
		vk.ModelProbeCheckedAt = checkedAt
	}
	if available != nil || unavailable != nil {
		vk.ModelProbeAvailableModels = schemas.WhiteList(available)
		vk.ModelProbeUnavailableModels = schemas.WhiteList(unavailable)
	}
	vk.ModelProbeError = errorMessage
	if err := s.Config.ConfigStore.UpdateVirtualKey(ctx, vk); err != nil {
		return fmt.Errorf("failed to persist model probe result for virtual key %s: %w", vk.ID, err)
	}
	if _, err := s.ReloadVirtualKey(ctx, vk.ID); err != nil {
		return fmt.Errorf("failed to reload virtual key %s after model probe: %w", vk.ID, err)
	}
	return nil
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
