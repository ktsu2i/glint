package books

import (
	"errors"
	"path/filepath"
	"strings"
	"time"

	"github.com/kaito/glint/internal/library"
)

type Inspection struct {
	Format    string
	FileHash  string
	SizeBytes int64
	ModTime   time.Time
	Metadata  *EPUBMetadata
}

type EPUBMetadata struct {
	Title         string
	Authors       []string
	Language      string
	Publisher     string
	Description   string
	CoverItemHref string
	HasEncryption bool
}

var ErrEPUBDRMProtected = errors.New("DRM-protected EPUB files are not supported")

var ErrUnsupportedBookFormat = errors.New("unsupported book format")

func inspectBook(filePath string) (Inspection, *epubPackage, error) {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".pdf":
		hash, info, err := inspectPDF(filePath)
		if err != nil {
			return Inspection{}, nil, err
		}
		return Inspection{
			Format:    BookFormatPDF,
			FileHash:  hash,
			SizeBytes: info.Size(),
			ModTime:   info.ModTime(),
		}, nil, nil
	case ".epub":
		inspection, pkg, err := inspectEPUB(filePath)
		if err != nil {
			return Inspection{}, nil, err
		}
		if inspection.Metadata != nil && inspection.Metadata.HasEncryption {
			return Inspection{}, nil, ErrEPUBDRMProtected
		}
		return inspection, pkg, nil
	default:
		return Inspection{}, nil, ErrUnsupportedBookFormat
	}
}

const (
	BookFormatPDF  = library.BookFormatPDF
	BookFormatEPUB = library.BookFormatEPUB
)
