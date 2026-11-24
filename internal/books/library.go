package books

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/library"
)

type BookFile struct {
	ID               string      `json:"id"`
	Title            string      `json:"title"`
	Name             string      `json:"name"`
	URL              string      `json:"url"`
	Format           string      `json:"format"`
	Size             int64       `json:"size"`
	InitialPage      int         `json:"initialPage"`
	IndexedPageCount int         `json:"indexedPageCount"`
	NextSegment      int         `json:"nextSegment"`
	CoverStatus      string      `json:"coverStatus"`
	SpineItems       []SpineItem `json:"spineItems,omitempty"`
}

type BookSegmentInput struct {
	Ordinal     int    `json:"ordinal"`
	Location    string `json:"location"`
	HeadingPath string `json:"headingPath"`
	Text        string `json:"text"`
}

type IndexTarget struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	NextSegment int    `json:"nextSegment"`
	Total       int    `json:"total"`
}

type BookSearchResult struct {
	PageNumber  int    `json:"pageNumber"`
	Location    string `json:"location"`
	HeadingPath string `json:"headingPath"`
	Excerpt     string `json:"excerpt"`
	MatchCount  int    `json:"matchCount"`
}

type BookBookmark struct {
	PageNumber int    `json:"pageNumber"`
	CreatedAt  string `json:"createdAt"`
}

type BookSummary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	FileName    string `json:"fileName"`
	Format      string `json:"format"`
	Size        int64  `json:"size"`
	PageCount   int    `json:"pageCount"`
	LastPage    int    `json:"lastPage"`
	ImportedAt  string `json:"importedAt"`
	LastOpened  string `json:"lastOpenedAt"`
	CoverURL    string `json:"coverUrl"`
	CoverStatus string `json:"coverStatus"`
	Available   bool   `json:"available"`
}

type LibrarySearchHit struct {
	Book         BookSummary        `json:"book"`
	TotalMatches int                `json:"totalMatches"`
	Pages        []BookSearchResult `json:"pages"`
}

var (
	// ErrBookFileMissing means the source file recorded for a book no longer exists.
	ErrBookFileMissing = errors.New("book source file is missing")
	// ErrBookFormatChanged means the file at the recorded path is no longer the recorded format.
	ErrBookFormatChanged = errors.New("book source format changed")
	// ErrRelinkFormatMismatch means the file chosen for relinking has a different format.
	ErrRelinkFormatMismatch = errors.New("relinked file format does not match the book")
)

// Library holds the book use cases: importing, opening, relinking, indexing, and searching.
// It does not depend on the Wails runtime or the UI language; Service adapts it for the frontend.
type Library struct {
	store         *library.Store
	assets        *assetserver.Server
	dataDirectory string
}

func NewLibrary(store *library.Store, assets *assetserver.Server, dataDirectory string) *Library {
	return &Library{store: store, assets: assets, dataDirectory: dataDirectory}
}

// ImportBook adds the file at filePath to the library and opens it.
func (l *Library) ImportBook(ctx context.Context, filePath string) (BookFile, error) {
	inspection, pkg, err := inspectBook(filePath)
	if err != nil {
		return BookFile{}, err
	}
	id, err := randomToken()
	if err != nil {
		return BookFile{}, fmt.Errorf("create book id: %w", err)
	}
	book, err := l.store.Import(
		ctx, id, filePath, inspection.FileHash,
		inspection.Format, inspection.SizeBytes, time.Now(),
	)
	if err != nil {
		return BookFile{}, err
	}
	if err := l.afterImport(ctx, book, pkg); err != nil {
		return BookFile{}, err
	}
	book, err = l.store.Get(ctx, book.ID)
	if err != nil {
		return BookFile{}, err
	}
	if err := l.recordSourceStat(ctx, &book, inspection); err != nil {
		return BookFile{}, err
	}
	if err := l.store.MarkOpened(ctx, book.ID, time.Now()); err != nil {
		return BookFile{}, err
	}
	return l.bookFile(ctx, book, pkg)
}

