package app

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestSettingsServiceRoundTripsAndLocalizesErrors(t *testing.T) {
	h := newHarness(t)
	emitter := &fakeEmitter{}
	service := NewSettingsService(h.settings, emitter)
	_, err := service.GetLanguageSettings()
	require.ErrorIs(t, err, errNotReady)
	require.NoError(t, service.ServiceStartup(t.Context(), application.ServiceOptions{}))

	appearance, err := service.SaveAppearanceSettings(SaveAppearanceSettingsRequest{Theme: "dark"})
	require.NoError(t, err)
	assert.Equal(t, "dark", appearance.Theme)
	appearance, err = service.GetAppearanceSettings()
	require.NoError(t, err)
	assert.Equal(t, "dark", appearance.Theme)
	_, err = service.SaveAppearanceSettings(SaveAppearanceSettingsRequest{Theme: "sepia"})
	assert.EqualError(t, err, "Theme must be light, dark, or system.")

	assert.Equal(t, []emittedEvent{
		{name: "settings:appearance-changed", data: AppearanceSettings{Theme: "dark"}},
	}, emitter.events)

	language, err := service.SaveLanguageSettings(SaveLanguageSettingsRequest{Language: "ja"})
	require.NoError(t, err)
	assert.Equal(t, "ja", language.Language)
	language, err = service.GetLanguageSettings()
	require.NoError(t, err)
	assert.Equal(t, "ja", language.Language)
	_, err = service.SaveLanguageSettings(SaveLanguageSettingsRequest{Language: "fr"})
	assert.EqualError(t, err, "言語は en または ja を指定してください。")
	assert.Equal(t, []emittedEvent{
		{name: "settings:appearance-changed", data: AppearanceSettings{Theme: "dark"}},
		{name: "settings:language-changed", data: LanguageSettings{Language: "ja"}},
	}, emitter.events)
}

func TestSettingsServiceSavesWithoutAnEmitter(t *testing.T) {
	h := newHarness(t)
	service := NewSettingsService(h.settings, nil)
	require.NoError(t, service.ServiceStartup(t.Context(), application.ServiceOptions{}))

	appearance, err := service.SaveAppearanceSettings(SaveAppearanceSettingsRequest{Theme: "light"})
	require.NoError(t, err)
	assert.Equal(t, "light", appearance.Theme)
}

type emittedEvent struct {
	name string
	data any
}

type fakeEmitter struct {
	events []emittedEvent
}

func (f *fakeEmitter) Emit(name string, data ...any) bool {
	var payload any
	if len(data) == 1 {
		payload = data[0]
	}
	f.events = append(f.events, emittedEvent{name: name, data: payload})
	return false
}
