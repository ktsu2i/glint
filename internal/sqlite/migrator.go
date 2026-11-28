package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/database"
)

// ErrLegacySchema reports a database left by the old migrator at a version
// other than the one 00001_init.sql squashes, which goose cannot take over.
var ErrLegacySchema = errors.New("database was migrated by the old migrator to an unsupported version")

// legacySquashedVersion is the last version of the old migrator, whose
// migrations were squashed into 00001_init.sql.
const legacySquashedVersion = 15

// Migrate applies the pending goose migrations in fsys to db.
func Migrate(ctx context.Context, db *sql.DB, fsys fs.FS) error {
	if err := adoptLegacySchema(ctx, db); err != nil {
		return err
	}
	provider, err := goose.NewProvider(database.DialectSQLite3, db, fsys)
	if err != nil {
		return fmt.Errorf("load migrations: %w", err)
	}
	if _, err := provider.Up(ctx); err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}
	return nil
}

// adoptLegacySchema hands a database migrated by the old migrator over to
// goose. Its schema already matches 00001_init.sql, so it records that version
// as applied and drops the old schema_migrations table.
func adoptLegacySchema(ctx context.Context, db *sql.DB) error {
	var legacyTables int
	if err := db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
	).Scan(&legacyTables); err != nil {
		return fmt.Errorf("inspect schema_migrations: %w", err)
	}
	if legacyTables == 0 {
		return nil
	}

	var version int
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&version); err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	if version != legacySquashedVersion {
		return fmt.Errorf("%w: %d", ErrLegacySchema, version)
	}

	store, err := database.NewStore(database.DialectSQLite3, goose.DefaultTablename)
	if err != nil {
		return fmt.Errorf("create goose store: %w", err)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("adopt legacy schema: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if err := store.CreateVersionTable(ctx, tx); err != nil {
		return fmt.Errorf("adopt legacy schema: %w", err)
	}
	// goose records version 0 when it creates the table, then each applied version.
	for _, applied := range []int64{0, 1} {
		if err := store.Insert(ctx, tx, database.InsertRequest{Version: applied}); err != nil {
			return fmt.Errorf("adopt legacy schema: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, "DROP TABLE schema_migrations"); err != nil {
		return fmt.Errorf("adopt legacy schema: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("adopt legacy schema: %w", err)
	}
	return nil
}
