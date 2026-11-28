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
