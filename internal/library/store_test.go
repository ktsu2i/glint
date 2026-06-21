package library

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	gormsqlite "github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestStorePersistsLibraryAndReadingPosition(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, time.June, 21, 10, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	var version int
	require.NoError(t, store.db.Raw("SELECT MAX(version) FROM schema_migrations").Row().Scan(&version))
	assert.Equal(t, 2, version)

	book, err := store.Import(context.Background(), "book-1", "/tmp/Go Guide.pdf", "hash-1", 120, now)
	require.NoError(t, err)
	assert.Equal(t, "Go Guide", book.Title)
	assert.Equal(t, 1, book.LastPage)
	assert.Equal(t, "pending", book.CoverThumbnailStatus)
	require.NoError(t, store.MarkOpened(context.Background(), book.ID, now.Add(time.Minute)))
	require.NoError(t, store.SaveReadingPosition(context.Background(), book.ID, 7, 20, now.Add(2*time.Minute)))
	require.NoError(t, store.SaveCover(context.Background(), book.ID, "/tmp/cover.png", now.Add(3*time.Minute)))
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	books, err := store.List(context.Background())
	require.NoError(t, err)
	require.Len(t, books, 1)
	persisted := books[0]
	assert.Equal(t, 7, persisted.LastPage)
	assert.Equal(t, 20, persisted.PageCount)
	assert.Equal(t, "ready", persisted.CoverThumbnailStatus)
	assert.NotEmpty(t, persisted.LastOpenedAt)
}

func TestStorePersistsNonSecretAppSettings(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	store, err := Open(path)
	require.NoError(t, err)

	value, err := store.Setting(context.Background(), "missing")
	require.NoError(t, err)
	assert.Empty(t, value)
	require.NoError(t, store.SaveSetting(context.Background(), "llm.openrouter", `{"model":"provider/model"}`))
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	value, err = store.Setting(context.Background(), "llm.openrouter")
	require.NoError(t, err)
	assert.Equal(t, `{"model":"provider/model"}`, value)
}

func TestStoreUpgradesLegacyMigrationTable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	db, err := gorm.Open(gormsqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.Exec(`CREATE TABLE schema_migrations (
        version INTEGER NOT NULL PRIMARY KEY,
        dirty BOOLEAN NOT NULL
    )`).Error)
	require.NoError(t, db.Exec("INSERT INTO schema_migrations (version, dirty) VALUES (1, 0)").Error)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	store, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	var version int
	require.NoError(t, store.db.Raw("SELECT MAX(version) FROM schema_migrations").Row().Scan(&version))
	assert.Equal(t, 2, version)
	var settingsTable string
	require.NoError(t, store.db.Raw("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_settings'").Row().Scan(&settingsTable))
	assert.Equal(t, "app_settings", settingsTable)
}

func TestStoreDeduplicatesByFileHashAndUpdatesLocation(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	first, err := store.Import(context.Background(), "book-1", "/old/Guide.pdf", "same-hash", 10, now)
	require.NoError(t, err)
	second, err := store.Import(context.Background(), "book-2", "/new/Guide.pdf", "same-hash", 11, now.Add(time.Minute))
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, "/new/Guide.pdf", second.SourcePath)
	assert.EqualValues(t, 11, second.SizeBytes)
	books, err := store.List(context.Background())
	require.NoError(t, err)
	assert.Len(t, books, 1)
}

func TestStoreRemoveDeletesBookAndReadingState(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()

	book, err := store.Import(context.Background(), "book-1", "/tmp/Guide.pdf", "hash-1", 10, now)
	require.NoError(t, err)
	require.NoError(t, store.SaveReadingPosition(context.Background(), book.ID, 4, 10, now))

	require.NoError(t, store.Remove(context.Background(), book.ID))
	_, err = store.Get(context.Background(), book.ID)
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.ErrorIs(t, store.Remove(context.Background(), book.ID), ErrBookNotFound)

	var remaining int
	require.NoError(t, store.db.Raw("SELECT COUNT(*) FROM book_reading_states WHERE book_id = ?", book.ID).Row().Scan(&remaining))
	assert.Equal(t, 0, remaining)
}

func TestStoreValidatesUpdatesAndMissingBooks(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })

	_, err = store.Get(context.Background(), "missing")
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.Error(t, store.SaveReadingPosition(context.Background(), "missing", 0, 0, time.Now()))
	assert.ErrorIs(t, store.MarkCoverFailed(context.Background(), "missing", time.Now()), ErrBookNotFound)
}
