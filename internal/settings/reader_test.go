package settings

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReaderSettingsDefault(t *testing.T) {
	manager, _ := newTestManager()

	settings, err := manager.GetReader(t.Context())

	require.NoError(t, err)
	assert.Equal(t, ReaderSettings{EPUBFontScale: DefaultEPUBFontScale, EPUBLayout: EPUBLayoutSpread}, settings)
}

func TestReaderSettingsPersist(t *testing.T) {
	manager, store := newTestManager()

	saved, err := manager.SaveReader(t.Context(), ReaderSettings{EPUBFontScale: 140, EPUBLayout: EPUBLayoutSingle})

	require.NoError(t, err)
	assert.Equal(t, ReaderSettings{EPUBFontScale: 140, EPUBLayout: EPUBLayoutSingle}, saved)
	assert.Equal(t, "140", store.values[readerEPUBFontScaleSettingKey])
	assert.Equal(t, "single", store.values[readerEPUBLayoutSettingKey])
	loaded, err := manager.GetReader(t.Context())
	require.NoError(t, err)
	assert.Equal(t, saved, loaded)
}

func TestReaderSettingsRejectInvalidValues(t *testing.T) {
	manager, store := newTestManager()

	for _, request := range []ReaderSettings{
		{EPUBFontScale: MinEPUBFontScale - 1, EPUBLayout: EPUBLayoutSpread},
		{EPUBFontScale: MaxEPUBFontScale + 1, EPUBLayout: EPUBLayoutSpread},
		{EPUBFontScale: 100, EPUBLayout: "triple"},
	} {
		_, err := manager.SaveReader(t.Context(), request)
		assert.ErrorIs(t, err, ErrInvalidReaderSettings)
	}
	assert.Empty(t, store.values)

	store.values[readerEPUBFontScaleSettingKey] = "huge"
	_, err := manager.GetReader(t.Context())
	assert.ErrorContains(t, err, "invalid saved EPUB font scale")

	store.values[readerEPUBFontScaleSettingKey] = "120"
	store.values[readerEPUBLayoutSettingKey] = "triple"
	_, err = manager.GetReader(t.Context())
	assert.ErrorContains(t, err, "invalid saved EPUB layout")
}
