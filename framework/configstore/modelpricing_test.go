package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// setupPricingOnlyStore creates an in-memory SQLite DB with just the
// governance_model_pricing table, returning an RDBConfigStore bound to it.
func setupPricingOnlyStore(t *testing.T) *RDBConfigStore {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err, "create test db")
	require.NoError(t, db.AutoMigrate(&tables.TableModelPricing{}), "migrate pricing table")
	s := &RDBConfigStore{logger: nil}
	s.db.Store(db)
	return s
}

// EnsureModelPricingRow inserts a minimal chat row when none exists, so a
// custom provider model (no datasheet pricing row) can be configured.
func TestEnsureModelPricingRowCreatesMinimalRow(t *testing.T) {
	s := setupPricingOnlyStore(t)
	ctx := context.Background()

	require.NoError(t, s.EnsureModelPricingRow(ctx, "jt/dsv4", "my-free-llm-hub", "chat"))

	var row tables.TableModelPricing
	require.NoError(t, s.DB().Where("model = ? AND provider = ? AND mode = ?", "jt/dsv4", "my-free-llm-hub", "chat").First(&row).Error)
	require.Equal(t, "jt/dsv4", row.Model)
	require.Equal(t, "my-free-llm-hub", row.Provider)
	require.Equal(t, "chat", row.Mode)
	// Columns must be valid JSON objects, never NULL/empty.
	require.Equal(t, "{}", row.AdditionalAttributesJSON)
	require.Equal(t, "{}", row.DefaultParametersJSON)
	// AfterFind surfaces them as nil (nothing configured yet).
	require.Nil(t, row.AdditionalAttributes)
	require.Nil(t, row.DefaultParameters)
}

// Idempotent: re-running on an existing row does not error and does not
// duplicate or clobber it.
func TestEnsureModelPricingRowIdempotent(t *testing.T) {
	s := setupPricingOnlyStore(t)
	ctx := context.Background()

	require.NoError(t, s.EnsureModelPricingRow(ctx, "m", "p", "chat"))
	// Set a default on the row, then ensure again — the ensure must NOT
	// overwrite it (DoNothing on conflict leaves the row untouched).
	_, err := s.UpsertModelPricingDefaultParameters(ctx, "m", "p", &schemas.DefaultParameters{
		ReasoningEffort: schemas.Ptr("xhigh"),
	})
	require.NoError(t, err)
	require.NoError(t, s.EnsureModelPricingRow(ctx, "m", "p", "chat"))
	require.NoError(t, s.EnsureModelPricingRow(ctx, "m", "p", "chat"))

	var row tables.TableModelPricing
	require.NoError(t, s.DB().Where("model = ? AND provider = ? AND mode = ?", "m", "p", "chat").First(&row).Error)
	// Exactly one row.
	var count int64
	s.DB().Model(&tables.TableModelPricing{}).Where("model = ? AND provider = ? AND mode = ?", "m", "p", "chat").Count(&count)
	require.EqualValues(t, 1, count)
	// Default preserved across the idempotent ensures.
	require.NotNil(t, row.DefaultParameters)
	require.NotNil(t, row.DefaultParameters.ReasoningEffort)
	require.Equal(t, "xhigh", *row.DefaultParameters.ReasoningEffort)
}

// An empty model/provider/mode is rejected — never insert a row with a NULL
// natural key.
func TestEnsureModelPricingRowRejectsEmptyKey(t *testing.T) {
	s := setupPricingOnlyStore(t)
	require.Error(t, s.EnsureModelPricingRow(context.Background(), "", "p", "chat"))
	require.Error(t, s.EnsureModelPricingRow(context.Background(), "m", "", "chat"))
	require.Error(t, s.EnsureModelPricingRow(context.Background(), "m", "p", ""))
}
