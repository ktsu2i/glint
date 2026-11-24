package books

import (
	"context"
	"errors"
	"fmt"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"github.com/kaito/glint/internal/assetserver"
	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
)

// Service is the Wails-bound adapter for Library. It owns native dialogs, the app context,
// and localized error messages; the book logic itself lives in Library.
type Service struct {
	ctx      context.Context
	books    *Library
	settings *settings.Manager
}

func New(lib *library.Store, assets *assetserver.Server, dataDirectory string, settingsManager *settings.Manager) *Service {
	return &Service{
		books:    NewLibrary(lib, assets, dataDirectory),
		settings: settingsManager,
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

var errAppNotReady = errors.New("application is not ready")

func (s *Service) OpenBookFile() (BookFile, error) {
	if s.ctx == nil {
		return BookFile{}, errAppNotReady
	}
	path, err := s.chooseBookFile(s.localized(
		"Add a technical book to the library",
		"技術書を本棚へ追加",
	))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	file, err := s.books.ImportBook(s.appContext(), path)
	return file, s.userError(err)
}

func (s *Service) OpenBook(id string) (BookFile, error) {
	file, err := s.books.OpenBook(s.appContext(), id)
	return file, s.userError(err)
}

func (s *Service) RelinkBook(id string) (BookFile, error) {
	if s.ctx == nil {
		return BookFile{}, errAppNotReady
	}
	path, err := s.chooseBookFile(s.localized(
		"Choose the book file again",
		"ファイルを再選択",
	))
	if err != nil || path == "" {
		return BookFile{}, err
	}
	file, err := s.books.RelinkBook(s.appContext(), id, path)
	return file, s.userError(err)
}

func (s *Service) RenameBook(id, name string) (BookSummary, error) {
	summary, err := s.books.RenameBook(s.appContext(), id, name)
	return summary, s.userError(err)
}

func (s *Service) RemoveBook(id string) (bool, error) {
	name, err := s.books.DisplayName(s.appContext(), id)
	if err != nil {
		return false, err
	}
	if s.ctx != nil {
		confirmed, err := s.confirmRemoval(name)
		if err != nil || !confirmed {
			return false, err
		}
	}
	if err := s.books.RemoveBook(s.appContext(), id); err != nil {
		return false, err
	}
	return true, nil
}

func (s *Service) confirmRemoval(name string) (bool, error) {
	removeLabel := s.localized("Remove", "削除")
	cancelLabel := s.localized("Cancel", "キャンセル")
	response, err := runtime.MessageDialog(s.ctx, runtime.MessageDialogOptions{
		Type:  runtime.QuestionDialog,
		Title: s.localized("Remove from library", "本棚から削除"),
		Message: s.localized(
			fmt.Sprintf("Remove “%s” from the library?\nThe source file itself will remain.", name),
			fmt.Sprintf("「%s」を本棚から削除しますか？\n元のファイル自体は残ります。", name),
		),
		Buttons:       []string{removeLabel, cancelLabel},
		DefaultButton: cancelLabel,
		CancelButton:  cancelLabel,
	})
	if err != nil {
		return false, fmt.Errorf("confirm book removal: %w", err)
	}
	return response == removeLabel, nil
}

func (s *Service) ListBooks() ([]BookSummary, error) {
	return s.books.ListBooks(s.appContext())
}

func (s *Service) SaveReadingPosition(bookID string, pageNumber, pageCount int) error {
	return s.books.SaveReadingPosition(s.appContext(), bookID, pageNumber, pageCount)
}

func (s *Service) ListBookmarks(bookID string) ([]BookBookmark, error) {
	return s.books.ListBookmarks(s.appContext(), bookID)
}

func (s *Service) AddBookmark(bookID string, pageNumber, pageCount int) (BookBookmark, error) {
	bookmark, err := s.books.AddBookmark(s.appContext(), bookID, pageNumber, pageCount)
	if errors.Is(err, library.ErrInvalidBookmark) {
		return BookBookmark{}, errors.New(s.localized(
			"The bookmark page is outside this document.",
			"しおりのページがこのPDFの範囲外です。",
		))
	}
	return bookmark, err
}

func (s *Service) RemoveBookmark(bookID string, pageNumber int) error {
	err := s.books.RemoveBookmark(s.appContext(), bookID, pageNumber)
	if errors.Is(err, library.ErrInvalidBookmark) {
		return errors.New(s.localized("The bookmark is invalid.", "しおりの内容が不正です。"))
	}
	return err
}

func (s *Service) SaveBookSegments(bookID string, segments []BookSegmentInput, total int) (int, error) {
	count, err := s.books.SaveBookSegments(s.appContext(), bookID, segments, total)
	return count, s.userError(err)
}

func (s *Service) PendingIndexBooks() ([]IndexTarget, error) {
	return s.books.PendingIndexBooks(s.appContext())
}

func (s *Service) SearchBook(bookID, query string) ([]BookSearchResult, error) {
	results, err := s.books.SearchBook(s.appContext(), bookID, query)
	return results, s.userError(err)
}

func (s *Service) SearchLibrary(query string) ([]LibrarySearchHit, error) {
	hits, err := s.books.SearchLibrary(s.appContext(), query)
	return hits, s.userError(err)
}

func (s *Service) SaveBookCover(bookID, dataURL string) error {
	return s.books.SaveBookCover(s.appContext(), bookID, dataURL)
}

func (s *Service) MarkBookCoverFailed(bookID string) error {
	return s.books.MarkBookCoverFailed(s.appContext(), bookID)
}

// userError replaces known Library errors with a message in the UI language.
// Other errors are returned unchanged.
func (s *Service) userError(err error) error {
	var english, japanese string
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrBookFileMissing):
		english = "The book could not be found. Choose the file again from the library."
		japanese = "本のファイルが見つかりません。本棚からファイルを再選択してください。"
	case errors.Is(err, ErrBookFormatChanged):
		english = "The selected file format no longer matches this library entry."
		japanese = "選択されたファイルの形式が本棚の記録と一致しません。"
	case errors.Is(err, ErrRelinkFormatMismatch):
		english = "The chosen file format does not match this library entry."
		japanese = "選択したファイルの形式が本棚の記録と一致しません。"
	case errors.Is(err, ErrEPUBDRMProtected):
		english = "This EPUB is DRM-protected and cannot be opened."
		japanese = "このEPUBはDRM保護されているため開けません。"
	case errors.Is(err, ErrUnsupportedBookFormat):
		english = "Glint can only import PDF or EPUB files."
		japanese = "PDF または EPUB のみ取り込めます。"
	case errors.Is(err, library.ErrInvalidDisplayName):
		english = "Book names must be between 1 and 200 characters."
		japanese = "本の名前は1〜200文字で入力してください。"
	case errors.Is(err, library.ErrInvalidSegmentBatch):
		english = "The book index data is invalid."
		japanese = "本の索引データが不正です。"
	case errors.Is(err, library.ErrInvalidBookSearchQuery):
		english = "Search terms must be between 1 and 200 characters."
		japanese = "検索語は1〜200文字で入力してください。"
	default:
		return err
	}
	return errors.New(s.localized(english, japanese))
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
