package sqlite

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Migrator struct {
	DB *sql.DB
	FS fs.FS
}

func (m *Migrator) Up(ctx context.Context) error {
	if _, err := m.DB.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	if err := m.upgradeLegacyMigrationTable(ctx); err != nil {
		return err
	}

	applied, err := m.appliedVersions(ctx)
	if err != nil {
		return err
	}

	entries, err := fs.ReadDir(m.FS, ".")
	if err != nil {
		return fmt.Errorf("list migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".sql") {
			continue
		}
		version, err := parseVersion(name)
		if err != nil {
			return fmt.Errorf("parse migration %q: %w", name, err)
		}
		if _, ok := applied[version]; ok {
			continue
		}
		body, err := fs.ReadFile(m.FS, name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if err := m.applyOne(ctx, version, name, string(body)); err != nil {
			return err
		}
	}
	return nil
}

func (m *Migrator) upgradeLegacyMigrationTable(ctx context.Context) error {
	columns, err := m.migrationTableColumns(ctx)
	if err != nil {
		return err
	}
	if columns["name"] && columns["applied_at"] {
		return nil
	}

	tx, err := m.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("upgrade schema_migrations: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	statements := []string{
		"ALTER TABLE schema_migrations RENAME TO schema_migrations_legacy",
		`CREATE TABLE schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )`,
		"INSERT INTO schema_migrations (version, name, applied_at) SELECT version, 'legacy', ? FROM schema_migrations_legacy",
		"DROP TABLE schema_migrations_legacy",
	}
	for _, statement := range statements {
		var execErr error
		if strings.Contains(statement, "SELECT version") {
			_, execErr = tx.ExecContext(ctx, statement, time.Now().UTC().Format(time.RFC3339))
		} else {
			_, execErr = tx.ExecContext(ctx, statement)
		}
		if execErr != nil {
			return fmt.Errorf("upgrade schema_migrations: %w", execErr)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("upgrade schema_migrations: %w", err)
	}
	return nil
}

func (m *Migrator) applyOne(ctx context.Context, version int, name, body string) error {
	tx, err := m.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration %s: %w", name, err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, body); err != nil {
		return fmt.Errorf("apply migration %s: %w", name, err)
	}
	if _, err := tx.ExecContext(ctx,
		"INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
		version, name, time.Now().UTC().Format(time.RFC3339),
	); err != nil {
		return fmt.Errorf("record migration %s: %w", name, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %s: %w", name, err)
	}
	return nil
}

func parseVersion(name string) (int, error) {
	idx := strings.Index(name, "_")
	if idx <= 0 {
		return 0, fmt.Errorf("expected NNNN_name.sql, got %q", name)
	}
	return strconv.Atoi(name[:idx])
}

func (m *Migrator) appliedVersions(ctx context.Context) (map[int]struct{}, error) {
	rows, err := m.DB.QueryContext(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	defer func() { _ = rows.Close() }()

	applied := map[int]struct{}{}
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[version] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read schema_migrations: %w", err)
	}
	return applied, nil
}

func (m *Migrator) migrationTableColumns(ctx context.Context) (map[string]bool, error) {
	rows, err := m.DB.QueryContext(ctx, "PRAGMA table_info(schema_migrations)")
	if err != nil {
		return nil, fmt.Errorf("inspect schema_migrations: %w", err)
	}
	defer func() { _ = rows.Close() }()

	columns := map[string]bool{}
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return nil, fmt.Errorf("inspect schema_migrations column: %w", err)
		}
		columns[name] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspect schema_migrations: %w", err)
	}
	return columns, nil
}
