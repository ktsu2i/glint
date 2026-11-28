//go:build verify

package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestScriptedDialogsAnswerOnce(t *testing.T) {
	dir := t.TempDir()
	dialog := scriptedDialogs{dir: dir}
	require.NoError(t, os.WriteFile(filepath.Join(dir, "open-file"), []byte("/books/a.pdf\n"), 0o600))

	path, err := dialog.chooseBookFile(t.Context(), "Add a book")
	require.NoError(t, err)
	assert.Equal(t, "/books/a.pdf", path)
	last, err := os.ReadFile(filepath.Join(dir, "last-dialog"))
	require.NoError(t, err)
	assert.Equal(t, "open-file\nAdd a book\n", string(last))

	path, err = dialog.chooseBookFile(t.Context(), "Add a book")
	require.NoError(t, err)
	assert.Empty(t, path, "a consumed answer cancels the next dialog")
}

func TestScriptedDialogsConfirm(t *testing.T) {
	dir := t.TempDir()
	dialog := scriptedDialogs{dir: dir}
	require.NoError(t, os.WriteFile(filepath.Join(dir, "confirm"), []byte("accept"), 0o600))

	accepted, err := dialog.confirm(t.Context(), confirmation{title: "Remove"})
	require.NoError(t, err)
	assert.True(t, accepted)

	accepted, err = dialog.confirm(t.Context(), confirmation{title: "Remove"})
	require.NoError(t, err)
	assert.False(t, accepted)
}

func TestScriptedDialogsRequireDirectory(t *testing.T) {
	_, err := scriptedDialogs{}.chooseBookFile(t.Context(), "Add a book")
	assert.ErrorContains(t, err, verifyDialogsEnv)
}

func TestScriptedDialogsRejectCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := scriptedDialogs{dir: t.TempDir()}.chooseBookFile(ctx, "Add a book")
	assert.ErrorIs(t, err, context.Canceled)
}
