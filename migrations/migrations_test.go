package migrations_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/glebarez/go-sqlite"
	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ktsu2i/glint/migrations"
)

func schema(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rows, err := db.QueryContext(t.Context(),
		"SELECT type || ' ' || name FROM sqlite_master WHERE name <> 'goose_db_version' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	require.NoError(t, err)
	defer func() { _ = rows.Close() }()
	var objects []string
	for rows.Next() {
		var object string
		require.NoError(t, rows.Scan(&object))
		objects = append(objects, object)
	}
	require.NoError(t, rows.Err())
	return objects
}

// Every migration must roll back cleanly, so `goose down` can be used while
// iterating on a new migration.
func TestMigrationsRollBackAndReapply(t *testing.T) {
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })
	provider, err := goose.NewProvider(database.DialectSQLite3, db, migrations.FS)
	require.NoError(t, err)

	_, err = provider.Up(t.Context())
	require.NoError(t, err)
	applied := schema(t, db)
	require.NotEmpty(t, applied)

	_, err = provider.DownTo(t.Context(), 0)
	require.NoError(t, err)
	assert.Empty(t, schema(t, db), "Down must remove everything Up created")

	_, err = provider.Up(t.Context())
	require.NoError(t, err)
	assert.Equal(t, applied, schema(t, db))
}
