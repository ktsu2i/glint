// Package sqlite applies embedded SQL migration files to a SQLite database.
// Migrations are picked up from an fs.FS in lexical order, each filename must
// start with a numeric version prefix (e.g. "0001_init.sql"), and each is run
// inside its own transaction. Applied versions are recorded in the
// schema_migrations table so subsequent runs skip them.
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

	applied := map[int]struct{}{}
	rows, err := m.DB.QueryContext(ctx, "SELECT version FROM schema_migrations")
	if err != nil {
		return fmt.Errorf("read schema_migrations: %w", err)
	}
	for rows.Next() {
		var version int
		if err := rows.Scan(&version); err != nil {
			_ = rows.Close()
			return fmt.Errorf("scan schema_migrations: %w", err)
		}
		applied[version] = struct{}{}
	}
	if err := rows.Close(); err != nil {
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