func (l *Library) OpenBook(ctx context.Context, id string) (BookFile, error) {
	book, err := l.store.Get(ctx, id)
	if err != nil {
		return BookFile{}, err
	}
	if !fileExists(book.SourcePath) {
		return BookFile{}, ErrBookFileMissing
	}
	book, pkg, err := l.refreshSource(ctx, book)
	if err != nil {
		return BookFile{}, err
	}
	if book.CoverThumbnailStatus == "ready" && !fileExists(book.CoverThumbnailPath) {
		if err := l.store.ResetCover(ctx, id, time.Now()); err != nil {
			return BookFile{}, err
		}
		book.CoverThumbnailPath = ""
		book.CoverThumbnailStatus = "pending"
	}
	if err := l.store.MarkOpened(ctx, id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return l.bookFile(ctx, book, pkg)
}

func (l *Library) refreshSource(ctx context.Context, book library.Book) (library.Book, *epubPackage, error) {
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
		return library.Book{}, nil, ErrBookFormatChanged
	}
	if inspection.FileHash != book.FileHash {
		oldCoverPath := book.CoverThumbnailPath
		book, err = l.store.Relink(ctx, book.ID, book.SourcePath, inspection.FileHash, inspection.SizeBytes, time.Now())
		if err != nil {
			return library.Book{}, nil, err
		}
		if oldCoverPath != "" {
			_ = os.Remove(oldCoverPath)
		}
		if err := l.afterImport(ctx, book, pkg); err != nil {
			return library.Book{}, nil, err
		}
	}
	if err := l.recordSourceStat(ctx, &book, inspection); err != nil {
		return library.Book{}, nil, err
	}
	return book, pkg, nil
}

func sourceUnchanged(book library.Book, info os.FileInfo) bool {
	return book.SourceModTime != "" &&
		info.Size() == book.SizeBytes &&
		library.FormatSourceModTime(info.ModTime()) == book.SourceModTime
}

func (l *Library) recordSourceStat(ctx context.Context, book *library.Book, inspection Inspection) error {
	if err := l.store.RecordSourceStat(ctx, book.ID, inspection.SizeBytes, inspection.ModTime, time.Now()); err != nil {
		return err
	}
	book.SizeBytes = inspection.SizeBytes
	book.SourceModTime = library.FormatSourceModTime(inspection.ModTime)
	return nil
}

