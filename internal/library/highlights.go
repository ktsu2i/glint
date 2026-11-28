package library

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ktsu2i/glint/internal/library/librarydb"
)

var (
	ErrInvalidHighlight  = errors.New("invalid highlight")
	ErrHighlightNotFound = errors.New("highlight not found")
)

var HighlightColors = []string{"yellow", "green", "pink", "purple"}

const (
	MaxHighlightTextRunes = 10_000
	MaxHighlightRects     = 1_000
	MaxHighlightCFIBytes  = 4_096
	rectTolerance         = 0.01
)

type HighlightRect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type HighlightLocation interface {
	highlightLocation()
}

type PDFHighlightLocation struct {
	Page  int
	Rects []HighlightRect
}

type EPUBHighlightLocation struct {
	Section int
	CFI     string
}

func (PDFHighlightLocation) highlightLocation()  {}
func (EPUBHighlightLocation) highlightLocation() {}

type BookHighlight struct {
	ID        int64
	Color     string
	Text      string
	Location  HighlightLocation
	CreatedAt string
}

type NewHighlight struct {
	Location  HighlightLocation
	PageCount int
	Color     string
	Text      string
}

type highlightColumns struct {
	pageNumber int
	rects      []HighlightRect
	cfi        string
}

func columnsOfHighlight(location HighlightLocation) (highlightColumns, bool) {
	switch location := location.(type) {
	case PDFHighlightLocation:
		if len(location.Rects) == 0 || len(location.Rects) > MaxHighlightRects ||
			slices.ContainsFunc(location.Rects, func(rect HighlightRect) bool { return !rect.valid() }) {
			return highlightColumns{}, false
		}
		return highlightColumns{pageNumber: location.Page, rects: location.Rects}, true
	case EPUBHighlightLocation:
		if !validCFI(location.CFI) {
			return highlightColumns{}, false
		}
		return highlightColumns{pageNumber: location.Section, rects: []HighlightRect{}, cfi: location.CFI}, true
	default:
		return highlightColumns{}, false
	}
}

func (store *Store) SaveHighlight(ctx context.Context, bookID string, input NewHighlight, now time.Time) (BookHighlight, error) {
	bookID = strings.TrimSpace(bookID)
	text := strings.TrimSpace(input.Text)
	columns, ok := columnsOfHighlight(input.Location)
	if bookID == "" || !ok || !validHighlight(input, columns.pageNumber, text) {
		return BookHighlight{}, ErrInvalidHighlight
	}
	rects, err := json.Marshal(columns.rects)
	if err != nil {
		return BookHighlight{}, fmt.Errorf("encode highlight rects: %w", err)
	}
	timestamp := now.UTC().Format(time.RFC3339Nano)
	var id int64
	err = store.inTx(ctx, func(queries *librarydb.Queries) error {
		affected, err := queries.UpdateBookPageCount(ctx, librarydb.UpdateBookPageCountParams{
			PageCount: int64(input.PageCount),
			UpdatedAt: timestamp,
			ID:        bookID,
		})
		if err := requireChanged(affected, err, "update book page count"); err != nil {
			return err
		}
		id, err = queries.InsertHighlight(ctx, librarydb.InsertHighlightParams{
			BookID:     bookID,
			PageNumber: int64(columns.pageNumber),
			Color:      input.Color,
			Text:       text,
			Rects:      string(rects),
			Cfi:        columns.cfi,
			CreatedAt:  timestamp,
		})
		return err
	})
	if err != nil {
		return BookHighlight{}, fmt.Errorf("save highlight: %w", err)
	}
	location := input.Location
	if pdf, ok := location.(PDFHighlightLocation); ok {
		location = PDFHighlightLocation{Page: pdf.Page, Rects: slices.Clone(pdf.Rects)}
	}
	return BookHighlight{
		ID:        id,
		Color:     input.Color,
		Text:      text,
		Location:  location,
		CreatedAt: timestamp,
	}, nil
}

func (store *Store) ListHighlights(ctx context.Context, bookID string) ([]BookHighlight, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" {
		return nil, ErrInvalidHighlight
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return nil, err
	}
	rows, err := store.queries.ListHighlights(ctx, bookID)
	if err != nil {
		return nil, fmt.Errorf("list highlights: %w", err)
	}
	highlights := make([]BookHighlight, len(rows))
	for i, row := range rows {
		highlight, err := highlightFromRow(librarydb.GetHighlightRow(row))
		if err != nil {
			return nil, err
		}
		highlights[i] = highlight
	}
	return highlights, nil
}

func (store *Store) UpdateHighlightColor(ctx context.Context, bookID string, id int64, color string) (BookHighlight, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || id < 1 || !slices.Contains(HighlightColors, color) {
		return BookHighlight{}, ErrInvalidHighlight
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return BookHighlight{}, err
	}
	affected, err := store.queries.UpdateHighlightColor(ctx, librarydb.UpdateHighlightColorParams{
		Color:  color,
		BookID: bookID,
		ID:     id,
	})
	if err != nil {
		return BookHighlight{}, fmt.Errorf("update highlight color: %w", err)
	}
	if affected == 0 {
		return BookHighlight{}, ErrHighlightNotFound
	}
	row, err := store.queries.GetHighlight(ctx, librarydb.GetHighlightParams{BookID: bookID, ID: id})
	if err != nil {
		return BookHighlight{}, fmt.Errorf("read updated highlight: %w", err)
	}
	return highlightFromRow(row)
}

func highlightFromRow(row librarydb.GetHighlightRow) (BookHighlight, error) {
	var location HighlightLocation = EPUBHighlightLocation{Section: int(row.PageNumber), CFI: row.Cfi}
	if row.Cfi == "" {
		var rects []HighlightRect
		if err := json.Unmarshal([]byte(row.Rects), &rects); err != nil {
			return BookHighlight{}, fmt.Errorf("decode highlight %d rects: %w", row.ID, err)
		}
		location = PDFHighlightLocation{Page: int(row.PageNumber), Rects: rects}
	}
	return BookHighlight{
		ID:        row.ID,
		Color:     row.Color,
		Text:      row.Text,
		Location:  location,
		CreatedAt: row.CreatedAt,
	}, nil
}

func (store *Store) DeleteHighlight(ctx context.Context, bookID string, id int64) error {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || id < 1 {
		return ErrInvalidHighlight
	}
	if _, err := store.Get(ctx, bookID); err != nil {
		return err
	}
	if err := store.queries.DeleteHighlight(ctx, librarydb.DeleteHighlightParams{BookID: bookID, ID: id}); err != nil {
		return fmt.Errorf("delete highlight: %w", err)
	}
	return nil
}

func validHighlight(input NewHighlight, pageNumber int, text string) bool {
	if input.PageCount < 1 || pageNumber < 1 || pageNumber > input.PageCount {
		return false
	}
	if !slices.Contains(HighlightColors, input.Color) {
		return false
	}
	return text != "" && utf8.RuneCountInString(text) <= MaxHighlightTextRunes
}

func validCFI(cfi string) bool {
	return len(cfi) <= MaxHighlightCFIBytes && utf8.ValidString(cfi) &&
		strings.HasPrefix(cfi, "epubcfi(") && strings.HasSuffix(cfi, ")")
}

func (rect HighlightRect) valid() bool {
	for _, value := range []float64{rect.X, rect.Y, rect.Width, rect.Height} {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return rect.Width > 0 && rect.Height > 0 &&
		rect.X >= -rectTolerance && rect.Y >= -rectTolerance &&
		rect.X+rect.Width <= 1+rectTolerance && rect.Y+rect.Height <= 1+rectTolerance
}
