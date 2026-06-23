package books

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type BookFile struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Name             string `json:"name"`
	URL              string `json:"url"`
	Size             int64  `json:"size"`
	InitialPage      int    `json:"initialPage"`
	IndexedPageCount int    `json:"indexedPageCount"`
	CoverStatus      string `json:"coverStatus"`
}

type BookPageInput struct {
	PageNumber int     `json:"pageNumber"`
	Text       string  `json:"text"`
	Width      float64 `json:"width"`
	Height     float64 `json:"height"`
}

type BookSearchResult struct {
	PageNumber int    `json:"pageNumber"`
	Excerpt    string `json:"excerpt"`
	MatchCount int    `json:"matchCount"`
}

type BookBookmark struct {
	PageNumber int    `json:"pageNumber"`
	CreatedAt  string `json:"createdAt"`
}

type BookSummary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	FileName    string `json:"fileName"`
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

type Service struct {
	ctx           context.Context
	library       *library.Store
	assets        *assetserver.Server
	dataDirectory string
	settings      *settings.Manager
}

func New(lib *library.Store, assets *assetserver.Server, dataDirectory string, managers ...*settings.Manager) *Service {
	service := &Service{
		library:       lib,
		assets:        assets,
		dataDirectory: dataDirectory,
	}
	if len(managers) > 0 {
		service.settings = managers[0]
	}
	return service
}

// Startup wires the Wails runtime context into the service. It is a package
// function (not a method) so that Wails does not expose it to the frontend as
// a bound RPC.
func Startup(s *Service, ctx context.Context) {
	s.ctx = ctx
}

func (s *Service) OpenPDF() (BookFile, error) {
	if s.ctx == nil {
		return BookFile{}, errors.New("application is not ready")
	}
	path, err := s.choosePDF(s.localized("Add a technical PDF to the library", "技術書 PDF を本棚へ追加"))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	return s.selectPDF(path)
}

