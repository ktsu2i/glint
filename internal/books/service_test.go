package books

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaito/glint/internal/library"
)

var pngCover = append([]byte("\x89PNG\r\n\x1a\n"), []byte("cover")...)

type harness struct {
	t       *testing.T
	root    string
	dataDir string
	store   *library.Store
	service *Service
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	store, err := library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	return &harness{t: t, root: root, dataDir: dataDir, store: store, service: New(store, dataDir)}
}

func pdfSegment(pageNumber int, text string) library.BookSegment {
	return library.BookSegment{Ordinal: pageNumber, Location: library.PageLocation(pageNumber), Text: text}
}

func (h *harness) writePDF(name, body string) string {
	path := filepath.Join(h.root, name)
	require.NoError(h.t, os.WriteFile(path, []byte(body), 0o600))
	return path
}

func (h *harness) importBook(path string) OpenedBook {
	h.t.Helper()
	opened, err := h.service.Import(h.t.Context(), path)
	require.NoError(h.t, err)
	return opened
}

func (h *harness) saveSegments(bookID string, total int, segments ...library.BookSegment) {
	h.t.Helper()
	_, err := h.service.SaveSegments(h.t.Context(), bookID, segments, total)
	require.NoError(h.t, err)
}

func TestImportPDFRecordsBook(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("sample.pdf", "%PDF-1.7\nfixture")

	opened := h.importBook(path)
	assert.Equal(t, "sample.pdf", opened.Book.FileName)
	assert.Equal(t, "sample", opened.Book.Display())
	assert.Equal(t, BookFormatPDF, opened.Book.Format)
	assert.Equal(t, path, opened.Book.SourcePath)
}

func TestImportPDFRejectsInvalidHeader(t *testing.T) {
	h := newHarness(t)
	_, err := h.service.Import(t.Context(), h.writePDF("invalid.pdf", "not a pdf"))
	assert.Error(t, err)
}

func TestImportRejectsUnsupportedFormat(t *testing.T) {
	h := newHarness(t)
	_, err := h.service.Import(t.Context(), h.writePDF("notes.txt", "plain text"))
	assert.ErrorIs(t, err, ErrUnsupportedBookFormat)
}

