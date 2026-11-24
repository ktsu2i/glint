package settings

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLanguageDefaultsToEnglish(t *testing.T) {
	manager, _ := newTestManager()

	settings, err := manager.GetLanguage(t.Context())
	require.NoError(t, err)
	assert.Equal(t, LanguageEnglish, settings.Language)
}

func TestLanguagePersistsSupportedPreference(t *testing.T) {
	manager, store := newTestManager()

	saved, err := manager.SaveLanguage(t.Context(), SaveLanguageSettingsRequest{Language: LanguageJapanese})
	require.NoError(t, err)
	assert.Equal(t, LanguageJapanese, saved.Language)
	assert.Equal(t, "ja", store.values[languageSettingKey])

	loaded, err := manager.GetLanguage(t.Context())
	require.NoError(t, err)
	assert.Equal(t, LanguageJapanese, loaded.Language)

	_, err = manager.SaveLanguage(t.Context(), SaveLanguageSettingsRequest{Language: "fr"})
	assert.Error(t, err, "unsupported language must fail")
}
