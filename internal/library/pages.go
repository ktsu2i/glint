package library

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	maxBookPageBatchSize       = 50
	maxBookPageTextBytes       = 4 * 1024 * 1024
	maxBookSearchRunes         = 200
	maxBookSearchTerms         = 12
	searchExcerptRunes         = 180
	defaultLibrarySearchBooks  = 30
	defaultLibrarySearchPages  = 3
	libraryMatchRowCeiling     = 5_000
)

var (
	ErrInvalidBookPageBatch   = errors.New("invalid book page batch")
	ErrInvalidBookSearchQuery = errors.New("invalid book search query")
)

// BookPage is the locally persisted text representation of a PDF page.
// Width and Height use PDF points at scale 1 and are retained for later
// location-aware chunking without making search depend on the rendered size.
type BookPage struct {
	PageNumber int
	Text       string
	Width      float64
	Height     float64
}

type BookPageSearchResult struct {
	PageNumber int
	Excerpt    string
	MatchCount int
}

// BookLibrarySearchHit groups search matches for one book so the UI can show
// per-book context (cover, title) above its top pages instead of one flat list.
type BookLibrarySearchHit struct {
	BookID       string
	TotalMatches int
	Pages        []BookPageSearchResult
}

type bookPageRecord struct {
	ID         string  `gorm:"column:id;primaryKey"`
	BookID     string  `gorm:"column:book_id;uniqueIndex:idx_book_page"`
	PageNumber int     `gorm:"column:page_number;uniqueIndex:idx_book_page"`
	Text       string  `gorm:"column:text"`
	Width      float64 `gorm:"column:width"`
	Height     float64 `gorm:"column:height"`
	UpdatedAt  string  `gorm:"column:updated_at"`
}

func (bookPageRecord) TableName() string { return "book_pages" }

// SaveBookPages upserts one sequential extraction batch and returns the total
// number of pages currently persisted for the book. Keeping the operation
// batched lets the reader remain usable while a large PDF is indexed.
func (store *Store) SaveBookPages(
	ctx context.Context,
	bookID string,
	pages []BookPage,
	pageCount int,
	now time.Time,
) (int, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || pageCount < 1 || len(pages) == 0 || len(pages) > maxBookPageBatchSize {
		return 0, ErrInvalidBookPageBatch
	}
	seen := make(map[int]struct{}, len(pages))
	timestamp := now.UTC().Format(time.RFC3339Nano)
	records := make([]bookPageRecord, 0, len(pages))
	for _, page := range pages {
		if page.PageNumber < 1 || page.PageNumber > pageCount || page.Width < 0 || page.Height < 0 || len(page.Text) > maxBookPageTextBytes {
			return 0, ErrInvalidBookPageBatch
		}
		if _, duplicate := seen[page.PageNumber]; duplicate {
			return 0, ErrInvalidBookPageBatch
		}
		seen[page.PageNumber] = struct{}{}
		records = append(records, bookPageRecord{
			ID:         bookID + ":" + strconv.Itoa(page.PageNumber),
			BookID:     bookID,
			PageNumber: page.PageNumber,
			Text:       strings.TrimSpace(page.Text),
			Width:      page.Width,
			Height:     page.Height,
			UpdatedAt:  timestamp,
		})
	}

	err := store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&bookRecord{}).Where("id = ?", bookID).Updates(map[string]any{
			"page_count": pageCount,
			"updated_at": timestamp,
		})
		if err := requireChanged(result, "update indexed book page count"); err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "book_id"}, {Name: "page_number"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"text", "width", "height", "updated_at",
			}),
		}).Create(&records).Error; err != nil {
			return fmt.Errorf("save book pages: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return store.BookPageCount(ctx, bookID)
}

func (store *Store) BookPageCount(ctx context.Context, bookID string) (int, error) {
	var count int64
	if err := store.db.WithContext(ctx).Model(&bookPageRecord{}).
		Where("book_id = ?", bookID).Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count book pages: %w", err)
	}
	return int(count), nil
}

// SearchBookPages performs a bounded, case-insensitive lexical search over one
// book. SQL narrows candidates by every term; Go then ranks phrase frequency
// and builds Unicode-safe excerpts. Substring matching keeps Japanese queries
// useful before a language-specific tokenizer is introduced.
func (store *Store) SearchBookPages(
	ctx context.Context,
	bookID, query string,
	limit int,
) ([]BookPageSearchResult, error) {
	if _, err := store.Get(ctx, bookID); err != nil {
		return nil, err
	}
	phrase, terms, err := normalizeBookSearchQuery(query)
	if err != nil {
		return nil, err
	}
	if limit < 1 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	db := store.db.WithContext(ctx).Where("book_id = ?", bookID)
	for _, term := range terms {
		db = db.Where(`text LIKE ? ESCAPE '\' COLLATE NOCASE`, "%"+escapeLikeTerm(term)+"%")
	}
	var records []bookPageRecord
	if err := db.Order("page_number ASC").Find(&records).Error; err != nil {
		return nil, fmt.Errorf("search book pages: %w", err)
	}

	ranked := rankPageMatches(records, phrase, terms)
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].PageNumber < ranked[j].PageNumber
	})
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	results := make([]BookPageSearchResult, len(ranked))
	for i := range ranked {
		results[i] = ranked[i].BookPageSearchResult
	}
	return results, nil
}

