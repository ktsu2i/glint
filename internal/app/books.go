package app

import (
	"encoding/base64"
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/books"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
)

// BooksService is bound to the frontend for the library and the reader.
type BooksService struct {
	base
	books   *books.Service
	assets  *assetserver.Server
	dialogs dialogs
	text    localizer
}

func NewBooksService(bookService *books.Service, assets *assetserver.Server, settingsManager *settings.Manager, desktop *application.App) *BooksService {
	return &BooksService{
		books:   bookService,
		assets:  assets,
		dialogs: wailsDialogs{app: desktop},
		text:    localizer{settings: settingsManager},
	}
}

func (s *BooksService) OpenBookFile() (BookFile, error) {
	if !s.ready() {
		return BookFile{}, errNotReady
	}
	path, err := s.dialogs.chooseBookFile(s.ctx, s.text.text(s.ctx,
		"Add a technical book to the library",
		"技術書を本棚へ追加",
	))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	opened, err := s.books.Import(s.ctx, path)
	if err != nil {
		return BookFile{}, s.bookError(err)
	}
	return s.bookFile(opened)
}

func (s *BooksService) OpenBook(id string) (BookFile, error) {
	opened, err := s.books.Open(s.context(), id)
	if errors.Is(err, books.ErrFormatMismatch) {
		return BookFile{}, s.text.error(s.context(),
			"The selected file format no longer matches this library entry.",
			"選択されたファイルの形式が本棚の記録と一致しません。",
		)
	}
	if err != nil {
		return BookFile{}, s.bookError(err)
	}
	return s.bookFile(opened)
}

func (s *BooksService) RelinkBook(id string) (BookFile, error) {
	if !s.ready() {
		return BookFile{}, errNotReady
	}
	path, err := s.dialogs.chooseBookFile(s.ctx, s.text.text(s.ctx,
		"Choose the book file again",
		"ファイルを再選択",
	))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	opened, err := s.books.Relink(s.ctx, id, path)
	if errors.Is(err, books.ErrFormatMismatch) {
		return BookFile{}, s.text.error(s.ctx,
			"The chosen file format does not match this library entry.",
			"選択したファイルの形式が本棚の記録と一致しません。",
		)
	}
	if err != nil {
		return BookFile{}, s.bookError(err)
	}
	return s.bookFile(opened)
}

func (s *BooksService) RenameBook(id, name string) (BookSummary, error) {
	entry, err := s.books.Rename(s.context(), id, name)
	if err != nil {
		return BookSummary{}, s.bookError(err)
	}
	return s.bookSummary(entry)
}

// RemoveBook asks for confirmation and reports whether the book was removed.
func (s *BooksService) RemoveBook(id string) (bool, error) {
	if !s.ready() {
		return false, errNotReady
	}
	book, err := s.books.Get(s.ctx, id)
	if err != nil {
		return false, err
	}
	confirmed, err := s.dialogs.confirm(s.ctx, confirmation{
		title: s.text.text(s.ctx, "Remove from library", "本棚から削除"),
		message: s.text.text(s.ctx,
			fmt.Sprintf("Remove “%s” from the library?\nThe source file itself will remain.", book.Display()),
			fmt.Sprintf("「%s」を本棚から削除しますか？\n元のファイル自体は残ります。", book.Display()),
		),
		accept: s.text.text(s.ctx, "Remove", "削除"),
		cancel: s.text.text(s.ctx, "Cancel", "キャンセル"),
	})
	if err != nil {
		return false, fmt.Errorf("confirm book removal: %w", err)
	}
	if !confirmed {
		return false, nil
	}
	if err := s.books.Remove(s.ctx, id); err != nil {
		return false, err
	}
	return true, nil
}

