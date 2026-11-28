package library

import (
	"database/sql"
	"io/fs"
	"math"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ktsu2i/glint/internal/sqlite"
	"github.com/ktsu2i/glint/migrations"
)

func sampleHighlight(page int) NewHighlight {
	return NewHighlight{
		PageNumber: page,
		PageCount:  20,
		Color:      "yellow",
		Text:       "  a highlighted sentence  ",
		Rects:      []HighlightRect{{X: 0.1, Y: 0.2, Width: 0.5, Height: 0.02}},
	}
}

func TestStorePersistsHighlightsInPageOrderAndDeletesThem(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	later, err := store.SaveHighlight(t.Context(), book.ID, sampleHighlight(7), now)
	require.NoError(t, err)
	assert.Equal(t, "a highlighted sentence", later.Text, "surrounding whitespace is trimmed")
	green := sampleHighlight(3)
	green.Color = "green"
	green.Rects = append(green.Rects, HighlightRect{X: 0.1, Y: 0.23, Width: 0.3, Height: 0.02})
	earlier, err := store.SaveHighlight(t.Context(), book.ID, green, now.Add(time.Minute))
	require.NoError(t, err)
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	highlights, err := store.ListHighlights(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, highlights, 2)
	assert.Equal(t, earlier, highlights[0])
	assert.Equal(t, later, highlights[1])

	require.NoError(t, store.DeleteHighlight(t.Context(), book.ID, later.ID))
	require.NoError(t, store.DeleteHighlight(t.Context(), book.ID, later.ID), "deletion is idempotent")
	highlights, err = store.ListHighlights(t.Context(), book.ID)
	require.NoError(t, err)
	require.Len(t, highlights, 1)
	assert.Equal(t, earlier.ID, highlights[0].ID)
}

func TestStoreValidatesHighlights(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	invalid := map[string]func(*NewHighlight){
		"page zero":        func(h *NewHighlight) { h.PageNumber = 0 },
		"page past end":    func(h *NewHighlight) { h.PageNumber = 21 },
		"unknown color":    func(h *NewHighlight) { h.Color = "red" },
		"blank text":       func(h *NewHighlight) { h.Text = "   " },
		"text too long":    func(h *NewHighlight) { h.Text = strings.Repeat("あ", MaxHighlightTextRunes+1) },
		"no rects":         func(h *NewHighlight) { h.Rects = nil },
		"zero width":       func(h *NewHighlight) { h.Rects[0].Width = 0 },
		"outside the page": func(h *NewHighlight) { h.Rects[0].X = 0.9 },
		"not a number":     func(h *NewHighlight) { h.Rects[0].Y = math.NaN() },
		"cfi and rects":    func(h *NewHighlight) { h.CFI = "epubcfi(/6/4!/4/2)" },
		"not a cfi":        func(h *NewHighlight) { h.Rects, h.CFI = nil, "/6/4!/4/2" },
		"cfi too long": func(h *NewHighlight) {
			h.Rects, h.CFI = nil, "epubcfi("+strings.Repeat("/2", MaxHighlightCFIBytes)+")"
		},
	}
	for name, mutate := range invalid {
		t.Run(name, func(t *testing.T) {
			input := sampleHighlight(2)
			mutate(&input)
			_, err := store.SaveHighlight(t.Context(), book.ID, input, now)
			assert.ErrorIs(t, err, ErrInvalidHighlight)
		})
	}

	_, err = store.SaveHighlight(t.Context(), "missing", sampleHighlight(1), now)
	assert.ErrorIs(t, err, ErrBookNotFound)
	_, err = store.ListHighlights(t.Context(), "missing")
	assert.ErrorIs(t, err, ErrBookNotFound)
	assert.ErrorIs(t, store.DeleteHighlight(t.Context(), book.ID, 0), ErrInvalidHighlight)
}

