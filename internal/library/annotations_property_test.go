package library

import (
	"fmt"
	"math"
	"strconv"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"pgregory.net/rapid"
)

func TestPropertyEPUBBookmarksListInReadingOrder(t *testing.T) {
	store := openPropertyStore(t)
	now := time.Now()
	books := 0

	rapid.Check(t, func(t *rapid.T) {
		const sections = 5
		count := rapid.IntRange(1, 12).Draw(t, "count")
		books++
		bookID := "book-" + strconv.Itoa(books)
		_, err := store.Import(t.Context(), bookID, "/tmp/"+bookID+".epub", bookID, "epub", sections, now)
		require.NoError(t, err)

		saved := make(map[EPUBBookmarkLocation]bool, count)
		for i := range count {
			location := EPUBBookmarkLocation{
				Section:  rapid.IntRange(1, sections).Draw(t, "section"),
				CFI:      fmt.Sprintf("epubcfi(/6/2!/4/%d)", 2*(i+1)),
				Progress: rapid.Float64Range(0, 1).Draw(t, "progress"),
			}
			_, err := store.SaveBookmark(t.Context(), bookID, NewBookmark{Location: location, PageCount: sections}, now)
			require.NoError(t, err)
			saved[location] = true
		}

		bookmarks, err := store.ListBookmarks(t.Context(), bookID)
		require.NoError(t, err)
		require.Len(t, bookmarks, count)
		var previous EPUBBookmarkLocation
		for i, bookmark := range bookmarks {
			location, ok := bookmark.Location.(EPUBBookmarkLocation)
			require.True(t, ok)
			require.True(t, saved[location], "listed bookmark %+v was not saved as is", location)
			if i > 0 {
				require.True(t, previous.Section < location.Section ||
					(previous.Section == location.Section && previous.Progress <= location.Progress),
					"%+v listed before %+v", previous, location)
			}
			previous = location
		}
	})
}

func TestPropertyEPUBBookmarkProgressMustBeAFraction(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		progress := rapid.OneOf(
			rapid.Float64(),
			rapid.SampledFrom([]float64{math.NaN(), math.Inf(1), math.Inf(-1), math.Copysign(0, -1), math.Nextafter(1, 2), math.Nextafter(0, -1)}),
		).Draw(t, "progress")
		_, ok := keyOfBookmark(EPUBBookmarkLocation{Section: 1, CFI: "epubcfi(/6/2!/4/2)", Progress: progress})
		require.Equal(t, progress >= 0 && progress <= 1, ok)
	})
}

func highlightRectGen() *rapid.Generator[HighlightRect] {
	return rapid.Custom(func(t *rapid.T) HighlightRect {
		x := rapid.Float64Range(0, 0.99).Draw(t, "x")
		y := rapid.Float64Range(0, 0.99).Draw(t, "y")
		return HighlightRect{
			X:      x,
			Y:      y,
			Width:  rapid.Float64Range(math.SmallestNonzeroFloat64, 1-x).Draw(t, "width"),
			Height: rapid.Float64Range(math.SmallestNonzeroFloat64, 1-y).Draw(t, "height"),
		}
	})
}

func TestPropertyPDFHighlightRectsRoundTrip(t *testing.T) {
	store := openPropertyStore(t)
	now := time.Now()
	_, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 10, now)
	require.NoError(t, err)

	rapid.Check(t, func(t *rapid.T) {
		rects := rapid.SliceOfN(highlightRectGen(), 1, 8).Draw(t, "rects")
		saved, err := store.SaveHighlight(t.Context(), "book-1", NewHighlight{
			Location:  PDFHighlightLocation{Page: 1, Rects: rects},
			PageCount: 10,
			Color:     HighlightColors[0],
			Text:      "text",
		}, now)
		require.NoError(t, err)
		require.Equal(t, PDFHighlightLocation{Page: 1, Rects: rects}, saved.Location)
		require.NoError(t, store.DeleteHighlight(t.Context(), "book-1", saved.ID))
	})
}

func TestPropertyHighlightRectValidity(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		value := rapid.OneOf(
			rapid.Float64Range(-0.5, 1.5),
			rapid.SampledFrom([]float64{math.NaN(), math.Inf(1), math.Inf(-1), 0, 1}),
		)
		rect := HighlightRect{
			X:      value.Draw(t, "x"),
			Y:      value.Draw(t, "y"),
			Width:  value.Draw(t, "width"),
			Height: value.Draw(t, "height"),
		}
		if !rect.valid() {
			return
		}
		// A valid rect has a positive size and stays on the page, within the tolerance.
		for _, edge := range []float64{rect.X, rect.Y, rect.X + rect.Width, rect.Y + rect.Height} {
			require.False(t, math.IsNaN(edge) || math.IsInf(edge, 0))
			require.GreaterOrEqual(t, edge, -rectTolerance)
			require.LessOrEqual(t, edge, 1+rectTolerance)
		}
		require.Positive(t, rect.Width)
		require.Positive(t, rect.Height)
	})
}
