package books

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/kaito/glint/internal/library"
)

// ErrSourceMissing reports that a library entry's source file is no longer on disk.
var ErrSourceMissing = errors.New("book source file is missing")

// ErrFormatMismatch reports that a file's format does not match its library entry.
var ErrFormatMismatch = errors.New("book file format does not match the library entry")

// Entry is a library book with its on-disk state resolved.
type Entry struct {
	library.Book
	Available bool
}

// OpenedBook is a book ready for the reader, with its index progress.
type OpenedBook struct {
	Book            library.Book
	Spine           []SpineItem
	IndexedSegments int
	NextSegment     int
}

// IndexTarget is a PDF whose page text still has to be extracted by the frontend.
type IndexTarget struct {
	Book        library.Book
	NextSegment int
	Total       int
}

// LibraryHit groups the matching segments of one book.
type LibraryHit struct {
	Entry        Entry
	TotalMatches int
	Segments     []library.SegmentSearchResult
}

// Service holds the book use cases. It does not depend on Wails or the UI.
type Service struct {
	library       *library.Store
	dataDirectory string
}

func New(lib *library.Store, dataDirectory string) *Service {
	return &Service{library: lib, dataDirectory: dataDirectory}
}

// Import adds the file at filePath to the library and opens it.
func (s *Service) Import(ctx context.Context, filePath string) (OpenedBook, error) {
	inspection, pkg, err := inspectBook(filePath)
	if err != nil {
		return OpenedBook{}, err
	}
	id, err := randomToken()
	if err != nil {
		return OpenedBook{}, fmt.Errorf("create book id: %w", err)
	}
	book, err := s.library.Import(
		ctx, id, filePath, inspection.FileHash,
		inspection.Format, inspection.SizeBytes, time.Now(),
	)
	if err != nil {
		return OpenedBook{}, err
	}
	if err := s.afterImport(ctx, book, pkg); err != nil {
		return OpenedBook{}, err
	}
	book, err = s.library.Get(ctx, book.ID)
	if err != nil {
		return OpenedBook{}, err
	}
	if err := s.recordSourceStat(ctx, &book, inspection); err != nil {
		return OpenedBook{}, err
	}
	if err := s.library.MarkOpened(ctx, book.ID, time.Now()); err != nil {
		return OpenedBook{}, err
	}
	return s.opened(ctx, book, pkg)
}

// Open loads a library book, refreshing its record if the source file changed.
func (s *Service) Open(ctx context.Context, id string) (OpenedBook, error) {
	book, err := s.library.Get(ctx, id)
	if err != nil {
		return OpenedBook{}, err
	}
	if !fileExists(book.SourcePath) {
		return OpenedBook{}, ErrSourceMissing
	}
	book, pkg, err := s.refreshSource(ctx, book)
	if err != nil {
		return OpenedBook{}, err
	}
	if book.CoverThumbnailStatus == "ready" && !fileExists(book.CoverThumbnailPath) {
		if err := s.library.ResetCover(ctx, id, time.Now()); err != nil {
			return OpenedBook{}, err
		}
		book.CoverThumbnailPath = ""
		book.CoverThumbnailStatus = "pending"
	}
	if err := s.library.MarkOpened(ctx, id, time.Now()); err != nil {
		return OpenedBook{}, err
	}
	return s.opened(ctx, book, pkg)
}

func (s *Service) refreshSource(ctx context.Context, book library.Book) (library.Book, *epubPackage, error) {
	info, err := os.Stat(book.SourcePath)
	if err != nil {
		return library.Book{}, nil, fmt.Errorf("inspect book file: %w", err)
	}
	if sourceUnchanged(book, info) {
		if book.Format != BookFormatEPUB {
			return book, nil, nil
		}
		pkg, err := loadEPUBPackage(book.SourcePath)
		if err != nil {
			return library.Book{}, nil, err
		}
		return book, pkg, nil
	}
	inspection, pkg, err := inspectBook(book.SourcePath)
	if err != nil {
		return library.Book{}, nil, err
	}
	if inspection.Format != book.Format {
		return library.Book{}, nil, ErrFormatMismatch
	}
	if inspection.FileHash != book.FileHash {
		oldCoverPath := book.CoverThumbnailPath
		book, err = s.library.Relink(ctx, book.ID, book.SourcePath, inspection.FileHash, inspection.SizeBytes, time.Now())
		if err != nil {
			return library.Book{}, nil, err
		}
		if oldCoverPath != "" {
			_ = os.Remove(oldCoverPath)
		}
		if err := s.afterImport(ctx, book, pkg); err != nil {
			return library.Book{}, nil, err
		}
	}
	if err := s.recordSourceStat(ctx, &book, inspection); err != nil {
		return library.Book{}, nil, err
	}
	return book, pkg, nil
}

