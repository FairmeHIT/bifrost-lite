package configstore

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/framework/configstore/tables"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// TestMigrationAddVKModelProbeColumns verifies the virtual-key model-probe
// columns are added to an existing table and that replaying the migration is a
// no-op, matching the migration runner's every-boot behavior.
func TestMigrationAddVKModelProbeColumns(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	require.NoError(t, err)

	require.NoError(t, db.Exec(`
		CREATE TABLE governance_virtual_keys (
			id VARCHAR(255) PRIMARY KEY
		)
	`).Error)

	ctx := context.Background()
	columns := []string{
		"model_probe_enabled",
		"model_probe_available_models",
		"model_probe_unavailable_models",
		"model_probe_checked_at",
		"model_probe_error",
	}
	for _, column := range columns {
		require.False(t, db.Migrator().HasColumn(&tables.TableVirtualKey{}, column),
			"precondition: %s must be absent before the migration runs", column)
	}

	require.NoError(t, migrationAddVKModelProbeColumns(ctx, db, testMigrationLogger))
	for _, column := range columns {
		assert.True(t, db.Migrator().HasColumn(&tables.TableVirtualKey{}, column),
			"expected column %s after the migration", column)
	}

	// Migrations are replayed on every boot.
	require.NoError(t, migrationAddVKModelProbeColumns(ctx, db, testMigrationLogger))

	require.NoError(t, db.Exec(`INSERT INTO governance_virtual_keys (id) VALUES ('vk-test')`).Error)
	var vk tables.TableVirtualKey
	require.NoError(t, db.First(&vk, "id = ?", "vk-test").Error)
	assert.False(t, vk.ModelProbeEnabled)
	assert.Empty(t, vk.ModelProbeAvailableModels)
	assert.Nil(t, vk.ModelProbeCheckedAt)
}
