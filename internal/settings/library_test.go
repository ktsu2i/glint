package settings

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLibrarySettingsDefaultToRecent(t *testing.T) {
	manager, _ := newTestManager()

	settings, err := manager.GetLibrary(t.Context())

	require.NoError(t, err)
	assert.Equal(t, LibrarySortRecent, settings.SortOrder)
}

func TestLibrarySettingsPersistSortOrder(t *testing.T) {
	manager, store := newTestManager()

	saved, err := manager.SaveLibrary(t.Context(), LibrarySettings{SortOrder: LibrarySortTitle})

	require.NoError(t, err)
	assert.Equal(t, LibrarySortTitle, saved.SortOrder)
	assert.Equal(t, "title", store.values[librarySortOrderSettingKey])
	loaded, err := manager.GetLibrary(t.Context())
	require.NoError(t, err)
	assert.Equal(t, LibrarySortTitle, loaded.SortOrder)
}

func TestLibrarySettingsRejectUnknownSortOrder(t *testing.T) {
	manager, store := newTestManager()

	_, err := manager.SaveLibrary(t.Context(), LibrarySettings{SortOrder: "size"})
	assert.ErrorIs(t, err, ErrInvalidLibrarySortOrder)
	assert.Empty(t, store.values)

	store.values[librarySortOrderSettingKey] = "size"
	_, err = manager.GetLibrary(t.Context())
	assert.ErrorContains(t, err, "invalid saved library sort order")
}
