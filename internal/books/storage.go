package books

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ktsu2i/glint/internal/library"
)

func (s *Service) booksDirectory() string {
	return filepath.Join(s.dataDirectory, "books")
}

func (s *Service) bookDirectory(id string) string {
	return filepath.Join(s.booksDirectory(), id)
}

func (s *Service) isStored(path string) bool {
	rel, err := filepath.Rel(s.booksDirectory(), path)
	if err != nil {
		return false
	}
	return rel != "." && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)
}

func (s *Service) storeCopy(id, sourcePath string) (string, error) {
	if id == "" {
		return "", errors.New("store book file: empty book id")
	}
	directory := s.bookDirectory(id)
	destination := filepath.Join(directory, filepath.Base(sourcePath))
	if filepath.Clean(sourcePath) == destination {
		return destination, nil
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return "", fmt.Errorf("create book directory: %w", err)
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return "", fmt.Errorf("open book file: %w", err)
	}
	defer func() { _ = source.Close() }()
	info, err := source.Stat()
	if err != nil {
		return "", fmt.Errorf("inspect book file: %w", err)
	}
	temporary, err := os.CreateTemp(directory, ".import-*")
	if err != nil {
		return "", fmt.Errorf("create book copy: %w", err)
	}
	temporaryPath := temporary.Name()
	cleanup := func() { _ = os.Remove(temporaryPath) }
	if _, err := io.Copy(temporary, source); err != nil {
		_ = temporary.Close()
		cleanup()
		return "", fmt.Errorf("copy book file: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		cleanup()
		return "", fmt.Errorf("copy book file: %w", err)
	}
	if err := temporary.Close(); err != nil {
		cleanup()
		return "", fmt.Errorf("copy book file: %w", err)
	}
	if err := os.Chtimes(temporaryPath, info.ModTime(), info.ModTime()); err != nil {
		cleanup()
		return "", fmt.Errorf("copy book file: %w", err)
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		cleanup()
		return "", fmt.Errorf("store book copy: %w", err)
	}
	return destination, nil
}

func (s *Service) removeOtherCopies(id, keep string) {
	entries, err := os.ReadDir(s.bookDirectory(id))
	if err != nil {
		return
	}
	for _, entry := range entries {
		path := filepath.Join(s.bookDirectory(id), entry.Name())
		if path != keep {
			_ = os.RemoveAll(path)
		}
	}
}

func (s *Service) adoptSource(ctx context.Context, book library.Book) (library.Book, error) {
	if s.isStored(book.SourcePath) || !fileExists(book.SourcePath) {
		return book, nil
	}
	stored, err := s.storeCopy(book.ID, book.SourcePath)
	if err != nil {
		return book, nil
	}
	adopted, err := s.library.Relink(ctx, book.ID, stored, book.FileHash, book.SizeBytes, time.Now())
	if err != nil {
		_ = os.Remove(stored)
		return library.Book{}, err
	}
	return adopted, nil
}