func TestLibraryPersistsBooksCoverAndReadingPosition(t *testing.T) {
	root := t.TempDir()
	dataDir := filepath.Join(root, "data")
	require.NoError(t, os.MkdirAll(dataDir, 0o700))
	path := filepath.Join(root, "Persistent Guide.pdf")
	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nfixture"), 0o600))

	store, err := library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	service := New(store, dataDir)

	opened, err := service.Import(t.Context(), path)
	require.NoError(t, err)
	assert.NotEmpty(t, opened.Book.ID)
	assert.Equal(t, "Persistent Guide", opened.Book.Display())
	require.NoError(t, service.SaveReadingPosition(t.Context(), opened.Book.ID, 3, 8))
	require.NoError(t, service.SaveCover(t.Context(), opened.Book.ID, pngCover))
	require.NoError(t, store.Close())

	store, err = library.Open(filepath.Join(dataDir, "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	service = New(store, dataDir)

	entries, err := service.List(t.Context())
	require.NoError(t, err)
	require.Len(t, entries, 1)
	entry := entries[0]
	assert.Equal(t, 3, entry.LastPage)
	assert.Equal(t, 8, entry.PageCount)
	assert.Equal(t, "ready", entry.CoverThumbnailStatus)
	assert.FileExists(t, entry.CoverThumbnailPath)
	assert.True(t, entry.Available)
	reopened, err := service.Open(t.Context(), entry.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, reopened.Book.LastPage)
}

func TestOpenReportsMissingSource(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Moved.pdf", "%PDF-1.7\nfixture")
	opened := h.importBook(path)
	require.NoError(t, os.Remove(path))

	entries, err := h.service.List(t.Context())
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.False(t, entries[0].Available)
	_, err = h.service.Open(t.Context(), opened.Book.ID)
	assert.ErrorIs(t, err, ErrSourceMissing)
}

func TestRemoveDeletesRecordAndCoverButKeepsSourcePDF(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Removable.pdf", "%PDF-1.7\nfixture")
	opened := h.importBook(path)
	require.NoError(t, h.service.SaveCover(t.Context(), opened.Book.ID, pngCover))
	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", "*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)

	require.NoError(t, h.service.Remove(t.Context(), opened.Book.ID))

	entries, err := h.service.List(t.Context())
	require.NoError(t, err)
	assert.Empty(t, entries)
	assert.NoFileExists(t, covers[0])
	assert.FileExists(t, path, "Remove must not delete the user's source PDF")
	assert.ErrorIs(t, h.service.Remove(t.Context(), opened.Book.ID), library.ErrBookNotFound)
}

func TestRenameUpdatesDisplayedTitleWithoutTouchingFileName(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(h.writePDF("Original Title.pdf", "%PDF-1.7\nfixture"))
	assert.Equal(t, "Original Title", opened.Book.Display())

	entry, err := h.service.Rename(t.Context(), opened.Book.ID, "  My Custom Name  ")
	require.NoError(t, err)
	assert.Equal(t, "My Custom Name", entry.Display())
	assert.Equal(t, "Original Title.pdf", entry.FileName, "file name must keep tracking the PDF on disk")

	reopened, err := h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Equal(t, "My Custom Name", reopened.Book.Display())

	_, err = h.service.Rename(t.Context(), opened.Book.ID, "   ")
	assert.ErrorIs(t, err, library.ErrInvalidDisplayName)
	_, err = h.service.Rename(t.Context(), "missing", "anything")
	assert.Error(t, err)
}

func TestSaveCoverRejectsInvalidContent(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(h.writePDF("Cover.pdf", "%PDF-1.7\nfixture"))
	assert.ErrorIs(t, h.service.SaveCover(t.Context(), opened.Book.ID, []byte("not a png")), ErrInvalidCover)
	assert.ErrorIs(t, h.service.SaveCover(t.Context(), opened.Book.ID, make([]byte, MaxCoverBytes+1)), ErrInvalidCover)
	assert.Error(t, h.service.SaveCover(t.Context(), "missing", pngCover))
}

func TestLibraryResetsCoverWhenCacheOrPDFChanges(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Changing.pdf", "%PDF-1.7\nfirst")
	opened := h.importBook(path)
	require.NoError(t, h.service.SaveCover(t.Context(), opened.Book.ID, pngCover))
	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", "*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)
	require.NoError(t, os.Remove(covers[0]))
	entries, err := h.service.List(t.Context())
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Equal(t, "pending", entries[0].CoverThumbnailStatus)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nsecond version"), 0o600))
	reopened, err := h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Equal(t, "pending", reopened.Book.CoverThumbnailStatus)
	assert.Greater(t, reopened.Book.SizeBytes, opened.Book.SizeBytes)
}

func TestIndexesAndSearchesBookPages(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(h.writePDF("Searchable.pdf", "%PDF-1.7\nfixture"))
	assert.Zero(t, opened.IndexedSegments)

	count, err := h.service.SaveSegments(t.Context(), opened.Book.ID, []library.BookSegment{
		pdfSegment(1, "Evidence from the first page."),
		pdfSegment(2, "A retrieval pipeline returns evidence."),
	}, 2)
	require.NoError(t, err)
	assert.Equal(t, 2, count)

	results, err := h.service.SearchBook(t.Context(), opened.Book.ID, "retrieval evidence")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 2, results[0].Ordinal)
	assert.Equal(t, "page:2", results[0].Location)

	reopened, err := h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, reopened.IndexedSegments)
	_, err = h.service.SearchBook(t.Context(), opened.Book.ID, "   ")
	assert.ErrorIs(t, err, library.ErrInvalidBookSearchQuery)
}

func TestSearchesLibraryAcrossBooks(t *testing.T) {
	h := newHarness(t)
	guide := h.importBook(h.writePDF("Guide.pdf", "%PDF-1.7\nguide"))
	cookbook := h.importBook(h.writePDF("Cookbook.pdf", "%PDF-1.7\ncookbook"))
	notes := h.importBook(h.writePDF("Notes.pdf", "%PDF-1.7\nnotes"))

	h.saveSegments(guide.Book.ID, 2,
		pdfSegment(1, "Context builder filters what gets sent."),
		pdfSegment(2, "Mention of context builder once more."),
	)
	h.saveSegments(cookbook.Book.ID, 1, pdfSegment(1, "Context builder. Context builder. Context builder."))
	h.saveSegments(notes.Book.ID, 1, pdfSegment(1, "Unrelated lexical evidence about retrieval."))

	hits, err := h.service.SearchLibrary(t.Context(), "context builder")
	require.NoError(t, err)
	require.Len(t, hits, 2, "only matching books should be returned")
	assert.Equal(t, cookbook.Book.ID, hits[0].Entry.ID)
	assert.True(t, hits[0].Entry.Available)
	assert.GreaterOrEqual(t, hits[0].TotalMatches, 3)
	assert.NotEmpty(t, hits[0].Segments)
	assert.Equal(t, guide.Book.ID, hits[1].Entry.ID)
	assert.Len(t, hits[1].Segments, 2)

	_, err = h.service.SearchLibrary(t.Context(), "   ")
	assert.ErrorIs(t, err, library.ErrInvalidBookSearchQuery)
	empty, err := h.service.SearchLibrary(t.Context(), "nonexistent_term")
	require.NoError(t, err)
	assert.Empty(t, empty)
}

