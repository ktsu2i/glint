package sqlite

import (
	"database/sql"
	"path/filepath"
	"testing"
	"testing/fstest"

	_ "github.com/glebarez/go-sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var testMigrations = fstest.MapFS{
	"00001_init.sql": &fstest.MapFile{Data: []byte(`-- +goose Up
CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);

-- +goose Down
DROP TABLE notes;
`)},
	"00002_note_title.sql": &fstest.MapFile{Data: []byte(`-- +goose Up
ALTER TABLE notes ADD COLUMN title TEXT NOT NULL DEFAULT '';
`)},
}

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	_, err := db.ExecContext(t.Context(), query, args...)
	require.NoError(t, err)
}

func appliedVersion(t *testing.T, db *sql.DB) int64 {
	t.Helper()
	var version int64
	require.NoError(t, db.QueryRowContext(t.Context(), "SELECT MAX(version_id) FROM goose_db_version").Scan(&version))
	return version
}

func tableExists(t *testing.T, db *sql.DB, name string) bool {
	t.Helper()
	var count int
	require.NoError(t, db.QueryRowContext(t.Context(),
		"SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", name,
	).Scan(&count))
	return count > 0
}

func TestMigrateAppliesPendingMigrationsOnce(t *testing.T) {
	db := openTestDB(t)
	require.NoError(t, Migrate(t.Context(), db, testMigrations))
	exec(t, db, "INSERT INTO notes (body, title) VALUES ('kept', 't')")
	require.NoError(t, Migrate(t.Context(), db, testMigrations))

	assert.Equal(t, int64(2), appliedVersion(t, db))
	var body string
	require.NoError(t, db.QueryRowContext(t.Context(), "SELECT body FROM notes").Scan(&body))
	assert.Equal(t, "kept", body)
}

func TestMigrateAdoptsLegacySchema(t *testing.T) {
	db := openTestDB(t)
	exec(t, db, "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)")
	exec(t, db, "INSERT INTO notes (body) VALUES ('kept')")
	exec(t, db, "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
	for version := 1; version <= legacySquashedVersion; version++ {
		exec(t, db, "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, 'legacy', 'now')", version)
	}

	require.NoError(t, Migrate(t.Context(), db, testMigrations))

	assert.False(t, tableExists(t, db, "schema_migrations"))
	assert.Equal(t, int64(2), appliedVersion(t, db), "only migrations after the squashed baseline run")
	var body, title string
	require.NoError(t, db.QueryRowContext(t.Context(), "SELECT body, title FROM notes").Scan(&body, &title))
	assert.Equal(t, "kept", body)
	assert.Empty(t, title)
}

func TestMigrateRejectsUnsupportedLegacyVersion(t *testing.T) {
	db := openTestDB(t)
	exec(t, db, "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)")
	exec(t, db, "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, 'legacy', 'now')", legacySquashedVersion-1)

	err := Migrate(t.Context(), db, testMigrations)

	require.ErrorIs(t, err, ErrLegacySchema)
	assert.True(t, tableExists(t, db, "schema_migrations"))
	assert.False(t, tableExists(t, db, "goose_db_version"))
}
