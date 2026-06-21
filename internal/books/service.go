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
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type BookFile struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Name        string `json:"name"`
	URL         string `json:"url"`
	Size        int64  `json:"size"`
	InitialPage int    `json:"initialPage"`
	CoverStatus string `json:"coverStatus"`
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

type Service struct {
	ctx           context.Context
	library       *library.Store
	assets        *assetserver.Server
	dataDirectory string
}

func New(lib *library.Store, assets *assetserver.Server, dataDirectory string) *Service {
	return &Service{
		library:       lib,
		assets:        assets,
		dataDirectory: dataDirectory,
	}
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
	path, err := s.choosePDF("技術書 PDF を本棚へ追加")
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
		return BookFile{}, errors.New("PDFが見つかりません。本棚からファイルを再選択してください。")
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
	path, err := s.choosePDF("PDF ファイルを再選択")
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
			return BookSummary{}, errors.New("本の名前は1〜200文字で入力してください。")
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
		response, err := runtime.MessageDialog(s.ctx, runtime.MessageDialogOptions{
			Type:          runtime.QuestionDialog,
			Title:         "本棚から削除",
			Message:       fmt.Sprintf("「%s」を本棚から削除しますか？\nPDFファイル自体は残ります。", book.Display()),
			Buttons:       []string{"削除", "キャンセル"},
			DefaultButton: "キャンセル",
			CancelButton:  "キャンセル",
		})
		if err != nil {
			return false, fmt.Errorf("confirm book removal: %w", err)
		}
		if response != "削除" {
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
	coverStatus := book.CoverThumbnailStatus
	if coverStatus == "failed" {
		coverStatus = "pending"
	}
	return BookFile{
		ID:          book.ID,
		Title:       book.Display(),
		Name:        book.FileName,
		URL:         url,
		Size:        book.SizeBytes,
		InitialPage: max(1, book.LastPage),
		CoverStatus: coverStatus,
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