func sourceUnchanged(book library.Book, info os.FileInfo) bool {
	return book.SourceModTime != "" &&
		info.Size() == book.SizeBytes &&
		library.FormatSourceModTime(info.ModTime()) == book.SourceModTime
}

func (s *Service) recordSourceStat(ctx context.Context, book *library.Book, inspection Inspection) error {
	if err := s.library.RecordSourceStat(ctx, book.ID, inspection.SizeBytes, inspection.ModTime, time.Now()); err != nil {
		return err
	}
	book.SizeBytes = inspection.SizeBytes
	book.SourceModTime = library.FormatSourceModTime(inspection.ModTime)
	return nil
}

// Relink points a library entry at a new source file and opens it.
func (s *Service) Relink(ctx context.Context, id, filePath string) (OpenedBook, error) {
	inspection, pkg, err := inspectBook(filePath)
	if err != nil {
		return OpenedBook{}, err
	}
	oldBook, err := s.library.Get(ctx, id)
	if err != nil {
		return OpenedBook{}, err
	}
	if inspection.Format != oldBook.Format {
		return OpenedBook{}, ErrFormatMismatch
	}
	book, err := s.library.Relink(ctx, id, filePath, inspection.FileHash, inspection.SizeBytes, time.Now())
	if err != nil {
		return OpenedBook{}, err
	}
	if oldBook.FileHash != inspection.FileHash {
		if oldBook.CoverThumbnailPath != "" {
			_ = os.Remove(oldBook.CoverThumbnailPath)
		}
		if err := s.afterImport(ctx, book, pkg); err != nil {
			return OpenedBook{}, err
		}
	}
	if err := s.recordSourceStat(ctx, &book, inspection); err != nil {
		return OpenedBook{}, err
	}
	if err := s.library.MarkOpened(ctx, id, time.Now()); err != nil {
		return OpenedBook{}, err
	}
	return s.opened(ctx, book, pkg)
}

// Get returns a library entry without touching its source file.
func (s *Service) Get(ctx context.Context, id string) (library.Book, error) {
	return s.library.Get(ctx, id)
}

func (s *Service) Rename(ctx context.Context, id, name string) (Entry, error) {
	book, err := s.library.Rename(ctx, id, name, time.Now())
	if err != nil {
		return Entry{}, err
	}
	return s.entry(ctx, book)
}

// Remove deletes the library entry and its cover cache. The source file is kept.
func (s *Service) Remove(ctx context.Context, id string) error {
	book, err := s.library.Get(ctx, id)
	if err != nil {
		return err
	}
	if err := s.library.Remove(ctx, id); err != nil {
		return err
	}
	if book.CoverThumbnailPath != "" {
		_ = os.Remove(book.CoverThumbnailPath)
	}
	return nil
}

