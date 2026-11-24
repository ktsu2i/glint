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

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
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
	CoverStatus      string      `json:"coverStatus"`
	SpineItems       []SpineItem `json:"spineItems,omitempty"`
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

type Service struct {
	ctx           context.Context
	library       *library.Store
	assets        *assetserver.Server
	dataDirectory string
	settings      *settings.Manager
}

func New(lib *library.Store, assets *assetserver.Server, dataDirectory string, settingsManager *settings.Manager) *Service {
	return &Service{
		library:       lib,
		assets:        assets,
		dataDirectory: dataDirectory,
		settings:      settingsManager,
	}
}

func Startup(s *Service, ctx context.Context) {
	s.ctx = ctx
}

func (s *Service) appContext() context.Context {
	if s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}

func (s *Service) OpenBookFile() (BookFile, error) {
	if s.ctx == nil {
		return BookFile{}, errors.New("application is not ready")
	}
	path, err := s.chooseBookFile(s.localized(
		"Add a technical book to the library",
		"技術書を本棚へ追加",
	))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	return s.selectBookFile(path)
}

func (s *Service) OpenBook(id string) (BookFile, error) {
	book, err := s.library.Get(s.appContext(), id)
	if err != nil {
		return BookFile{}, err
	}
	if !fileExists(book.SourcePath) {
		return BookFile{}, errors.New(s.localized(
			"The book could not be found. Choose the file again from the library.",
			"本のファイルが見つかりません。本棚からファイルを再選択してください。",
		))
	}
	inspection, pkg, err := inspectBook(book.SourcePath)
	if err != nil {
		return BookFile{}, s.translateInspectionError(err)
	}
	if inspection.Format != book.Format {
		return BookFile{}, errors.New(s.localized(
			"The selected file format no longer matches this library entry.",
			"選択されたファイルの形式が本棚の記録と一致しません。",
		))
	}
	if inspection.FileHash != book.FileHash {
		oldCoverPath := book.CoverThumbnailPath
		book, err = s.library.Relink(s.appContext(), id, book.SourcePath, inspection.FileHash, inspection.SizeBytes, time.Now())
		if err != nil {
			return BookFile{}, err
		}
		if oldCoverPath != "" {
			_ = os.Remove(oldCoverPath)
		}
		if err := s.afterImport(book, pkg); err != nil {
			return BookFile{}, err
		}
	}
	if book.CoverThumbnailStatus == "ready" && !fileExists(book.CoverThumbnailPath) {
		if err := s.library.ResetCover(s.appContext(), id, time.Now()); err != nil {
			return BookFile{}, err
		}
		book.CoverThumbnailPath = ""
		book.CoverThumbnailStatus = "pending"
	}
	if err := s.library.MarkOpened(s.appContext(), id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return s.bookFile(book, pkg)
}

func (s *Service) RelinkBook(id string) (BookFile, error) {
	if s.ctx == nil {
		return BookFile{}, errors.New("application is not ready")
	}
	path, err := s.chooseBookFile(s.localized(
		"Choose the book file again",
		"ファイルを再選択",
	))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	inspection, pkg, err := inspectBook(path)
	if err != nil {
		return BookFile{}, s.translateInspectionError(err)
	}
	oldBook, err := s.library.Get(s.appContext(), id)
	if err != nil {
		return BookFile{}, err
	}
	if inspection.Format != oldBook.Format {
		return BookFile{}, errors.New(s.localized(
			"The chosen file format does not match this library entry.",
			"選択したファイルの形式が本棚の記録と一致しません。",
		))
	}
	book, err := s.library.Relink(s.appContext(), id, path, inspection.FileHash, inspection.SizeBytes, time.Now())
	if err != nil {
		return BookFile{}, err
	}
	if oldBook.FileHash != inspection.FileHash && oldBook.CoverThumbnailPath != "" {
		_ = os.Remove(oldBook.CoverThumbnailPath)
	}
	if oldBook.FileHash != inspection.FileHash {
		if err := s.afterImport(book, pkg); err != nil {
			return BookFile{}, err
		}
	}
	if err := s.library.MarkOpened(s.appContext(), id, time.Now()); err != nil {
		return BookFile{}, err
	}
	return s.bookFile(book, pkg)
}

func (s *Service) RenameBook(id, name string) (BookSummary, error) {
	book, err := s.library.Rename(s.appContext(), id, name, time.Now())
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
	book, err := s.library.Get(s.appContext(), id)
	if err != nil {
		return false, err
	}
	if s.ctx != nil {
		removeLabel := s.localized("Remove", "削除")
		cancelLabel := s.localized("Cancel", "キャンセル")
		response, err := runtime.MessageDialog(s.ctx, runtime.MessageDialogOptions{
			Type:          runtime.QuestionDialog,
			Title:         s.localized("Remove from library", "本棚から削除"),
			Message:       s.localized(fmt.Sprintf("Remove “%s” from the library?\nThe source file itself will remain.", book.Display()), fmt.Sprintf("「%s」を本棚から削除しますか？\n元のファイル自体は残ります。", book.Display())),
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
	if err := s.library.Remove(s.appContext(), id); err != nil {
		return false, err
	}
	if book.CoverThumbnailPath != "" {
		_ = os.Remove(book.CoverThumbnailPath)
	}
	return true, nil
}

func (s *Service) ListBooks() ([]BookSummary, error) {
	books, err := s.library.List(s.appContext())
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
		url, err := s.assets.Register(book.CoverThumbnailPath, coverContentType(book.CoverThumbnailPath))
		if err != nil {
			return BookSummary{}, err
		}
		summary.CoverURL = url
	} else if book.CoverThumbnailStatus == "ready" {
		summary.CoverStatus = "pending"
		if err := s.library.ResetCover(s.appContext(), book.ID, time.Now()); err != nil {
			return BookSummary{}, err
		}
	}
	return summary, nil
}

func (s *Service) SaveReadingPosition(bookID string, pageNumber, pageCount int) error {
	return s.library.SaveReadingPosition(s.appContext(), bookID, pageNumber, pageCount, time.Now())
}

func (s *Service) ListBookmarks(bookID string) ([]BookBookmark, error) {
	bookmarks, err := s.library.ListBookmarks(s.appContext(), bookID)
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
		s.appContext(), bookID, pageNumber, pageCount, time.Now(),
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
	err := s.library.DeleteBookmark(s.appContext(), bookID, pageNumber)
	if errors.Is(err, library.ErrInvalidBookmark) {
		return errors.New(s.localized("The bookmark is invalid.", "しおりの内容が不正です。"))
	}
	return err
}

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
		s.appContext(), bookID, inputs, pageCount, time.Now(),
	)
	if errors.Is(err, library.ErrInvalidBookPageBatch) {
		return 0, errors.New(s.localized("The PDF page index is invalid.", "PDF page indexの内容が不正です。"))
	}
	return count, err
}

func (s *Service) SearchBook(bookID, query string) ([]BookSearchResult, error) {
	results, err := s.library.SearchBookPages(s.appContext(), bookID, query, 50)
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

func (s *Service) SearchLibrary(query string) ([]LibrarySearchHit, error) {
	hits, err := s.library.SearchLibraryPages(s.appContext(), query, 0, 0)
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
		book, err := s.library.Get(s.appContext(), hit.BookID)
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
	preference, err := s.settings.GetLanguage(s.appContext())
	if err == nil && preference.Language == settings.LanguageJapanese {
		return japanese
	}
	return english
}

func (s *Service) selectBookFile(filePath string) (BookFile, error) {
	inspection, pkg, err := inspectBook(filePath)
	if err != nil {
		return BookFile{}, s.translateInspectionError(err)
	}
	id, err := randomToken()
	if err != nil {
		return BookFile{}, fmt.Errorf("create book id: %w", err)
	}
	book, err := s.library.Import(
		s.appContext(), id, filePath, inspection.FileHash,
		inspection.Format, inspection.SizeBytes, time.Now(),
	)
	if err != nil {
		return BookFile{}, err
	}
	if err := s.afterImport(book, pkg); err != nil {
		return BookFile{}, err
	}
	book, err = s.library.Get(s.appContext(), book.ID)
	if err != nil {
		return BookFile{}, err
	}
	if err := s.library.MarkOpened(s.appContext(), book.ID, time.Now()); err != nil {
		return BookFile{}, err
	}
	return s.bookFile(book, pkg)
}

func (s *Service) afterImport(book library.Book, pkg *epubPackage) error {
	if book.Format != BookFormatEPUB || pkg == nil {
		return nil
	}
	if err := s.extractEPUBCover(book, pkg); err != nil {
		_ = s.library.MarkCoverFailed(s.appContext(), book.ID, time.Now())
	}
	return s.indexEPUBSpine(book, pkg)
}

func (s *Service) bookFile(book library.Book, pkg *epubPackage) (BookFile, error) {
	url, err := s.assets.Register(book.SourcePath, bookContentType(book.Format))
	if err != nil {
		return BookFile{}, err
	}
	indexedPageCount, err := s.library.BookPageCount(s.appContext(), book.ID)
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
		CoverStatus:      coverStatus,
	}
	if book.Format == BookFormatEPUB && pkg != nil {
		file.SpineItems = pkg.Spine
	}
	return file, nil
}

func (s *Service) chooseBookFile(title string) (string, error) {
	filters := []runtime.FileFilter{
		{DisplayName: "Books (*.pdf;*.epub)", Pattern: "*.pdf;*.epub"},
		{DisplayName: "PDF files (*.pdf)", Pattern: "*.pdf"},
		{DisplayName: "EPUB files (*.epub)", Pattern: "*.epub"},
	}
	path, err := runtime.OpenFileDialog(s.ctx, runtime.OpenDialogOptions{
		Title:   title,
		Filters: filters,
	})
	if err != nil {
		return "", fmt.Errorf("open book dialog: %w", err)
	}
	return path, nil
}

func (s *Service) translateInspectionError(err error) error {
	switch {
	case errors.Is(err, ErrEPUBDRMProtected):
		return errors.New(s.localized(
			"This EPUB is DRM-protected and cannot be opened.",
			"このEPUBはDRM保護されているため開けません。",
		))
	case errors.Is(err, ErrUnsupportedBookFormat):
		return errors.New(s.localized(
			"Glint can only import PDF or EPUB files.",
			"PDF または EPUB のみ取り込めます。",
		))
	default:
		return err
	}
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
