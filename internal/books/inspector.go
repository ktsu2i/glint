package books

import (
	"errors"
	"path/filepath"
	"strings"
)

// Inspection summarizes a book file we're about to import or relink. The struct
// is shared between PDF and EPUB so the Service layer can branch on Format
// without re-detecting the file type. EPUBMetadata is populated only for
// format=="epub" once Phase E2 lands; in Phase E1 the EPUB branch is a stub
// that returns an error so callers can wire the dispatch without yet handling
// EPUB content.
type Inspection struct {
	Format    string
	FileHash  string
	SizeBytes int64
	Metadata  *EPUBMetadata
}

// EPUBMetadata captures the OPF-level metadata we extract from an EPUB during
// import. Phase E2 fills this in; Phase E1 keeps the shape so signatures don't
// change once EPUB support lands.
type EPUBMetadata struct {
	Title         string
	Authors       []string
	Language      string
	Publisher     string
	Description   string
	CoverItemHref string
	HasEncryption bool
}

// ErrEPUBNotYetSupported is the placeholder returned while EPUB parsing is
// still being implemented. Phase E2 replaces this with real ZIP/OPF logic.
var ErrEPUBNotYetSupported = errors.New("EPUB is not yet supported")

// inspectBook dispatches by file extension so the Service layer does not need
// to know which formats exist. PDF goes through the existing inspectPDF code
// path; EPUB will eventually flow through inspectEPUB, but for now returns
// ErrEPUBNotYetSupported so the Service stays single-format.
func inspectBook(path string) (Inspection, error) {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".pdf":
		hash, size, err := inspectPDF(path)
		if err != nil {
			return Inspection{}, err
		}
		return Inspection{
			Format:    "pdf",
			FileHash:  hash,
			SizeBytes: size,
		}, nil
	case ".epub":
		return Inspection{}, ErrEPUBNotYetSupported
	default:
		return Inspection{}, errors.New("unsupported book format")
	}
}
