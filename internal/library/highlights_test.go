package library

import (
	"math"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func sampleHighlight(page int) NewHighlight {
	return NewHighlight{
		Location: PDFHighlightLocation{
			Page:  page,
			Rects: []HighlightRect{{X: 0.1, Y: 0.2, Width: 0.5, Height: 0.02}},
		},
		PageCount: 20,
		Color:     "yellow",
		Text:      "  a highlighted sentence  ",
	}
}

func withPDF(h *NewHighlight, mutate func(*PDFHighlightLocation)) {
	location, _ := h.Location.(PDFHighlightLocation)
	location.Rects = append([]HighlightRect(nil), location.Rects...)
	mutate(&location)
	h.Location = location
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
	withPDF(&green, func(l *PDFHighlightLocation) {
		l.Rects = append(l.Rects, HighlightRect{X: 0.1, Y: 0.23, Width: 0.3, Height: 0.02})
	})
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
		"no location":      func(h *NewHighlight) { h.Location = nil },
		"page zero":        func(h *NewHighlight) { withPDF(h, func(l *PDFHighlightLocation) { l.Page = 0 }) },
		"page past end":    func(h *NewHighlight) { withPDF(h, func(l *PDFHighlightLocation) { l.Page = 21 }) },
		"unknown color":    func(h *NewHighlight) { h.Color = "red" },
		"blank text":       func(h *NewHighlight) { h.Text = "   " },
		"text too long":    func(h *NewHighlight) { h.Text = strings.Repeat("あ", MaxHighlightTextRunes+1) },
		"no rects":         func(h *NewHighlight) { withPDF(h, func(l *PDFHighlightLocation) { l.Rects = nil }) },
		"zero width":       func(h *NewHighlight) { withPDF(h, func(l *PDFHighlightLocation) { l.Rects[0].Width = 0 }) },
		"outside the page": func(h *NewHighlight) { withPDF(h, func(l *PDFHighlightLocation) { l.Rects[0].X = 0.9 }) },
		"not a number":     func(h *NewHighlight) { withPDF(h, func(l *PDFHighlightLocation) { l.Rects[0].Y = math.NaN() }) },
		"not a cfi":        func(h *NewHighlight) { h.Location = EPUBHighlightLocation{Section: 2, CFI: "/6/4!/4/2"} },
		"cfi too long": func(h *NewHighlight) {
			h.Location = EPUBHighlightLocation{Section: 2, CFI: "epubcfi(" + strings.Repeat("/2", MaxHighlightCFIBytes) + ")"}
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

	location := EPUBHighlightLocation{Section: 2, CFI: "epubcfi(/6/4!/4/2,/1:0,/1:13)"}
	saved, err := store.SaveHighlight(t.Context(), book.ID, NewHighlight{
		Location: location, PageCount: 4, Color: "purple", Text: "reflowed text",
	}, now)
	require.NoError(t, err)
	assert.Equal(t, location, saved.Location)
	require.NoError(t, store.Close())

	store, err = Open(path)
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	highlights, err := store.ListHighlights(t.Context(), book.ID)
	require.NoError(t, err)
	assert.Equal(t, []BookHighlight{saved}, highlights)
}
