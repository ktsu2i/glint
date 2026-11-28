package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	_ "github.com/glebarez/go-sqlite"
)

func dialog(p paths, args []string) error {
	if len(args) == 1 && args[0] == "last" {
		data, err := os.ReadFile(filepath.Join(p.dialogs, "last-dialog"))
		if errors.Is(err, fs.ErrNotExist) {
			fmt.Println("no dialog shown yet")
			return nil
		}
		if err != nil {
			return fmt.Errorf("read the last dialog: %w", err)
		}
		fmt.Print(string(data))
		return nil
	}
	if len(args) != 2 {
		return errors.New("usage: dialog open-file <path> | dialog confirm <accept|cancel> | dialog last")
	}
	if _, err := os.Stat(p.dialogs); err != nil {
		return errNotRunning
	}
	kind, value := args[0], args[1]
	switch kind {
	case "open-file":
		path, err := filepath.Abs(value)
		if err != nil {
			return fmt.Errorf("resolve %s: %w", value, err)
		}
		if _, err := os.Stat(path); err != nil {
			return fmt.Errorf("%s does not exist", path)
		}
		if err := writeAnswer(p, kind, path); err != nil {
			return err
		}
		fmt.Printf("the next file dialog returns %s\n", path)
	case "confirm":
		if value != "accept" && value != "cancel" {
			return errors.New("usage: dialog confirm <accept|cancel>")
		}
		if err := writeAnswer(p, kind, value); err != nil {
			return err
		}
		fmt.Printf("the next confirmation is answered with %s\n", value)
	default:
		return fmt.Errorf("unknown dialog %q", kind)
	}
	return nil
}

func writeAnswer(p paths, kind, value string) error {
	if err := os.WriteFile(filepath.Join(p.dialogs, kind), []byte(value), 0o600); err != nil {
		return fmt.Errorf("write the dialog answer: %w", err)
	}
	return nil
}

func query(ctx context.Context, p paths, args []string) error {
	statement := strings.Join(args, " ")
	if statement == "" {
		return errors.New("usage: sql <query>")
	}
	if _, err := os.Stat(p.database); err != nil {
		return errNotRunning
	}
	output, err := runQuery(ctx, p.database, statement)
	if err != nil {
		return err
	}
	fmt.Print(output)
	return nil
}

// runQuery prints rows like the sqlite3 shell with -header: a header line,
// then one line per row, columns separated by "|", NULL as empty.
func runQuery(ctx context.Context, database, statement string) (string, error) {
	db, err := sql.Open("sqlite", "file:"+database+"?mode=ro&_pragma=query_only(1)")
	if err != nil {
		return "", fmt.Errorf("open the database: %w", err)
	}
	defer func() { _ = db.Close() }()
	rows, err := db.QueryContext(ctx, statement)
	if err != nil {
		return "", fmt.Errorf("query: %w", err)
	}
	defer func() { _ = rows.Close() }()
	columns, err := rows.Columns()
	if err != nil {
		return "", fmt.Errorf("read columns: %w", err)
	}
	var out strings.Builder
	out.WriteString(strings.Join(columns, "|"))
	out.WriteByte('\n')
	values := make([]any, len(columns))
	pointers := make([]any, len(columns))
	for i := range values {
		pointers[i] = &values[i]
	}
	for rows.Next() {
		if err := rows.Scan(pointers...); err != nil {
			return "", fmt.Errorf("read a row: %w", err)
		}
		cells := make([]string, len(values))
		for i, value := range values {
			cells[i] = formatValue(value)
		}
		out.WriteString(strings.Join(cells, "|"))
		out.WriteByte('\n')
	}
	if err := rows.Err(); err != nil {
		return "", fmt.Errorf("read rows: %w", err)
	}
	return out.String(), nil
}

func formatValue(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case []byte:
		return string(v)
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	default:
		return fmt.Sprint(v)
	}
}

func printLogs(p paths) error {
	data, err := os.ReadFile(p.appLog)
	if err != nil {
		return errNotRunning
	}
	lines := strings.Split(strings.TrimRight(string(data), "\n"), "\n")
	fmt.Println(strings.Join(lines[max(0, len(lines)-40):], "\n"))
	return nil
}
