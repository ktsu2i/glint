package settings

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAppearanceDefaultsToSystem(t *testing.T) {
	manager, _ := newTestManager()

	settings, err := manager.GetAppearance(t.Context())

	require.NoError(t, err)
	assert.Equal(t, ThemeSystem, settings.Theme)
}

func TestAppearancePersistsSupportedTheme(t *testing.T) {
	manager, store := newTestManager()

	saved, err := manager.SaveAppearance(t.Context(), SaveAppearanceSettingsRequest{Theme: ThemeDark})

	require.NoError(t, err)
	assert.Equal(t, ThemeDark, saved.Theme)
	assert.Equal(t, "dark", store.values[appearanceThemeSettingKey])

	loaded, err := manager.GetAppearance(t.Context())
	require.NoError(t, err)
	assert.Equal(t, ThemeDark, loaded.Theme)
}

func TestAppearanceRejectsUnsupportedTheme(t *testing.T) {
	manager, store := newTestManager()

	_, err := manager.SaveAppearance(t.Context(), SaveAppearanceSettingsRequest{Theme: "sepia"})

	assert.ErrorContains(t, err, "light、dark、system")
	assert.NotContains(t, store.values, appearanceThemeSettingKey)
}

func TestAppearanceRejectsInvalidPersistedTheme(t *testing.T) {
	manager, store := newTestManager()
	store.values[appearanceThemeSettingKey] = "sepia"

	_, err := manager.GetAppearance(t.Context())

	assert.ErrorContains(t, err, "invalid saved theme")
}
