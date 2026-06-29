package books

import (
	"archive/zip"
	"context"
	"fmt"
	"time"

	"github.com/kaito/glint/internal/library"
)

// indexEPUBSpine extracts plain text for every spine item and persists it to
// book_pages so the existing lexical search treats EPUB chapters the same as
// PDF pages. Empty spines (a malformed OPF) are tolerated: the book still
// imports, just without any indexed text.
func (s *Service) indexEPUBSpine(book library.Book, pkg *epubPackage) error {
	if pkg == nil || len(pkg.Spine) == 0 {
		return nil
	}
	reader, err := zip.OpenReader(book.SourcePath)
	if err != nil {
		return fmt.Errorf("open EPUB archive: %w", err)
	}
	defer reader.Close()

	total := len(pkg.Spine)
	batch := make([]library.BookPage, 0, epubIndexBatchSize)
	for index, item := range pkg.Spine {
		text, err := pkg.extractSpineItemText(&reader.Reader, item)
		if err != nil {
			text = ""
		}
		batch = append(batch, library.BookPage{
			PageNumber: index + 1,
			Text:       text,
		})
		if len(batch) >= epubIndexBatchSize {
			if _, err := s.library.SaveBookPages(
				context.Background(), book.ID, batch, total, time.Now(),
			); err != nil {
				return fmt.Errorf("save EPUB spine batch: %w", err)
			}
			batch = batch[:0]
		}
	}
	if len(batch) > 0 {
		if _, err := s.library.SaveBookPages(
			context.Background(), book.ID, batch, total, time.Now(),
		); err != nil {
			return fmt.Errorf("save EPUB spine batch: %w", err)
		}
	}
	return nil
}

// epubIndexBatchSize mirrors library.maxBookPageBatchSize so the EPUB indexer
// stays under the SQLite-side limit without depending on an internal constant.
const epubIndexBatchSize = 50
