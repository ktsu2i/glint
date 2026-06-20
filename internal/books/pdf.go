package books

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func inspectPDF(path string) (string, int64, error) {
	if !strings.EqualFold(filepath.Ext(path), ".pdf") {
		return "", 0, errors.New("selected file is not a PDF")
	}
	file, err := os.Open(path)
	if err != nil {
		return "", 0, fmt.Errorf("open selected PDF: %w", err)
	}
	defer file.Close()
	header := make([]byte, 5)
	if _, err := io.ReadFull(file, header); err != nil {
		return "", 0, fmt.Errorf("read selected PDF: %w", err)
	}
	if string(header) != "%PDF-" {
		return "", 0, errors.New("selected file does not contain a PDF header")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", 0, fmt.Errorf("rewind selected PDF: %w", err)
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", 0, fmt.Errorf("hash selected PDF: %w", err)
	}
	info, err := file.Stat()
	if err != nil {
		return "", 0, fmt.Errorf("inspect selected PDF: %w", err)
	}
	return hex.EncodeToString(hash.Sum(nil)), info.Size(), nil
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