func (s *Service) OpenBook(id string) (BookFile, error) {
	book, err := s.library.Get(context.Background(), id)
	if err != nil {
		return BookFile{}, err
	}
	if !fileExists(book.SourcePath) {
		return BookFile{}, errors.New(s.localized(
			"The PDF could not be found. Choose the file again from the library.",
			"PDFが見つかりません。本棚からファイルを再選択してください。",
		))
	}
	fileHash, size, err := inspectPDF(book.SourcePath)
	if err != nil {
		return BookFile{}, err
	}
	if fileHash != book.FileHash {
		oldCoverPath := book.CoverThumbnailPath
		book, err = s.library.Relink(context.Background(), id, book.SourcePath, fileHash, size, time.Now())
		if err != nil {
			return BookFile{}, err
		}
		if oldCoverPath != "" {
			_ = os.Remove(oldCoverPath)
		}
	}
	if book.CoverThumbnailStatus == "ready" && !fileExists(book.CoverThumbnailPath) {
		if err := s.library.ResetCover(context.Background(), id, time.Now()); err != nil {
			return BookFile{}, err
		}
		book.CoverThumbnailPath = ""
		book.CoverThumbnailStatus = "pending"
	}
	if err := s.library.MarkOpened(context.Background(), id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return s.bookFile(book)
}

func (s *Service) RelinkPDF(id string) (BookFile, error) {
	if s.ctx == nil {
		return BookFile{}, errors.New("application is not ready")
	}
	path, err := s.choosePDF(s.localized("Choose the PDF file again", "PDF ファイルを再選択"))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	fileHash, size, err := inspectPDF(path)
	if err != nil {
		return BookFile{}, err
	}
	oldBook, err := s.library.Get(context.Background(), id)
	if err != nil {
		return BookFile{}, err
	}
	book, err := s.library.Relink(context.Background(), id, path, fileHash, size, time.Now())
	if err != nil {
		return BookFile{}, err
	}
	if oldBook.FileHash != fileHash && oldBook.CoverThumbnailPath != "" {
		_ = os.Remove(oldBook.CoverThumbnailPath)
	}
	if err := s.library.MarkOpened(context.Background(), id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return s.bookFile(book)
}

func (s *Service) RenameBook(id, name string) (BookSummary, error) {
	book, err := s.library.Rename(context.Background(), id, name, time.Now())
	if err != nil {
		if errors.Is(err, library.ErrInvalidDisplayName) {
			return BookSummary{}, errors.New(s.localized(
				"Book names must be between 1 and 200 characters.",
				"本の名前は1〜200文字で入力してください。",
			))
		}
		return BookSummary{}, err
	}
	return s.bookSummary(book)
}

func (s *Service) RemoveBook(id string) (bool, error) {
	book, err := s.library.Get(context.Background(), id)
	if err != nil {
		return false, err
	}
	if s.ctx != nil {
		removeLabel := s.localized("Remove", "削除")
		cancelLabel := s.localized("Cancel", "キャンセル")
		response, err := runtime.MessageDialog(s.ctx, runtime.MessageDialogOptions{
			Type:          runtime.QuestionDialog,
			Title:         s.localized("Remove from library", "本棚から削除"),
			Message:       s.localized(fmt.Sprintf("Remove “%s” from the library?\nThe PDF file itself will remain.", book.Display()), fmt.Sprintf("「%s」を本棚から削除しますか？\nPDFファイル自体は残ります。", book.Display())),
			Buttons:       []string{removeLabel, cancelLabel},
			DefaultButton: cancelLabel,
			CancelButton:  cancelLabel,
		})
		if err != nil {
			return false, fmt.Errorf("confirm book removal: %w", err)
		}
		if response != removeLabel {
			return false, nil
		}
	}
	if err := s.library.Remove(context.Background(), id); err != nil {
		return false, err
	}
	if book.CoverThumbnailPath != "" {
		_ = os.Remove(book.CoverThumbnailPath)
	}
	return true, nil
}

func (s *Service) ListBooks() ([]BookSummary, error) {
	books, err := s.library.List(context.Background())
	if err != nil {
		return nil, err
	}
	summaries := make([]BookSummary, 0, len(books))
	for _, book := range books {
		summary, err := s.bookSummary(book)
		if err != nil {
			return nil, err
		}
		summaries = append(summaries, summary)
	}
	return summaries, nil
}

func (s *Service) bookSummary(book library.Book) (BookSummary, error) {
	summary := BookSummary{
		ID:          book.ID,
		Title:       book.Display(),
		FileName:    book.FileName,
		Size:        book.SizeBytes,
		PageCount:   book.PageCount,
		LastPage:    book.LastPage,
		ImportedAt:  book.ImportedAt,
		LastOpened:  book.LastOpenedAt,
		CoverStatus: book.CoverThumbnailStatus,
		Available:   fileExists(book.SourcePath),
	}
	if book.CoverThumbnailStatus == "ready" && fileExists(book.CoverThumbnailPath) {
		url, err := s.assets.Register(book.CoverThumbnailPath, "image/png")
		if err != nil {
			return BookSummary{}, err
		}
		summary.CoverURL = url
	} else if book.CoverThumbnailStatus == "ready" {
		summary.CoverStatus = "pending"
		if err := s.library.ResetCover(context.Background(), book.ID, time.Now()); err != nil {
			return BookSummary{}, err
		}
	}
	return summary, nil
}

func (s *Service) SaveReadingPosition(bookID string, pageNumber, pageCount int) error {
	return s.library.SaveReadingPosition(context.Background(), bookID, pageNumber, pageCount, time.Now())
}

func (s *Service) ListBookmarks(bookID string) ([]BookBookmark, error) {
	bookmarks, err := s.library.ListBookmarks(context.Background(), bookID)
	if err != nil {
		return nil, err
	}
	output := make([]BookBookmark, len(bookmarks))
	for i, bookmark := range bookmarks {
		output[i] = BookBookmark{PageNumber: bookmark.PageNumber, CreatedAt: bookmark.CreatedAt}
	}
	return output, nil
}

func (s *Service) AddBookmark(bookID string, pageNumber, pageCount int) (BookBookmark, error) {
	bookmark, err := s.library.SaveBookmark(
		context.Background(), bookID, pageNumber, pageCount, time.Now(),
	)
	if errors.Is(err, library.ErrInvalidBookmark) {
		return BookBookmark{}, errors.New(s.localized(
			"The bookmark page is outside this document.",
			"しおりのページがこのPDFの範囲外です。",
		))
	}
	if err != nil {
		return BookBookmark{}, err
	}
	return BookBookmark{PageNumber: bookmark.PageNumber, CreatedAt: bookmark.CreatedAt}, nil
}

func (s *Service) RemoveBookmark(bookID string, pageNumber int) error {
	err := s.library.DeleteBookmark(context.Background(), bookID, pageNumber)
	if errors.Is(err, library.ErrInvalidBookmark) {
		return errors.New(s.localized("The bookmark is invalid.", "しおりの内容が不正です。"))
	}
	return err
}

// SaveBookPages persists a bounded extraction batch produced by PDF.js. It
// returns the total indexed page count so the reader can report progress.
func (s *Service) SaveBookPages(bookID string, pages []BookPageInput, pageCount int) (int, error) {
	inputs := make([]library.BookPage, len(pages))
	for i, page := range pages {
		inputs[i] = library.BookPage{
			PageNumber: page.PageNumber,
			Text:       page.Text,
			Width:      page.Width,
			Height:     page.Height,
		}
	}
	count, err := s.library.SaveBookPages(
		context.Background(), bookID, inputs, pageCount, time.Now(),
	)
	if errors.Is(err, library.ErrInvalidBookPageBatch) {
		return 0, errors.New(s.localized("The PDF page index is invalid.", "PDF page indexの内容が不正です。"))
	}
	return count, err
}

func (s *Service) SearchBook(bookID, query string) ([]BookSearchResult, error) {
	results, err := s.library.SearchBookPages(context.Background(), bookID, query, 50)
	if errors.Is(err, library.ErrInvalidBookSearchQuery) {
		return nil, errors.New(s.localized(
			"Search terms must be between 1 and 200 characters.",
			"検索語は1〜200文字で入力してください。",
		))
	}
	if err != nil {
		return nil, err
	}
	output := make([]BookSearchResult, len(results))
	for i, result := range results {
		output[i] = BookSearchResult{
			PageNumber: result.PageNumber,
			Excerpt:    result.Excerpt,
			MatchCount: result.MatchCount,
		}
	}
	return output, nil
}

// SearchLibrary runs a library-wide lexical search and returns matches grouped
// by book, with book metadata pre-resolved so the result list can render covers
// and titles without an extra round trip.
func (s *Service) SearchLibrary(query string) ([]LibrarySearchHit, error) {
	hits, err := s.library.SearchLibraryPages(context.Background(), query, 0, 0)
	if errors.Is(err, library.ErrInvalidBookSearchQuery) {
		return nil, errors.New(s.localized(
			"Search terms must be between 1 and 200 characters.",
			"検索語は1〜200文字で入力してください。",
		))
	}
	if err != nil {
		return nil, err
	}
	if len(hits) == 0 {
		return []LibrarySearchHit{}, nil
	}
	output := make([]LibrarySearchHit, 0, len(hits))
	for _, hit := range hits {
		book, err := s.library.Get(context.Background(), hit.BookID)
		if errors.Is(err, library.ErrBookNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		summary, err := s.bookSummary(book)
		if err != nil {
			return nil, err
		}
		pages := make([]BookSearchResult, len(hit.Pages))
		for i, page := range hit.Pages {
			pages[i] = BookSearchResult{
				PageNumber: page.PageNumber,
				Excerpt:    page.Excerpt,
				MatchCount: page.MatchCount,
			}
		}
		output = append(output, LibrarySearchHit{
			Book:         summary,
			TotalMatches: hit.TotalMatches,
			Pages:        pages,
		})
	}
	return output, nil
}

func (s *Service) localized(english, japanese string) string {
	if s.settings == nil {
		return english
	}
	preference, err := s.settings.GetLanguage(context.Background())
	if err == nil && preference.Language == settings.LanguageJapanese {
		return japanese
	}
	return english
}

func (s *Service) selectPDF(path string) (BookFile, error) {
	fileHash, size, err := inspectPDF(path)
	if err != nil {
		return BookFile{}, err
	}
	id, err := randomToken()
	if err != nil {
		return BookFile{}, fmt.Errorf("create book id: %w", err)
	}
	book, err := s.library.Import(context.Background(), id, path, fileHash, size, time.Now())
	if err != nil {
		return BookFile{}, err
	}
	if err := s.library.MarkOpened(context.Background(), book.ID, time.Now()); err != nil {
		return BookFile{}, err
	}
	return s.bookFile(book)
}

func (s *Service) bookFile(book library.Book) (BookFile, error) {
	url, err := s.assets.Register(book.SourcePath, "application/pdf")
	if err != nil {
		return BookFile{}, err
	}
	indexedPageCount, err := s.library.BookPageCount(context.Background(), book.ID)
	if err != nil {
		return BookFile{}, err
	}
	coverStatus := book.CoverThumbnailStatus
	if coverStatus == "failed" {
		coverStatus = "pending"
	}
	return BookFile{
		ID:               book.ID,
		Title:            book.Display(),
		Name:             book.FileName,
		URL:              url,
		Size:             book.SizeBytes,
		InitialPage:      max(1, book.LastPage),
		IndexedPageCount: indexedPageCount,
		CoverStatus:      coverStatus,
	}, nil
}

func (s *Service) choosePDF(title string) (string, error) {
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title: title,
		Filters: []runtime.FileFilter{
			{DisplayName: "PDF files (*.pdf)", Pattern: "*.pdf"},
		},
	})
	if err != nil {
		return "", fmt.Errorf("open PDF dialog: %w", err)
	}
	return path, nil
}

func randomToken() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}
