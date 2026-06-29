package books

import (
	"errors"
	"path/filepath"
	"strings"
)

// Inspection summarizes a book file we're about to import or relink. The struct
// is shared between PDF and EPUB so the Service layer can branch on Format
// without re-detecting the file type. Metadata is populated only for EPUB so
// callers can pull title / cover / spine information without re-parsing the
// archive.
type Inspection struct {
	Format    string
	FileHash  string
	SizeBytes int64
	Metadata  *EPUBMetadata
}

// EPUBMetadata captures the OPF-level metadata extracted from an EPUB during
// import. HasEncryption is checked separately so callers can reject DRM-
// protected files even when the OPF cannot be parsed.
type EPUBMetadata struct {
	Title         string
	Authors       []string
	Language      string
	Publisher     string
	Description   string
	CoverItemHref string
	HasEncryption bool
}

// ErrEPUBDRMProtected is surfaced when an EPUB carries an
// META-INF/encryption.xml so callers can present a clear user-facing message
// instead of leaking the raw zip error.
var ErrEPUBDRMProtected = errors.New("DRM-protected EPUB files are not supported")

// ErrUnsupportedBookFormat is returned when a file with an unknown extension is
// chosen from the file dialog.
var ErrUnsupportedBookFormat = errors.New("unsupported book format")

// inspectBook dispatches by file extension so the Service layer does not need
// to know which formats exist. PDF goes through the existing inspectPDF code
// path; EPUB flows through inspectEPUB and surfaces a typed DRM rejection so
// the Service can localize the user-facing copy.
func inspectBook(filePath string) (Inspection, *epubPackage, error) {
	switch strings.ToLower(filepath.Ext(filePath)) {
	case ".pdf":
		hash, size, err := inspectPDF(filePath)
		if err != nil {
			return Inspection{}, nil, err
		}
		return Inspection{
			Format:    BookFormatPDF,
			FileHash:  hash,
			SizeBytes: size,
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

// BookFormatPDF / BookFormatEPUB mirror the library package constants but keep
// the books package self-contained so the inspector does not need to import the
// library every time it wants to label a format.
const (
	BookFormatPDF  = "pdf"
	BookFormatEPUB = "epub"
)