// RelinkBook points an existing book at the file at path and opens it.
func (l *Library) RelinkBook(ctx context.Context, id, path string) (BookFile, error) {
	inspection, pkg, err := inspectBook(path)
	if err != nil {
		return BookFile{}, err
	}
	oldBook, err := l.store.Get(ctx, id)
	if err != nil {
		return BookFile{}, err
	}
	if inspection.Format != oldBook.Format {
		return BookFile{}, ErrRelinkFormatMismatch
	}
	book, err := l.store.Relink(ctx, id, path, inspection.FileHash, inspection.SizeBytes, time.Now())
	if err != nil {
		return BookFile{}, err
	}
	if oldBook.FileHash != inspection.FileHash && oldBook.CoverThumbnailPath != "" {
		_ = os.Remove(oldBook.CoverThumbnailPath)
	}
	if oldBook.FileHash != inspection.FileHash {
		if err := l.afterImport(ctx, book, pkg); err != nil {
			return BookFile{}, err
		}
	}
	if err := l.recordSourceStat(ctx, &book, inspection); err != nil {
		return BookFile{}, err
	}
	if err := l.store.MarkOpened(ctx, id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return l.bookFile(ctx, book, pkg)
}

// DisplayName returns the title shown for a book, such as in the removal confirmation.
func (l *Library) DisplayName(ctx context.Context, id string) (string, error) {
	book, err := l.store.Get(ctx, id)
	if err != nil {
		return "", err
	}
	return book.Display(), nil
}

func (l *Library) RenameBook(ctx context.Context, id, name string) (BookSummary, error) {
	book, err := l.store.Rename(ctx, id, name, time.Now())
	if err != nil {
		return BookSummary{}, err
	}
	return l.bookSummary(ctx, book)
}

// RemoveBook deletes the library record and the cached cover. The source file is kept.
func (l *Library) RemoveBook(ctx context.Context, id string) error {
	book, err := l.store.Get(ctx, id)
	if err != nil {
		return err
	}
	if err := l.store.Remove(ctx, id); err != nil {
		return err
	}
	if book.CoverThumbnailPath != "" {
		_ = os.Remove(book.CoverThumbnailPath)
	}
	return nil
}

func (l *Library) ListBooks(ctx context.Context) ([]BookSummary, error) {
	books, err := l.store.List(ctx)
	if err != nil {
		return nil, err
	}
	summaries := make([]BookSummary, 0, len(books))
	for _, book := range books {
		summary, err := l.bookSummary(ctx, book)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func (l *Library) bookSummary(ctx context.Context, book library.Book) (BookSummary, error) {
	summary := BookSummary{
		ID:          book.ID,
		Title:       book.Display(),
		FileName:    book.FileName,
		Format:      book.Format,
		Size:        book.SizeBytes,
		PageCount:   book.PageCount,
		LastPage:    book.LastPage,
		ImportedAt:  book.ImportedAt,
		LastOpened:  book.LastOpenedAt,
		CoverStatus: book.CoverThumbnailStatus,
		Available:   fileExists(book.SourcePath),
	}
	if book.CoverThumbnailStatus == "ready" && fileExists(book.CoverThumbnailPath) {
		url, err := l.assets.Register(book.CoverThumbnailPath, coverContentType(book.CoverThumbnailPath))
		if err != nil {
			return BookSummary{}, err
		}
		summary.CoverURL = url
	} else if book.CoverThumbnailStatus == "ready" {
		summary.CoverStatus = "pending"
		if err := l.store.ResetCover(ctx, book.ID, time.Now()); err != nil {
			return BookSummary{}, err
		}
	}
	return summary, nil
}

func (l *Library) SaveReadingPosition(ctx context.Context, bookID string, pageNumber, pageCount int) error {
	return l.store.SaveReadingPosition(ctx, bookID, pageNumber, pageCount, time.Now())
}

func (l *Library) ListBookmarks(ctx context.Context, bookID string) ([]BookBookmark, error) {
	bookmarks, err := l.store.ListBookmarks(ctx, bookID)
	if err != nil {
		return nil, err
	}
	output := make([]BookBookmark, len(bookmarks))
	for i, bookmark := range bookmarks {
		output[i] = BookBookmark{PageNumber: bookmark.PageNumber, CreatedAt: bookmark.CreatedAt}
	}
	return output, nil
}

func (l *Library) AddBookmark(ctx context.Context, bookID string, pageNumber, pageCount int) (BookBookmark, error) {
	bookmark, err := l.store.SaveBookmark(ctx, bookID, pageNumber, pageCount, time.Now())
	if err != nil {
		return BookBookmark{}, err
	}
	return BookBookmark{PageNumber: bookmark.PageNumber, CreatedAt: bookmark.CreatedAt}, nil
}

func (l *Library) RemoveBookmark(ctx context.Context, bookID string, pageNumber int) error {
	return l.store.DeleteBookmark(ctx, bookID, pageNumber)
}

func (l *Library) SaveBookSegments(ctx context.Context, bookID string, segments []BookSegmentInput, total int) (int, error) {
	book, err := l.store.Get(ctx, bookID)
	if err != nil {
		return 0, err
	}
	kind := library.SegmentKindPage
	if book.Format == BookFormatEPUB {
		kind = library.SegmentKindSection
	}
	inputs := make([]library.BookSegment, len(segments))
	for i, segment := range segments {
		inputs[i] = library.BookSegment{
			Ordinal:     segment.Ordinal,
			Kind:        kind,
			Location:    segment.Location,
			HeadingPath: segment.HeadingPath,
			Text:        segment.Text,
		}
	}
	return l.store.SaveBookSegments(ctx, bookID, inputs, total, time.Now())
}

// PendingIndexBooks lists PDFs whose text index is incomplete, so the frontend can resume indexing.
func (l *Library) PendingIndexBooks(ctx context.Context) ([]IndexTarget, error) {
	books, err := l.store.List(ctx)
	if err != nil {
		return nil, err
	}
	targets := make([]IndexTarget, 0)
	for _, book := range books {
		if book.Format != BookFormatPDF || book.PageCount < 1 || !fileExists(book.SourcePath) {
			continue
		}
		next, err := l.store.FirstMissingOrdinal(ctx, book.ID)
		if err != nil {
			return nil, err
		}
		if next > book.PageCount {
			continue
		}
		url, err := l.assets.Register(book.SourcePath, bookContentType(book.Format))
		if err != nil {
			return nil, err
		}
		targets = append(targets, IndexTarget{ID: book.ID, URL: url, NextSegment: next, Total: book.PageCount})
	}
	return targets, nil
}

func (l *Library) SearchBook(ctx context.Context, bookID, query string) ([]BookSearchResult, error) {
	results, err := l.store.SearchBookSegments(ctx, bookID, query, 50)
	if err != nil {
		return nil, err
	}
	output := make([]BookSearchResult, len(results))
	for i, result := range results {
		output[i] = bookSearchResult(result)
	}
	return output, nil
}

func (l *Library) SearchLibrary(ctx context.Context, query string) ([]LibrarySearchHit, error) {
	hits, err := l.store.SearchLibrarySegments(ctx, query, 0, 0)
	if err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return []LibrarySearchHit{}, nil
	}
	output := make([]LibrarySearchHit, 0, len(hits))
	for _, hit := range hits {
		book, err := l.store.Get(ctx, hit.BookID)
		if errors.Is(err, library.ErrBookNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		summary, err := l.bookSummary(ctx, book)
		if err != nil {
			return nil, err
		}
		pages := make([]BookSearchResult, len(hit.Segments))
		for i, segment := range hit.Segments {
			pages[i] = bookSearchResult(segment)
		}
		output = append(output, LibrarySearchHit{
			Book:         summary,
			TotalMatches: hit.TotalMatches,
			Pages:        pages,
		})
	}
	return output, nil
}

func bookSearchResult(result library.SegmentSearchResult) BookSearchResult {
	return BookSearchResult{
		PageNumber:  result.Ordinal,
		Location:    result.Location,
		HeadingPath: result.HeadingPath,
		Excerpt:     result.Excerpt,
		MatchCount:  result.MatchCount,
	}
}

func (l *Library) afterImport(ctx context.Context, book library.Book, pkg *epubPackage) error {
	if book.Format != BookFormatEPUB || pkg == nil {
		return nil
	}
	if err := l.extractEPUBCover(ctx, book, pkg); err != nil {
		_ = l.store.MarkCoverFailed(ctx, book.ID, time.Now())
	}
	return l.indexEPUBSpine(ctx, book, pkg)
}

func (l *Library) bookFile(ctx context.Context, book library.Book, pkg *epubPackage) (BookFile, error) {
	url, err := l.assets.Register(book.SourcePath, bookContentType(book.Format))
	if err != nil {
		return BookFile{}, err
	}
	indexedPageCount, err := l.store.BookSegmentCount(ctx, book.ID)
	if err != nil {
		return BookFile{}, err
	}
	nextSegment, err := l.store.FirstMissingOrdinal(ctx, book.ID)
	if err != nil {
		return BookFile{}, err
	}
	coverStatus := book.CoverThumbnailStatus
	if coverStatus == "failed" {
		coverStatus = "pending"
	}
	file := BookFile{
		ID:               book.ID,
		Title:            book.Display(),
		Name:             book.FileName,
		URL:              url,
		Format:           book.Format,
		Size:             book.SizeBytes,
		InitialPage:      max(1, book.LastPage),
		IndexedPageCount: indexedPageCount,
		NextSegment:      nextSegment,
		CoverStatus:      coverStatus,
	}
	if book.Format == BookFormatEPUB && pkg != nil {
		file.SpineItems = pkg.Spine
	}
	return file, nil
}

func bookContentType(format string) string {
	if format == BookFormatEPUB {
		return "application/epub+zip"
	}
	return "application/pdf"
}

func coverContentType(path string) string {
	switch strings.ToLower(extension(path)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".webp":
		return "image/webp"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	}
	return "image/png"
}

func randomToken() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
