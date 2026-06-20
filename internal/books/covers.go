package books

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const maxCoverBytes = 4 << 20

func (s *Service) SaveBookCover(bookID, dataURL string) error {
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
	book, err := s.library.Get(context.Background(), bookID)
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
	if err := os.WriteFile(temporaryPath, content, 0o600); err != nil {
		return fmt.Errorf("write cover image: %w", err)
	}
	if err := os.Rename(temporaryPath, path); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("store cover image: %w", err)
	}
	return s.library.SaveCover(context.Background(), bookID, path, time.Now())
}

func (s *Service) MarkBookCoverFailed(bookID string) error {
	return s.library.MarkCoverFailed(context.Background(), bookID, time.Now())
}