func (s *BooksService) ListBooks() ([]BookSummary, error) {
	entries, err := s.books.List(s.context())
	if err != nil {
		return nil, err
	}
	summaries := make([]BookSummary, 0, len(entries))
	for _, entry := range entries {
		summary, err := s.bookSummary(entry)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func (s *BooksService) SaveReadingPosition(bookID string, pageNumber, pageCount int) error {
	return s.books.SaveReadingPosition(s.context(), bookID, pageNumber, pageCount)
}

func (s *BooksService) ListBookmarks(bookID string) ([]BookBookmark, error) {
	bookmarks, err := s.books.ListBookmarks(s.context(), bookID)
	if err != nil {
		return nil, err
	}
	output := make([]BookBookmark, len(bookmarks))
	for i, bookmark := range bookmarks {
		output[i] = toBookBookmark(bookmark)
	}
	return output, nil
}

func (s *BooksService) AddBookmark(bookID string, pageNumber, pageCount int) (BookBookmark, error) {
	bookmark, err := s.books.AddBookmark(s.context(), bookID, pageNumber, pageCount)
	if errors.Is(err, library.ErrInvalidBookmark) {
		return BookBookmark{}, s.text.error(s.context(),
			"The bookmark page is outside this document.",
			"しおりのページがこのPDFの範囲外です。",
		)
	}
	if err != nil {
		return BookBookmark{}, err
	}
	return toBookBookmark(bookmark), nil
}

func (s *BooksService) RemoveBookmark(bookID string, pageNumber int) error {
	if err := s.books.RemoveBookmark(s.context(), bookID, pageNumber); err != nil {
		return s.bookError(err)
	}
	return nil
}

func (s *BooksService) ListHighlights(bookID string) ([]BookHighlight, error) {
	highlights, err := s.books.ListHighlights(s.context(), bookID)
	if err != nil {
		return nil, s.bookError(err)
	}
	output := make([]BookHighlight, len(highlights))
	for i, highlight := range highlights {
		output[i] = toBookHighlight(highlight)
	}
	return output, nil
}

func (s *BooksService) AddHighlight(bookID string, input HighlightInput) (BookHighlight, error) {
	highlight, err := s.books.AddHighlight(s.context(), bookID, input.toNewHighlight())
	if err != nil {
		return BookHighlight{}, s.bookError(err)
	}
	return toBookHighlight(highlight), nil
}

func (s *BooksService) RemoveHighlight(bookID string, id int64) error {
	if err := s.books.RemoveHighlight(s.context(), bookID, id); err != nil {
		return s.bookError(err)
	}
	return nil
}

func (s *BooksService) SaveBookSegments(bookID string, segments []BookSegmentInput, total int) (int, error) {
	inputs := make([]library.BookSegment, len(segments))
	for i, segment := range segments {
		inputs[i] = library.BookSegment{
			Ordinal:     segment.Ordinal,
			Location:    segment.Location,
			HeadingPath: segment.HeadingPath,
			Text:        segment.Text,
		}
	}
	count, err := s.books.SaveSegments(s.context(), bookID, inputs, total)
	if err != nil {
		return 0, s.bookError(err)
	}
	return count, nil
}

func (s *BooksService) PendingIndexBooks() ([]IndexTarget, error) {
	targets, err := s.books.PendingIndexTargets(s.context())
	if err != nil {
		return nil, err
	}
	output := make([]IndexTarget, 0, len(targets))
	for _, target := range targets {
		url, err := s.registerBook(target.Book)
		if err != nil {
			return nil, err
		}
		output = append(output, IndexTarget{
			ID:          target.Book.ID,
			URL:         url,
			NextSegment: target.NextSegment,
			Total:       target.Total,
		})
	}
	return output, nil
}

func (s *BooksService) SearchBook(bookID, query string) ([]BookSearchResult, error) {
	results, err := s.books.SearchBook(s.context(), bookID, query)
	if err != nil {
		return nil, s.bookError(err)
	}
	return toBookSearchResults(results), nil
}

func (s *BooksService) SearchLibrary(query string) ([]LibrarySearchHit, error) {
	hits, err := s.books.SearchLibrary(s.context(), query)
	if err != nil {
		return nil, s.bookError(err)
	}
	output := make([]LibrarySearchHit, 0, len(hits))
	for _, hit := range hits {
		summary, err := s.bookSummary(hit.Entry)
		if err != nil {
			return nil, err
		}
		output = append(output, LibrarySearchHit{
			Book:         summary,
			TotalMatches: hit.TotalMatches,
			Pages:        toBookSearchResults(hit.Segments),
		})
	}
	return output, nil
}

// SaveBookCover stores a cover the frontend rendered with PDF.js, sent as a PNG data URL.
func (s *BooksService) SaveBookCover(bookID, dataURL string) error {
	content, err := decodePNGDataURL(dataURL)
	if err != nil {
		return err
	}
	return s.books.SaveCover(s.context(), bookID, content)
}

func (s *BooksService) MarkBookCoverFailed(bookID string) error {
	return s.books.MarkCoverFailed(s.context(), bookID)
}

func (s *BooksService) bookFile(opened books.OpenedBook) (BookFile, error) {
	book := opened.Book
	url, err := s.registerBook(book)
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
		IndexedPageCount: opened.IndexedSegments,
		NextSegment:      opened.NextSegment,
		CoverStatus:      coverStatus,
	}
	if len(opened.Spine) > 0 {
		file.SpineItems = make([]SpineItem, len(opened.Spine))
		for i, item := range opened.Spine {
			file.SpineItems[i] = SpineItem(item)
		}
	}
	return file, nil
}

func (s *BooksService) bookSummary(entry books.Entry) (BookSummary, error) {
	summary := BookSummary{
		ID:          entry.ID,
		Title:       entry.Display(),
		FileName:    entry.FileName,
		Format:      entry.Format,
		Size:        entry.SizeBytes,
		PageCount:   entry.PageCount,
		LastPage:    entry.LastPage,
		ImportedAt:  entry.ImportedAt,
		LastOpened:  entry.LastOpenedAt,
		CoverStatus: entry.CoverThumbnailStatus,
		Available:   entry.Available,
	}
	if entry.CoverThumbnailStatus == "ready" {
		url, err := s.assets.Register(entry.CoverThumbnailPath, coverContentType(entry.CoverThumbnailPath))
		if err != nil {
			return BookSummary{}, err
		}
		summary.CoverURL = url
	}
	return summary, nil
}

func (s *BooksService) registerBook(book library.Book) (string, error) {
	return s.assets.Register(book.SourcePath, bookContentType(book.Format))
}

// bookError turns the book errors the user can act on into localized messages.
func (s *BooksService) bookError(err error) error {
	ctx := s.context()
	switch {
	case errors.Is(err, books.ErrSourceMissing):
		return s.text.error(ctx,
			"The book could not be found. Choose the file again from the library.",
			"本のファイルが見つかりません。本棚からファイルを再選択してください。",
		)
	case errors.Is(err, books.ErrEPUBDRMProtected):
		return s.text.error(ctx,
			"This EPUB is DRM-protected and cannot be opened.",
			"このEPUBはDRM保護されているため開けません。",
		)
	case errors.Is(err, books.ErrUnsupportedBookFormat):
		return s.text.error(ctx,
			"Glint can only import PDF or EPUB files.",
			"PDF または EPUB のみ取り込めます。",
		)
	case errors.Is(err, library.ErrInvalidDisplayName):
		return s.text.error(ctx,
			"Book names must be between 1 and 200 characters.",
			"本の名前は1〜200文字で入力してください。",
		)
	case errors.Is(err, library.ErrInvalidBookmark):
		return s.text.error(ctx, "The bookmark is invalid.", "しおりの内容が不正です。")
	case errors.Is(err, library.ErrInvalidHighlight):
		return s.text.error(ctx,
			"The highlight could not be saved. Select up to 10,000 characters on one page.",
			"ハイライトを保存できませんでした。1ページ内で10,000文字以内を選択してください。",
		)
	case errors.Is(err, library.ErrInvalidSegmentBatch):
		return s.text.error(ctx, "The book index data is invalid.", "本の索引データが不正です。")
	case errors.Is(err, library.ErrInvalidBookSearchQuery):
		return s.text.error(ctx,
			"Search terms must be between 1 and 200 characters.",
			"検索語は1〜200文字で入力してください。",
		)
	default:
		return err
	}
}

func decodePNGDataURL(dataURL string) ([]byte, error) {
	const prefix = "data:image/png;base64,"
	encoded, ok := strings.CutPrefix(dataURL, prefix)
	if !ok {
		return nil, errors.New("cover must be a PNG data URL")
	}
	if base64.StdEncoding.DecodedLen(len(encoded)) > books.MaxCoverBytes {
		return nil, errors.New("cover image is too large")
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, fmt.Errorf("decode cover image: %w", err)
	}
	return content, nil
}

func bookContentType(format string) string {
	if format == books.BookFormatEPUB {
		return "application/epub+zip"
	}
	return "application/pdf"
}

func coverContentType(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
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