func TestImportsEPUBAndIndexesSpine(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(newSampleEPUB(t))
	assert.Equal(t, BookFormatEPUB, opened.Book.Format)
	assert.Len(t, opened.Spine, 3)
	assert.Equal(t, 3, opened.IndexedSegments)

	results, err := h.service.SearchBook(t.Context(), opened.Book.ID, "retrieval pipeline")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, 2, results[0].Ordinal)
	assert.Equal(t, "spine:1", results[0].Location)

	entries, err := h.service.List(t.Context())
	require.NoError(t, err)
	require.Len(t, entries, 1)
	assert.Equal(t, BookFormatEPUB, entries[0].Format)
	assert.Equal(t, "ready", entries[0].CoverThumbnailStatus)

	covers, err := filepath.Glob(filepath.Join(h.dataDir, "covers", opened.Book.ID+"-*.png"))
	require.NoError(t, err)
	require.Len(t, covers, 1)
}

func TestImportRejectsDRMProtectedEPUB(t *testing.T) {
	h := newHarness(t)
	path := newSampleEPUB(t, func(files map[string]string) {
		files["META-INF/encryption.xml"] = "<encryption xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"></encryption>"
	})

	_, err := h.service.Import(t.Context(), path)
	assert.ErrorIs(t, err, ErrEPUBDRMProtected)
}

func TestPersistsPageBookmarks(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(h.writePDF("Bookmarks.pdf", "%PDF-1.7\nfixture"))
	id := opened.Book.ID

	saved, err := h.service.AddBookmark(t.Context(), id, 5, 12)
	require.NoError(t, err)
	assert.Equal(t, 5, saved.PageNumber)
	assert.NotEmpty(t, saved.CreatedAt)
	_, err = h.service.AddBookmark(t.Context(), id, 13, 12)
	assert.ErrorIs(t, err, library.ErrInvalidBookmark)

	bookmarks, err := h.service.ListBookmarks(t.Context(), id)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, 5, bookmarks[0].PageNumber)
	require.NoError(t, h.service.RemoveBookmark(t.Context(), id, 5))
	bookmarks, err = h.service.ListBookmarks(t.Context(), id)
	require.NoError(t, err)
	assert.Empty(t, bookmarks)
}

func TestOpenSkipsHashingWhenSizeAndModTimeAreUnchanged(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Stable.pdf", "%PDF-1.7\nfirst")
	opened := h.importBook(path)
	h.saveSegments(opened.Book.ID, 1, pdfSegment(1, "indexed"))
	info, err := os.Stat(path)
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nfirsT"), 0o600))
	require.NoError(t, os.Chtimes(path, info.ModTime(), info.ModTime()))
	reopened, err := h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, reopened.IndexedSegments, "same size and mtime must be trusted without rehashing")

	require.NoError(t, os.Chtimes(path, info.ModTime(), info.ModTime().Add(time.Second)))
	reopened, err = h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Zero(t, reopened.IndexedSegments, "a newer mtime triggers a rehash that detects the new content")
}

func TestOpenRecordsModTimeWhenOnlyModTimeChanges(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Touched.pdf", "%PDF-1.7\nfixture")
	opened := h.importBook(path)
	h.saveSegments(opened.Book.ID, 1, pdfSegment(1, "indexed"))

	touched := time.Now().Add(time.Hour)
	require.NoError(t, os.Chtimes(path, touched, touched))
	reopened, err := h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, reopened.IndexedSegments, "same content keeps the index")

	stored, err := h.store.Get(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Equal(t, library.FormatSourceModTime(touched), stored.SourceModTime)
}

