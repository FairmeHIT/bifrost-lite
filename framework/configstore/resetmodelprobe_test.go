package configstore

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestResetLegacyVKModelProbeResults(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE governance_virtual_keys (
		id TEXT PRIMARY KEY, model_probe_enabled BOOLEAN, model_probe_available_models TEXT,
		model_probe_unavailable_models TEXT, model_probe_checked_at TIMESTAMP, model_probe_error TEXT
	)`).Error)
	require.NoError(t, db.Exec(`INSERT INTO governance_virtual_keys VALUES
		('enabled', true, '["old"]', '["bad"]', '2025-01-01 00:00:00', 'old error'),
		('disabled', false, '["old"]', '["bad"]', '2025-01-01 00:00:00', 'old error')`).Error)

	var step *migrationStep
	for i := range configstoreMigrationSteps {
		if len(configstoreMigrationSteps[i].IDs) == 1 && configstoreMigrationSteps[i].IDs[0] == "reset_legacy_vk_model_probe_results" {
			step = &configstoreMigrationSteps[i]
			break
		}
	}
	require.NotNil(t, step, "reset migration must be registered")
	require.NoError(t, step.run(context.Background(), db, testMigrationLogger))
	var count int64
	require.NoError(t, db.Raw(`SELECT COUNT(*) FROM governance_virtual_keys WHERE
		model_probe_available_models IS NULL AND model_probe_unavailable_models IS NULL AND
		model_probe_checked_at IS NULL AND (model_probe_error IS NULL OR model_probe_error = '')`).Scan(&count).Error)
	require.EqualValues(t, 2, count)
	require.NoError(t, db.Raw(`SELECT COUNT(*) FROM governance_virtual_keys WHERE
		(id = 'enabled' AND model_probe_enabled = true) OR (id = 'disabled' AND model_probe_enabled = false)`).Scan(&count).Error)
	require.EqualValues(t, 2, count)

	// Newly probed results survive another startup; the migration is recorded once.
	require.NoError(t, db.Exec(`UPDATE governance_virtual_keys SET model_probe_available_models = '["new"]', model_probe_checked_at = '2026-01-01 00:00:00', model_probe_error = 'new error' WHERE id = 'enabled'`).Error)
	require.NoError(t, step.run(context.Background(), db, testMigrationLogger))
	require.NoError(t, db.Raw(`SELECT COUNT(*) FROM governance_virtual_keys WHERE id = 'enabled' AND model_probe_available_models = '["new"]' AND model_probe_checked_at IS NOT NULL AND model_probe_error = 'new error'`).Scan(&count).Error)
	require.EqualValues(t, 1, count)
}
