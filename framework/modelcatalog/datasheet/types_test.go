package datasheet

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	configstoreTables "github.com/maximhq/bifrost/framework/configstore/tables"
)

// DB rows loaded through LoadFromDB must carry their DefaultParameters onto
// the Entry — the URL datasheet cannot set them (json:"-"), so this conversion
// is the only path user-configured defaults reach the catalog through.
func TestConvertTablePricingToEntryCarriesDefaultParameters(t *testing.T) {
	row := &configstoreTables.TableModelPricing{
		Model:    "deepseek-v4-flash",
		Provider: "shangtang",
		Mode:     "chat",
		DefaultParameters: &schemas.DefaultParameters{
			ReasoningEffort: schemas.Ptr("xhigh"),
			Custom:          map[string]string{"top_k": "8"},
		},
	}

	entry := convertTablePricingToEntry(row)

	if entry.DefaultParameters == nil {
		t.Fatal("Entry.DefaultParameters = nil, want carried from DB row")
	}
	if entry.DefaultParameters.ReasoningEffort == nil || *entry.DefaultParameters.ReasoningEffort != "xhigh" {
		t.Errorf("ReasoningEffort = %v, want xhigh", entry.DefaultParameters.ReasoningEffort)
	}
	if entry.DefaultParameters.Custom["top_k"] != "8" {
		t.Errorf("Custom[top_k] = %v, want 8", entry.DefaultParameters.Custom["top_k"])
	}
}

// A row without defaults (the pre-migration state of every existing row) must
// convert to a nil Entry.DefaultParameters, not a zero struct.
func TestConvertTablePricingToEntryNilDefaultParameters(t *testing.T) {
	entry := convertTablePricingToEntry(&configstoreTables.TableModelPricing{
		Model: "m", Provider: "p", Mode: "chat",
	})
	if entry.DefaultParameters != nil {
		t.Errorf("Entry.DefaultParameters = %+v, want nil for unconfigured row", entry.DefaultParameters)
	}
}