// SearchLibraryPages runs the same lexical match as SearchBookPages but across
// every imported book. Results are grouped per book so the UI can keep the
// "which book did this come from" context, then books are ordered by overall
// match strength so the most relevant book surfaces first.
func (store *Store) SearchLibraryPages(
	ctx context.Context,
	query string,
	pagesPerBook, bookLimit int,
) ([]BookLibrarySearchHit, error) {
	phrase, terms, err := normalizeBookSearchQuery(query)
	if err != nil {
		return nil, err
	}
	if pagesPerBook < 1 {
		pagesPerBook = defaultLibrarySearchPages
	}
	if pagesPerBook > 20 {
		pagesPerBook = 20
	}
	if bookLimit < 1 {
		bookLimit = defaultLibrarySearchBooks
	}
	if bookLimit > 200 {
		bookLimit = 200
	}

	db := store.db.WithContext(ctx).Model(&bookPageRecord{})
	for _, term := range terms {
		db = db.Where(`text LIKE ? ESCAPE '\' COLLATE NOCASE`, "%"+escapeLikeTerm(term)+"%")
	}
	var records []bookPageRecord
	if err := db.Order("book_id ASC, page_number ASC").
		Limit(libraryMatchRowCeiling).Find(&records).Error; err != nil {
		return nil, fmt.Errorf("search library pages: %w", err)
	}

	grouped := make(map[string][]bookPageRecord)
	bookOrder := make([]string, 0)
	for _, record := range records {
		if _, seen := grouped[record.BookID]; !seen {
			bookOrder = append(bookOrder, record.BookID)
		}
		grouped[record.BookID] = append(grouped[record.BookID], record)
	}

	type rankedHit struct {
		BookLibrarySearchHit
		score int
	}
	hits := make([]rankedHit, 0, len(bookOrder))
	for _, bookID := range bookOrder {
		ranked := rankPageMatches(grouped[bookID], phrase, terms)
		if len(ranked) == 0 {
			continue
		}
		sort.SliceStable(ranked, func(i, j int) bool {
			if ranked[i].score != ranked[j].score {
				return ranked[i].score > ranked[j].score
			}
			return ranked[i].PageNumber < ranked[j].PageNumber
		})
		bookScore := 0
		totalMatches := 0
		for _, page := range ranked {
			bookScore += page.score
			totalMatches += page.MatchCount
		}
		if len(ranked) > pagesPerBook {
			ranked = ranked[:pagesPerBook]
		}
		pages := make([]BookPageSearchResult, len(ranked))
		for i := range ranked {
			pages[i] = ranked[i].BookPageSearchResult
		}
		hits = append(hits, rankedHit{
			BookLibrarySearchHit: BookLibrarySearchHit{
				BookID:       bookID,
				TotalMatches: totalMatches,
				Pages:        pages,
			},
			score: bookScore,
		})
	}
	sort.SliceStable(hits, func(i, j int) bool {
		if hits[i].score != hits[j].score {
			return hits[i].score > hits[j].score
		}
		if hits[i].TotalMatches != hits[j].TotalMatches {
			return hits[i].TotalMatches > hits[j].TotalMatches
		}
		return hits[i].BookID < hits[j].BookID
	})
	if len(hits) > bookLimit {
		hits = hits[:bookLimit]
	}
	results := make([]BookLibrarySearchHit, len(hits))
	for i := range hits {
		results[i] = hits[i].BookLibrarySearchHit
	}
	return results, nil
}

type rankedPageResult struct {
	BookPageSearchResult
	score int
}

func rankPageMatches(records []bookPageRecord, phrase string, terms []string) []rankedPageResult {
	ranked := make([]rankedPageResult, 0, len(records))
	for _, record := range records {
		compact := strings.Join(strings.Fields(record.Text), " ")
		folded := strings.ToLower(compact)
		firstMatch := -1
		matchCount := 0
		allTermsMatch := true
		for _, term := range terms {
			index := strings.Index(folded, term)
			if index < 0 {
				allTermsMatch = false
				break
			}
			if firstMatch < 0 || index < firstMatch {
				firstMatch = index
			}
			matchCount += strings.Count(folded, term)
		}
		if !allTermsMatch {
			continue
		}
		phraseMatches := strings.Count(folded, phrase)
		score := matchCount + phraseMatches*4
		if phraseMatches > 0 {
			firstMatch = strings.Index(folded, phrase)
		}
		ranked = append(ranked, rankedPageResult{
			BookPageSearchResult: BookPageSearchResult{
				PageNumber: record.PageNumber,
				Excerpt:    searchExcerpt(compact, firstMatch),
				MatchCount: matchCount,
			},
			score: score,
		})
	}
	return ranked
}

func normalizeBookSearchQuery(query string) (string, []string, error) {
	phrase := strings.ToLower(strings.Join(strings.Fields(query), " "))
	if phrase == "" || utf8.RuneCountInString(phrase) > maxBookSearchRunes {
		return "", nil, ErrInvalidBookSearchQuery
	}
	terms := strings.Fields(phrase)
	if len(terms) > maxBookSearchTerms {
		return "", nil, ErrInvalidBookSearchQuery
	}
	return phrase, terms, nil
}

func escapeLikeTerm(term string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(term)
}

func searchExcerpt(text string, matchByteIndex int) string {
	characters := []rune(text)
	if len(characters) <= searchExcerptRunes {
		return text
	}
	matchRuneIndex := 0
	if matchByteIndex > 0 && matchByteIndex <= len(text) {
		matchRuneIndex = utf8.RuneCountInString(text[:matchByteIndex])
	}
	start := matchRuneIndex - 55
	if start < 0 {
		start = 0
	}
	end := start + searchExcerptRunes
	if end > len(characters) {
		end = len(characters)
		start = max(0, end-searchExcerptRunes)
	}
	excerpt := string(characters[start:end])
	if start > 0 {
		excerpt = "…" + excerpt
	}
	if end < len(characters) {
		excerpt += "…"
	}
	return excerpt
}
