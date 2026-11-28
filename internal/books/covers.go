package books

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ktsu2i/glint/internal/library"
)

const maxCoverBytes = 4 << 20

const MaxCoverBytes = maxCoverBytes

var ErrInvalidCover = errors.New("cover image must be a PNG")

func (s *Service) SaveCover(ctx context.Context, bookID string, png []byte) error {
	if len(png) > maxCoverBytes {
		return fmt.Errorf("%w: image is too large", ErrInvalidCover)
	}
	if len(png) < 8 || string(png[:8]) != "\x89PNG\r\n\x1a\n" {
		return ErrInvalidCover
	}
	book, err := s.library.Get(ctx, bookID)
	if err != nil {
		return err
	}
	coverDirectory := filepath.Join(s.dataDirectory, "covers")
	if err := os.MkdirAll(coverDirectory, 0o700); err != nil {
		return fmt.Errorf("create cover directory: %w", err)
	}
	hashPart := book.FileHash
	if len(hashPart) > 12 {
		hashPart = hashPart[:12]
	}
	path := filepath.Join(coverDirectory, book.ID+"-"+hashPart+".png")
	temporaryPath := path + ".tmp"
	if err := os.WriteFile(temporaryPath, png, 0o600); err != nil {
		return fmt.Errorf("write cover image: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("store cover image: %w", err)
	}
	return s.library.SaveCover(ctx, bookID, path, time.Now())
}

func (s *Service) MarkCoverFailed(ctx context.Context, bookID string) error {
	return s.library.MarkCoverFailed(ctx, bookID, time.Now())
}

func (s *Service) extractEPUBCover(ctx context.Context, book library.Book, pkg *epubPackage) error {
	if pkg == nil || pkg.CoverItemHref == "" {
		return errors.New("EPUB has no cover image")
	}
	reader, err := zip.OpenReader(book.SourcePath)
	if err != nil {
		return fmt.Errorf("open EPUB archive: %w", err)
	}
	defer func() { _ = reader.Close() }()
	data, mediaType, err := pkg.extractCover(&reader.Reader)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return errors.New("EPUB cover image is empty")
	}
	if int64(len(data)) > maxCoverBytes*4 {
		return errors.New("EPUB cover image is too large")
	}
	coverDirectory := filepath.Join(s.dataDirectory, "covers")
	if err := os.MkdirAll(coverDirectory, 0o700); err != nil {
		return fmt.Errorf("create cover directory: %w", err)
	}
	hashPart := book.FileHash
	if len(hashPart) > 12 {
		hashPart = hashPart[:12]
	}
	ext := coverExtension(mediaType, pkg.CoverItemHref)
	target := filepath.Join(coverDirectory, book.ID+"-"+hashPart+ext)
	temporary := target + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return fmt.Errorf("write EPUB cover: %w", err)
	}
	if err := os.Rename(temporary, target); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("store EPUB cover: %w", err)
	}
	return s.library.SaveCover(ctx, book.ID, target, time.Now())
}

func coverExtension(mediaType, href string) string {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	}
	if ext := strings.ToLower(extension(href)); ext != "" {
		return ext
	}
	return ".png"
}