func TestStoreDeletesHighlightsOnlyFromTheirBook(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	first, err := store.Import(t.Context(), "book-1", "/tmp/A.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	second, err := store.Import(t.Context(), "book-2", "/tmp/B.pdf", "hash-2", "pdf", 10, now)
	require.NoError(t, err)
	saved, err := store.SaveHighlight(t.Context(), first.ID, sampleHighlight(1), now)
	require.NoError(t, err)

	require.NoError(t, store.DeleteHighlight(t.Context(), second.ID, saved.ID))
	highlights, err := store.ListHighlights(t.Context(), first.ID)
	require.NoError(t, err)
	assert.Len(t, highlights, 1)

	require.NoError(t, store.Remove(t.Context(), first.ID))
	_, err = store.ListHighlights(t.Context(), first.ID)
	assert.ErrorIs(t, err, ErrBookNotFound)
}

func TestMigrationTurnsBlueHighlightsPurple(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	db, err := sql.Open("sqlite", path)
	require.NoError(t, err)
	before := fstest.MapFS{}
	entries, err := fs.ReadDir(migrations.FS, ".")
	require.NoError(t, err)
	for _, entry := range entries {
		if entry.Name() >= "0012" {
			continue
		}
		body, err := fs.ReadFile(migrations.FS, entry.Name())
		require.NoError(t, err)
		before[entry.Name()] = &fstest.MapFile{Data: body}
	}
	require.NoError(t, (&sqlite.Migrator{DB: db, FS: before}).Up(t.Context()))
	execSQL(t, db, `INSERT INTO books (id, title, file_name, source_path, file_hash, size_bytes, imported_at, updated_at)
        VALUES ('book-1', 'Guide', 'Guide.pdf', '/tmp/Guide.pdf', 'hash-1', 10, 'now', 'now')`)
	execSQL(t, db, `INSERT INTO book_highlights (book_id, page_number, color, text, rects, created_at)
        VALUES ('book-1', 2, 'blue', 'kept', '[{"x":0.1,"y":0.1,"width":0.2,"height":0.02}]', 'now'),
               ('book-1', 3, 'green', 'unchanged', '[{"x":0.1,"y":0.1,"width":0.2,"height":0.02}]', 'now')`)
	require.NoError(t, db.Close())

	store, err := Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	highlights, err := store.ListHighlights(t.Context(), "book-1")
	require.NoError(t, err)
	require.Len(t, highlights, 2)
	assert.Equal(t, []string{"purple", "green"}, []string{highlights[0].Color, highlights[1].Color})
	assert.Equal(t, "kept", highlights[0].Text)

	_, err = store.SaveHighlight(t.Context(), "book-1", NewHighlight{
		PageNumber: 1, PageCount: 3, Color: "blue", Text: "x",
		Rects: []HighlightRect{{X: 0.1, Y: 0.1, Width: 0.1, Height: 0.1}},
	}, time.Now())
	assert.ErrorIs(t, err, ErrInvalidHighlight)
}

func TestStoreChangesHighlightColor(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	now := time.Now()
	first, err := store.Import(t.Context(), "book-1", "/tmp/A.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)
	second, err := store.Import(t.Context(), "book-2", "/tmp/B.pdf", "hash-2", "pdf", 10, now)
	require.NoError(t, err)
	saved, err := store.SaveHighlight(t.Context(), first.ID, sampleHighlight(2), now)
	require.NoError(t, err)

	updated, err := store.UpdateHighlightColor(t.Context(), first.ID, saved.ID, "purple")
	require.NoError(t, err)
	saved.Color = "purple"
	assert.Equal(t, saved, updated)
	highlights, err := store.ListHighlights(t.Context(), first.ID)
	require.NoError(t, err)
	assert.Equal(t, []BookHighlight{saved}, highlights)

	_, err = store.UpdateHighlightColor(t.Context(), first.ID, saved.ID, "blue")
	assert.ErrorIs(t, err, ErrInvalidHighlight)
	_, err = store.UpdateHighlightColor(t.Context(), second.ID, saved.ID, "green")
	assert.ErrorIs(t, err, ErrHighlightNotFound, "a highlight is changed only through its own book")
	_, err = store.UpdateHighlightColor(t.Context(), "missing", saved.ID, "green")
	assert.ErrorIs(t, err, ErrBookNotFound)
}

func TestStorePersistsEPUBHighlightsByCFI(t *testing.T) {
	path := filepath.Join(t.TempDir(), "library.sqlite3")
	now := time.Date(2026, 11, 25, 9, 0, 0, 0, time.UTC)
	store, err := Open(path)
	require.NoError(t, err)
	book, err := store.Import(t.Context(), "book-1", "/tmp/Guide.epub", "hash-1", "epub", 10, now)
	require.NoError(t, err)

	saved, err := store.SaveHighlight(t.Context(), book.ID, NewHighlight{
		PageNumber: 2, PageCount: 4, Color: "purple", Text: "reflowed text",
		CFI: "epubcfi(/6/4!/4/2,/1:0,/1:13)",
	}, now)
	require.NoError(t, err)
	assert.Empty(t, saved.Rects)
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	highlights, err := store.ListHighlights(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, []BookHighlight{saved}, highlights)
}
