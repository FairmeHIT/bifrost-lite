package tables

import (
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func f64(v float64) *float64 { return &v }
func i(v int) *int           { return &v }
func s(v string) *string     { return &v }

// BeforeSave → AfterFind must round-trip DefaultParameters exactly, and the
// empty cases must stay nil-clean on the way back out.
func TestTableModelPricingDefaultParametersRoundTrip(t *testing.T) {
	in := &schemas.DefaultParameters{
		Temperature:        f64(0.7),
		TopP:               f64(0.9),
		FrequencyPenalty:   f64(0.1),
		MaxTokens:          i(4096),
		ReasoningEffort:    s("xhigh"),
		ReasoningMaxTokens: i(2048),
		Custom:             map[string]string{"top_k": "8", "enable_beta": "true"},
	}
	row := &TableModelPricing{Model: "m", Provider: "p", Mode: "chat", DefaultParameters: in}

	if err := row.BeforeSave(nil); err != nil {
		t.Fatalf("BeforeSave: %v", err)
	}
	if row.DefaultParametersJSON == "" || row.DefaultParametersJSON == "{}" {
		t.Fatalf("DefaultParametersJSON = %q, want serialized defaults", row.DefaultParametersJSON)
	}

	// Simulate the read side: a fresh row carrying only the JSON column.
	read := &TableModelPricing{DefaultParametersJSON: row.DefaultParametersJSON}
	if err := read.AfterFind(nil); err != nil {
		t.Fatalf("AfterFind: %v", err)
	}
	got := read.DefaultParameters
	if got == nil {
		t.Fatal("AfterFind DefaultParameters = nil, want populated")
	}
	if got.Temperature == nil || *got.Temperature != 0.7 ||
		got.TopP == nil || *got.TopP != 0.9 ||
		got.FrequencyPenalty == nil || *got.FrequencyPenalty != 0.1 ||
		got.MaxTokens == nil || *got.MaxTokens != 4096 ||
		got.ReasoningEffort == nil || *got.ReasoningEffort != "xhigh" ||
		got.ReasoningMaxTokens == nil || *got.ReasoningMaxTokens != 2048 {
		t.Errorf("round-trip lost structured fields: %+v", got)
	}
	if len(got.Custom) != 2 || got.Custom["top_k"] != "8" || got.Custom["enable_beta"] != "true" {
		t.Errorf("round-trip lost Custom map: %+v", got.Custom)
	}
}

func TestTableModelPricingDefaultParametersNilClean(t *testing.T) {
	cases := []struct {
		name string
		json string
	}{
		{"empty string", ""},
		{"empty object", "{}"},
		// A struct with every field nil unmarshals non-nil; it must still
		// surface as "nothing configured".
		{"all-nil struct", `{"custom":{}}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			row := &TableModelPricing{DefaultParametersJSON: tc.json}
			if err := row.AfterFind(nil); err != nil {
				t.Fatalf("AfterFind(%q): %v", tc.json, err)
			}
			if row.DefaultParameters != nil {
				t.Errorf("AfterFind(%q) DefaultParameters = %+v, want nil", tc.json, row.DefaultParameters)
			}
		})
	}

	// Save side: nil defaults must serialize to a valid empty object, not "".
	row := &TableModelPricing{Model: "m", Provider: "p", Mode: "chat"}
	if err := row.BeforeSave(nil); err != nil {
		t.Fatalf("BeforeSave: %v", err)
	}
	if row.DefaultParametersJSON != "{}" {
		t.Errorf("BeforeSave nil DefaultParameters JSON = %q, want {}", row.DefaultParametersJSON)
	}
}

// AdditionalAttributes behavior must be unchanged by the DefaultParameters
// addition — both columns coexist on one row.
func TestTableModelPricingAttributesAndDefaultsCoexist(t *testing.T) {
	row := &TableModelPricing{
		AdditionalAttributes: map[string]string{"tier": "premium"},
		DefaultParameters:    &schemas.DefaultParameters{ReasoningEffort: s("high")},
	}
	if err := row.BeforeSave(nil); err != nil {
		t.Fatalf("BeforeSave: %v", err)
	}
	read := &TableModelPricing{
		AdditionalAttributesJSON: row.AdditionalAttributesJSON,
		DefaultParametersJSON:    row.DefaultParametersJSON,
	}
	if err := read.AfterFind(nil); err != nil {
		t.Fatalf("AfterFind: %v", err)
	}
	if read.AdditionalAttributes["tier"] != "premium" {
		t.Errorf("AdditionalAttributes lost: %+v", read.AdditionalAttributes)
	}
	if read.DefaultParameters == nil || read.DefaultParameters.ReasoningEffort == nil ||
		*read.DefaultParameters.ReasoningEffort != "high" {
		t.Errorf("DefaultParameters lost: %+v", read.DefaultParameters)
	}
}