func TestPersistsHighlights(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(h.writePDF("Highlights.pdf", "%PDF-1.7\nfixture"))
	id := opened.Book.ID
	input := library.NewHighlight{
		PageNumber: 4,
		PageCount:  12,
		Color:      "purple",
		Text:       "interfaces belong to the consumer",
		Rects:      []library.HighlightRect{{X: 0.1, Y: 0.4, Width: 0.6, Height: 0.03}},
	}

	saved, err := h.service.AddHighlight(t.Context(), id, input)
	require.NoError(t, err)
	assert.Positive(t, saved.ID)
	assert.NotEmpty(t, saved.CreatedAt)
	input.Color = "red"
	_, err = h.service.AddHighlight(t.Context(), id, input)
	assert.ErrorIs(t, err, library.ErrInvalidHighlight)

	highlights, err := h.service.ListHighlights(t.Context(), id)
	require.NoError(t, err)
	assert.Equal(t, []library.BookHighlight{saved}, highlights)
	changed, err := h.service.ChangeHighlightColor(t.Context(), id, saved.ID, "yellow")
	require.NoError(t, err)
	assert.Equal(t, "yellow", changed.Color)
	require.NoError(t, h.service.RemoveHighlight(t.Context(), id, saved.ID))
	highlights, err = h.service.ListHighlights(t.Context(), id)
	require.NoError(t, err)
	assert.Empty(t, highlights)
}

func TestOpenKeepsBookmarksWhenContentChanges(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Revised.pdf", "%PDF-1.7\nfirst edition")
	opened := h.importBook(path)
	_, err := h.service.AddBookmark(t.Context(), opened.Book.ID, 3, 10)
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(path, []byte("%PDF-1.7\nsecond edition, revised"), 0o600))
	_, err = h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)

	bookmarks, err := h.service.ListBookmarks(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	require.Len(t, bookmarks, 1)
	assert.Equal(t, 3, bookmarks[0].PageNumber)
}

func TestOpenLoadsEPUBSpineWithoutRehashing(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(newSampleEPUB(t))

	reopened, err := h.service.Open(t.Context(), opened.Book.ID)
	require.NoError(t, err)
	assert.Len(t, reopened.Spine, 3)
	assert.Equal(t, 3, reopened.IndexedSegments)
}

func TestRelinkRejectsFormatMismatch(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(h.writePDF("Relink.pdf", "%PDF-1.7\nfixture"))

	_, err := h.service.Relink(t.Context(), opened.Book.ID, newSampleEPUB(t))
	assert.ErrorIs(t, err, ErrFormatMismatch)

	moved := h.writePDF("Moved Relink.pdf", "%PDF-1.7\nfixture")
	relinked, err := h.service.Relink(t.Context(), opened.Book.ID, moved)
	require.NoError(t, err)
	assert.Equal(t, moved, relinked.Book.SourcePath)
}

func TestPendingIndexTargetsListsAvailablePDFsWithMissingPages(t *testing.T) {
	h := newHarness(t)
	partial := h.importBook(h.writePDF("Partial.pdf", "%PDF-1.7\npartial"))
	h.saveSegments(partial.Book.ID, 5, pdfSegment(1, "one"), pdfSegment(2, "two"))

	complete := h.importBook(h.writePDF("Complete.pdf", "%PDF-1.7\ncomplete"))
	h.saveSegments(complete.Book.ID, 1, pdfSegment(1, "one"))

	missingPath := h.writePDF("Missing.pdf", "%PDF-1.7\nmissing")
	missing := h.importBook(missingPath)
	h.saveSegments(missing.Book.ID, 3, pdfSegment(1, "one"))
	require.NoError(t, os.Remove(missingPath))

	h.importBook(h.writePDF("Unopened.pdf", "%PDF-1.7\nunopened"))
	h.importBook(newSampleEPUB(t))

	targets, err := h.service.PendingIndexTargets(t.Context())
	require.NoError(t, err)
	require.Len(t, targets, 1)
	assert.Equal(t, partial.Book.ID, targets[0].Book.ID)
	assert.Equal(t, 3, targets[0].NextSegment)
	assert.Equal(t, 5, targets[0].Total)

	reopened, err := h.service.Open(t.Context(), partial.Book.ID)
	require.NoError(t, err)
	assert.Equal(t, 3, reopened.NextSegment)
}

func TestStoresEPUBSectionHeadings(t *testing.T) {
	h := newHarness(t)
	opened := h.importBook(newSampleEPUB(t))
	assert.Equal(t, 4, opened.NextSegment)

	results, err := h.service.SearchBook(t.Context(), opened.Book.ID, "retrieval pipeline")
	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, "Chapter Two", results[0].HeadingPath)
}