func (s *Service) List(ctx context.Context) ([]Entry, error) {
	books, err := s.library.List(ctx)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(books))
	for _, book := range books {
		entry, err := s.entry(ctx, book)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

// entry resolves the on-disk state of a book and resets a cover whose cache file is gone.
func (s *Service) entry(ctx context.Context, book library.Book) (Entry, error) {
	if book.CoverThumbnailStatus == "ready" && !fileExists(book.CoverThumbnailPath) {
		if err := s.library.ResetCover(ctx, book.ID, time.Now()); err != nil {
			return Entry{}, err
		}
		book.CoverThumbnailPath = ""
		book.CoverThumbnailStatus = "pending"
	}
	return Entry{Book: book, Available: fileExists(book.SourcePath)}, nil
}

func (s *Service) SaveReadingPosition(ctx context.Context, bookID string, pageNumber, pageCount int) error {
	return s.library.SaveReadingPosition(ctx, bookID, pageNumber, pageCount, time.Now())
}

func (s *Service) ListBookmarks(ctx context.Context, bookID string) ([]library.BookBookmark, error) {
	return s.library.ListBookmarks(ctx, bookID)
}

// AddBookmark saves a bookmark placed the way the book's format needs: a PDF
// page, or a CFI in an EPUB.
func (s *Service) AddBookmark(ctx context.Context, bookID string, input library.NewBookmark) (library.BookBookmark, error) {
	book, err := s.library.Get(ctx, bookID)
	if err != nil {
		return library.BookBookmark{}, err
	}
	if (book.Format == BookFormatEPUB) != (input.CFI != "") {
		return library.BookBookmark{}, library.ErrInvalidBookmark
	}
	return s.library.SaveBookmark(ctx, bookID, input, time.Now())
}

func (s *Service) RemoveBookmark(ctx context.Context, bookID string, pageNumber int, cfi string) error {
	return s.library.DeleteBookmark(ctx, bookID, pageNumber, cfi)
}

func (s *Service) ListHighlights(ctx context.Context, bookID string) ([]library.BookHighlight, error) {
	return s.library.ListHighlights(ctx, bookID)
}

// AddHighlight saves a highlight placed the way the book's format needs:
// rectangles on a PDF page, or a CFI in an EPUB.
func (s *Service) AddHighlight(ctx context.Context, bookID string, input library.NewHighlight) (library.BookHighlight, error) {
	book, err := s.library.Get(ctx, bookID)
	if err != nil {
		return library.BookHighlight{}, err
	}
	if (book.Format == BookFormatEPUB) != (input.CFI != "") {
		return library.BookHighlight{}, library.ErrInvalidHighlight
	}
	return s.library.SaveHighlight(ctx, bookID, input, time.Now())
}

func (s *Service) ChangeHighlightColor(ctx context.Context, bookID string, id int64, color string) (library.BookHighlight, error) {
	return s.library.UpdateHighlightColor(ctx, bookID, id, color)
}

func (s *Service) RemoveHighlight(ctx context.Context, bookID string, id int64) error {
	return s.library.DeleteHighlight(ctx, bookID, id)
}

// SaveSegments stores extracted text. The segment kind follows the book's format.
func (s *Service) SaveSegments(ctx context.Context, bookID string, segments []library.BookSegment, total int) (int, error) {
	book, err := s.library.Get(ctx, bookID)
	if err != nil {
		return 0, err
	}
	kind := library.SegmentKindPage
	if book.Format == BookFormatEPUB {
		kind = library.SegmentKindSection
	}
	inputs := make([]library.BookSegment, len(segments))
	for i, segment := range segments {
		segment.Kind = kind
		inputs[i] = segment
	}
	return s.library.SaveBookSegments(ctx, bookID, inputs, total, time.Now())
}

// PendingIndexTargets lists available PDFs whose pages are not fully indexed.
func (s *Service) PendingIndexTargets(ctx context.Context) ([]IndexTarget, error) {
	books, err := s.library.List(ctx)
	if err != nil {
		return nil, err
	}
	targets := make([]IndexTarget, 0)
	for _, book := range books {
		if book.Format != BookFormatPDF || book.PageCount < 1 || !fileExists(book.SourcePath) {
			continue
		}
		next, err := s.library.FirstMissingOrdinal(ctx, book.ID)
		if err != nil {
			return nil, err
		}
		if next > book.PageCount {
			continue
		}
		targets = append(targets, IndexTarget{Book: book, NextSegment: next, Total: book.PageCount})
	}
	return targets, nil
}

func (s *Service) SearchBook(ctx context.Context, bookID, query string) ([]library.SegmentSearchResult, error) {
	return s.library.SearchBookSegments(ctx, bookID, query, 50)
}

func (s *Service) SearchLibrary(ctx context.Context, query string) ([]LibraryHit, error) {
	hits, err := s.library.SearchLibrarySegments(ctx, query, 0, 0)
	if err != nil {
		return nil, err
	}
	output := make([]LibraryHit, 0, len(hits))
	for _, hit := range hits {
		book, err := s.library.Get(ctx, hit.BookID)
		if errors.Is(err, library.ErrBookNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		entry, err := s.entry(ctx, book)
		if err != nil {
			return nil, err
		}
		output = append(output, LibraryHit{
			Entry:        entry,
			TotalMatches: hit.TotalMatches,
			Segments:     hit.Segments,
		})
	}
	return output, nil
}

func (s *Service) afterImport(ctx context.Context, book library.Book, pkg *epubPackage) error {
	if book.Format != BookFormatEPUB || pkg == nil {
		return nil
	}
	if err := s.extractEPUBCover(ctx, book, pkg); err != nil {
		_ = s.library.MarkCoverFailed(ctx, book.ID, time.Now())
	}
	return s.indexEPUBSpine(ctx, book, pkg)
}

func (s *Service) opened(ctx context.Context, book library.Book, pkg *epubPackage) (OpenedBook, error) {
	indexed, err := s.library.BookSegmentCount(ctx, book.ID)
	if err != nil {
		return OpenedBook{}, err
	}
	next, err := s.library.FirstMissingOrdinal(ctx, book.ID)
	if err != nil {
		return OpenedBook{}, err
	}
	opened := OpenedBook{Book: book, IndexedSegments: indexed, NextSegment: next}
	if book.Format == BookFormatEPUB && pkg != nil {
		opened.Spine = pkg.Spine
	}
	return opened, nil
}

func randomToken() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
