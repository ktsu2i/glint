package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSettingsServiceRoundTripsAndLocalizesErrors(t *testing.T) {
	h := newHarness(t)
	service := NewSettingsService(h.settings)
	_, err := service.GetLanguageSettings()
	require.ErrorIs(t, err, errNotReady)
	Startup(t.Context(), service)

	appearance, err := service.SaveAppearanceSettings(SaveAppearanceSettingsRequest{Theme: "dark"})
	require.NoError(t, err)
	assert.Equal(t, "dark", appearance.Theme)
	appearance, err = service.GetAppearanceSettings()
	require.NoError(t, err)
	assert.Equal(t, "dark", appearance.Theme)
	_, err = service.SaveAppearanceSettings(SaveAppearanceSettingsRequest{Theme: "sepia"})
	assert.EqualError(t, err, "Theme must be light, dark, or system.")

	language, err := service.SaveLanguageSettings(SaveLanguageSettingsRequest{Language: "ja"})
	require.NoError(t, err)
	assert.Equal(t, "ja", language.Language)
	language, err = service.GetLanguageSettings()
	require.NoError(t, err)
	assert.Equal(t, "ja", language.Language)
	_, err = service.SaveLanguageSettings(SaveLanguageSettingsRequest{Language: "fr"})
	assert.EqualError(t, err, "言語は en または ja を指定してください。")
}
