package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func testPaths(t *testing.T) paths {
	t.Helper()
	t.Setenv("GLINT_VERIFY_STATE", t.TempDir())
	p, err := resolvePaths()
	require.NoError(t, err)
	return p
}

func TestRoleSelector(t *testing.T) {
	assert.Equal(t, `role=button[name="Add Book"s]`, roleSelector("button", "Add Book"))
	assert.Equal(t, `role=button[name="Say \"hi\""s]`, roleSelector("button", `Say "hi"`))
	assert.Equal(t, `role=button[name=/Continue .+/]`, roleSelector("button", "/Continue .+/"))
	assert.Equal(t, `role=button[name=/continue/i]`, roleSelector("button", "/continue/i"))
}

func TestResolvePathsFindsRepositoryFromSubdirectory(t *testing.T) {
	root := testPaths(t).repo
	t.Chdir(filepath.Join(root, "internal", "app"))
	p, err := resolvePaths()
	require.NoError(t, err)
	assert.Equal(t, root, p.repo)
	assert.Equal(t, filepath.Join(p.state, "home", "Library", "Application Support", "Glint", "library.sqlite3"), p.database)
}

func TestResolvePathsOutsideRepository(t *testing.T) {
	t.Chdir(t.TempDir())
	_, err := resolvePaths()
	assert.ErrorContains(t, err, "inside the Glint repository")
}

func TestInstanceRoundTrip(t *testing.T) {
	p := testPaths(t)
	state, err := readInstance(p)
	require.NoError(t, err)
	assert.Nil(t, state, "no state file means not running")

	want := instance{HostPID: 1, HostPort: 2, AppPort: 3, Executable: "/bin/x", StartedAt: time.Unix(10, 0).UTC()}
	require.NoError(t, writeInstance(p, want))
	got, err := readInstance(p)
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, want, *got)
}

func TestStaleReason(t *testing.T) {
	p := testPaths(t)
	reason, err := staleReason(p)
	require.NoError(t, err)
	assert.Equal(t, "the binary is not built", reason)

	require.NoError(t, os.MkdirAll(filepath.Dir(p.binary), 0o700))
	require.NoError(t, os.WriteFile(p.binary, nil, 0o600))
	future := time.Now().Add(time.Hour)
	require.NoError(t, os.Chtimes(p.binary, future, future))
	reason, err = staleReason(p)
	require.NoError(t, err)
	assert.Empty(t, reason)

	past := time.Unix(0, 0)
	require.NoError(t, os.Chtimes(p.binary, past, past))
	reason, err = staleReason(p)
	require.NoError(t, err)
	assert.Equal(t, "main.go changed after the build", reason)
}

func TestDialogAnswers(t *testing.T) {
	p := testPaths(t)
	assert.ErrorIs(t, dialog(p, []string{"confirm", "accept"}), errNotRunning)

	require.NoError(t, os.MkdirAll(p.dialogs, 0o700))
	book := filepath.Join(t.TempDir(), "book.pdf")
	require.NoError(t, os.WriteFile(book, nil, 0o600))
	require.NoError(t, dialog(p, []string{"open-file", book}))
	require.NoError(t, dialog(p, []string{"confirm", "cancel"}))

	answer, err := os.ReadFile(filepath.Join(p.dialogs, "open-file"))
	require.NoError(t, err)
	assert.Equal(t, book, string(answer))
	answer, err = os.ReadFile(filepath.Join(p.dialogs, "confirm"))
	require.NoError(t, err)
	assert.Equal(t, "cancel", string(answer))

	assert.Error(t, dialog(p, []string{"confirm", "maybe"}))
	assert.Error(t, dialog(p, []string{"open-file", filepath.Join(t.TempDir(), "missing.pdf")}))
}

func TestRunQueryFormatsRows(t *testing.T) {
	database := filepath.Join(t.TempDir(), "library.sqlite3")
	db, err := sql.Open("sqlite", database)
	require.NoError(t, err)
	_, err = db.ExecContext(t.Context(), `
		CREATE TABLE bookmarks (page INTEGER, cfi TEXT, progress REAL, note TEXT);
		INSERT INTO bookmarks VALUES (2, '', 0, NULL), (3, 'epubcfi(/6/4)', 0.5, 'x');`)
	require.NoError(t, err)
	require.NoError(t, db.Close())

	output, err := runQuery(t.Context(), database, "select * from bookmarks order by page")
	require.NoError(t, err)
	assert.Equal(t, "page|cfi|progress|note\n2||0|\n3|epubcfi(/6/4)|0.5|x\n", output)

	_, err = runQuery(t.Context(), database, "delete from bookmarks")
	assert.Error(t, err, "the database is opened read-only")
}
