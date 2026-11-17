package handlers

import (
	"context"
	"errors"
	"time"

	"github.com/maximhq/bifrost/framework/configstore"
	"github.com/valyala/fasthttp"
)

// ErrModelProbeInProgress is returned when a probe for the same virtual key is
// already running.
var ErrModelProbeInProgress = errors.New("model probe already in progress")

// ErrModelProbeDisabled is returned when the virtual key has model probing
// turned off.
var ErrModelProbeDisabled = errors.New("model probe is disabled for this virtual key")

// ErrModelProbeInactive is returned when a probe is requested for a virtual key
// that is inactive or expired; probing it would only produce auth failures.
var ErrModelProbeInactive = errors.New("virtual key is inactive or expired")

// ModelProbeResult is the outcome of one model-probe run for a virtual key.
type ModelProbeResult struct {
	VirtualKeyID      string            `json:"virtual_key_id"`
	CheckedAt         time.Time         `json:"checked_at"`
	AvailableModels   []string          `json:"available_models"`
	UnavailableModels []string          `json:"unavailable_models"`
	Errors            map[string]string `json:"errors,omitempty"`
	Total             int               `json:"total"`
	DurationMS        int64             `json:"duration_ms"`
}

// ModelProber is optionally implemented by the governance manager. Keeping it
// separate from GovernanceManager avoids breaking downstream implementations.
type ModelProber interface {
	ProbeVirtualKeyModels(ctx context.Context, vkID string) (*ModelProbeResult, error)
}

// probeVirtualKeyModels handles POST /api/governance/virtual-keys/{vk_id}/model-probe.
func (h *GovernanceHandler) probeVirtualKeyModels(ctx *fasthttp.RequestCtx) {
	vkID, ok := ctx.UserValue("vk_id").(string)
	if !ok || vkID == "" {
		SendError(ctx, 400, "virtual key id is required")
		return
	}
	prober, ok := h.governanceManager.(ModelProber)
	if !ok {
		SendError(ctx, 501, "model probe is not supported by this server")
		return
	}
	result, err := prober.ProbeVirtualKeyModels(ctx, vkID)
	if err != nil {
		switch {
		case errors.Is(err, configstore.ErrNotFound):
			SendError(ctx, 404, "Virtual key not found")
		case errors.Is(err, ErrModelProbeInProgress):
			SendError(ctx, 409, "A model probe is already running for this virtual key")
		case errors.Is(err, ErrModelProbeDisabled):
			SendError(ctx, 400, "Model probe is disabled for this virtual key")
		case errors.Is(err, ErrModelProbeInactive):
			SendError(ctx, 400, "Virtual key is inactive or expired")
		default:
			logger.Error("failed to probe virtual key models: %v", err)
			SendError(ctx, 500, "Failed to probe virtual key models")
		}
		return
	}
	SendJSON(ctx, result)
}
