package books

import (
	"archive/zip"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/kaito/glint/internal/library"
)

const maxCoverBytes = 4 << 20

func (l *Library) SaveBookCover(ctx context.Context, bookID, dataURL string) error {
	const prefix = "data:image/png;base64,"
	if len(dataURL) < len(prefix) || dataURL[:len(prefix)] != prefix {
		return errors.New("cover must be a PNG data URL")
	}
	encoded := dataURL[len(prefix):]
	if base64.StdEncoding.DecodedLen(len(encoded)) > maxCoverBytes {
		return errors.New("cover image is too large")
	}
	content, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return fmt.Errorf("decode cover image: %w", err)
	}
	if len(content) < 8 || string(content[:8]) != "\x89PNG\r\n\x1a\n" {
		return errors.New("cover image is not a PNG")
	}
	book, err := l.store.Get(ctx, bookID)
	if err != nil {
		return err
	}
	coverDirectory := filepath.Join(l.dataDirectory, "covers")
	if err := os.MkdirAll(coverDirectory, 0o700); err != nil {
		return fmt.Errorf("create cover directory: %w", err)
	}
	hashPart := book.FileHash
	if len(hashPart) > 12 {
		hashPart = hashPart[:12]
	}
	path := filepath.Join(coverDirectory, book.ID+"-"+hashPart+".png")
	temporaryPath := path + ".tmp"
	if err := os.WriteFile(temporaryPath, content, 0o600); err != nil {
		return fmt.Errorf("write cover image: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("store cover image: %w", err)
	}
	return l.store.SaveCover(ctx, bookID, path, time.Now())
}

func (l *Library) MarkBookCoverFailed(ctx context.Context, bookID string) error {
	return l.store.MarkCoverFailed(ctx, bookID, time.Now())
}

func (l *Library) extractEPUBCover(ctx context.Context, book library.Book, pkg *epubPackage) error {
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
	coverDirectory := filepath.Join(l.dataDirectory, "covers")
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
	return l.store.SaveCover(ctx, book.ID, target, time.Now())
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
