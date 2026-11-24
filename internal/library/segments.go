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
	maxSegmentBatchSize       = 50
	maxSegmentTextBytes       = 4 * 1024 * 1024
	maxSegmentLocationBytes   = 1024
	maxSegmentHeadingBytes    = 4 * 1024
	maxBookSearchRunes        = 200
	maxBookSearchTerms        = 12
	searchExcerptRunes        = 180
	defaultLibrarySearchBooks = 30
	defaultLibrarySearchPages = 3
	libraryMatchRowCeiling    = 5_000
)

const (
	SegmentKindPage    = "page"
	SegmentKindSection = "section"
)

var (
	ErrInvalidSegmentBatch    = errors.New("invalid book segment batch")
	ErrInvalidBookSearchQuery = errors.New("invalid book search query")
)

type BookSegment struct {
	Ordinal     int
	Kind        string
	Location    string
	HeadingPath string
	Text        string
}

func PageLocation(pageNumber int) string {
	return "page:" + strconv.Itoa(pageNumber)
}

func SpineLocation(index int) string {
	return "spine:" + strconv.Itoa(index)
}

type SegmentSearchResult struct {
	Ordinal     int
	Location    string
	HeadingPath string
	Excerpt     string
	MatchCount  int
}

type LibrarySearchHit struct {
	BookID       string
	TotalMatches int
	Segments     []SegmentSearchResult
}

type bookSegmentRecord struct {
	ID          int64  `gorm:"column:id;primaryKey;autoIncrement"`
	BookID      string `gorm:"column:book_id"`
	Ordinal     int    `gorm:"column:ordinal"`
	Kind        string `gorm:"column:kind"`
	Location    string `gorm:"column:location"`
	HeadingPath string `gorm:"column:heading_path"`
	Text        string `gorm:"column:text"`
	UpdatedAt   string `gorm:"column:updated_at"`
}

func (bookSegmentRecord) TableName() string { return "book_segments" }

func (store *Store) SaveBookSegments(
	ctx context.Context,
	bookID string,
	segments []BookSegment,
	total int,
	now time.Time,
) (int, error) {
	bookID = strings.TrimSpace(bookID)
	if bookID == "" || total < 1 || len(segments) == 0 || len(segments) > maxSegmentBatchSize {
		return 0, ErrInvalidSegmentBatch
	}
	seen := make(map[int]struct{}, len(segments))
	timestamp := now.UTC().Format(time.RFC3339Nano)
	records := make([]bookSegmentRecord, 0, len(segments))
	for _, segment := range segments {
		if !validSegment(segment, total) {
			return 0, ErrInvalidSegmentBatch
		}
		if _, duplicate := seen[segment.Ordinal]; duplicate {
			return 0, ErrInvalidSegmentBatch
		}
		seen[segment.Ordinal] = struct{}{}
		records = append(records, bookSegmentRecord{
			BookID:      bookID,
			Ordinal:     segment.Ordinal,
			Kind:        segment.Kind,
			Location:    segment.Location,
			HeadingPath: strings.TrimSpace(segment.HeadingPath),
			Text:        strings.TrimSpace(segment.Text),
			UpdatedAt:   timestamp,
		})
	}

	err := store.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&bookRecord{}).Where("id = ?", bookID).Updates(map[string]any{
			"page_count": total,
			"updated_at": timestamp,
		})
		if err := requireChanged(result, "update indexed book segment count"); err != nil {
			return err
		}
		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "book_id"}, {Name: "ordinal"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"kind", "location", "heading_path", "text", "updated_at",
			}),
		}).Create(&records).Error; err != nil {
			return fmt.Errorf("save book segments: %w", err)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return store.BookSegmentCount(ctx, bookID)
}

func validSegment(segment BookSegment, total int) bool {
	if segment.Ordinal < 1 || segment.Ordinal > total {
		return false
	}
	if segment.Kind != SegmentKindPage && segment.Kind != SegmentKindSection {
		return false
	}
	if segment.Location == "" || len(segment.Location) > maxSegmentLocationBytes {
		return false
	}
	return len(segment.HeadingPath) <= maxSegmentHeadingBytes && len(segment.Text) <= maxSegmentTextBytes
}

func (store *Store) BookSegmentCount(ctx context.Context, bookID string) (int, error) {
	var count int64
	if err := store.db.WithContext(ctx).Model(&bookSegmentRecord{}).
		Where("book_id = ?", bookID).Count(&count).Error; err != nil {
		return 0, fmt.Errorf("count book segments: %w", err)
	}
	return int(count), nil
}

func (store *Store) SearchBookSegments(
	ctx context.Context,
	bookID, query string,
	limit int,
) ([]SegmentSearchResult, error) {
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

	records, err := store.matchingSegments(ctx, bookID, terms, 0)
	if err != nil {
		return nil, fmt.Errorf("search book segments: %w", err)
	}

	ranked := rankSegmentMatches(records, phrase, terms)
	sort.SliceStable(ranked, func(i, j int) bool {
		if ranked[i].score != ranked[j].score {
			return ranked[i].score > ranked[j].score
		}
		return ranked[i].Ordinal < ranked[j].Ordinal
	})
	if len(ranked) > limit {
		ranked = ranked[:limit]
	}
	results := make([]SegmentSearchResult, len(ranked))
	for i := range ranked {
		results[i] = ranked[i].SegmentSearchResult
	}
	return results, nil
}

func (store *Store) SearchLibrarySegments(
	ctx context.Context,
	query string,
	segmentsPerBook, bookLimit int,
) ([]LibrarySearchHit, error) {
	phrase, terms, err := normalizeBookSearchQuery(query)
	if err != nil {
		return nil, err
	}
	if segmentsPerBook < 1 {
		segmentsPerBook = defaultLibrarySearchPages
	}
	if segmentsPerBook > 20 {
		segmentsPerBook = 20
	}
	if bookLimit < 1 {
		bookLimit = defaultLibrarySearchBooks
	}
	if bookLimit > 200 {
		bookLimit = 200
	}

	records, err := store.matchingSegments(ctx, "", terms, libraryMatchRowCeiling)
	if err != nil {
		return nil, fmt.Errorf("search library segments: %w", err)
	}

	grouped := make(map[string][]bookSegmentRecord)
	bookOrder := make([]string, 0)
	for _, record := range records {
		if _, seen := grouped[record.BookID]; !seen {
			bookOrder = append(bookOrder, record.BookID)
		}
		grouped[record.BookID] = append(grouped[record.BookID], record)
	}

	type rankedHit struct {
		LibrarySearchHit
		score int
	}
	hits := make([]rankedHit, 0, len(bookOrder))
	for _, bookID := range bookOrder {
		ranked := rankSegmentMatches(grouped[bookID], phrase, terms)
		if len(ranked) == 0 {
			continue
		}
		sort.SliceStable(ranked, func(i, j int) bool {
			if ranked[i].score != ranked[j].score {
				return ranked[i].score > ranked[j].score
			}
			return ranked[i].Ordinal < ranked[j].Ordinal
		})
		bookScore := 0
		totalMatches := 0
		for _, segment := range ranked {
			bookScore += segment.score
			totalMatches += segment.MatchCount
		}
		if len(ranked) > segmentsPerBook {
			ranked = ranked[:segmentsPerBook]
		}
		segments := make([]SegmentSearchResult, len(ranked))
		for i := range ranked {
			segments[i] = ranked[i].SegmentSearchResult
		}
		hits = append(hits, rankedHit{
			BookID:       bookID,
			TotalMatches: totalMatches,
			Segments:     segments,
			score:        bookScore,
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
	results := make([]LibrarySearchHit, len(hits))
	for i := range hits {
		results[i] = hits[i].LibrarySearchHit
	}
	return results, nil
}

func (store *Store) matchingSegments(ctx context.Context, bookID string, terms []string, limit int) ([]bookSegmentRecord, error) {
	var query strings.Builder
	var args []any
	match := ftsMatchExpression(terms)
	if match != "" {
		query.WriteString(`SELECT ` + segmentSearchColumns + `
          FROM book_segments_fts
          JOIN book_segments s ON s.id = book_segments_fts.rowid
         WHERE book_segments_fts MATCH ?`)
		args = append(args, match)
	} else {
		query.WriteString(`SELECT ` + segmentSearchColumns + `
          FROM book_segments s
         WHERE 1 = 1`)
	}
	if bookID != "" {
		query.WriteString(" AND s.book_id = ?")
		args = append(args, bookID)
	}
	for _, term := range terms {
		if utf8.RuneCountInString(term) >= trigramLength {
			continue
		}
		query.WriteString(` AND s.text LIKE ? ESCAPE '\' COLLATE NOCASE`)
		args = append(args, "%"+escapeLikeTerm(term)+"%")
	}
	if match != "" {
		query.WriteString(" ORDER BY bm25(book_segments_fts), s.book_id, s.ordinal")
	} else {
		query.WriteString(" ORDER BY s.book_id, s.ordinal")
	}
	if limit > 0 {
		query.WriteString(" LIMIT ?")
		args = append(args, limit)
	}
	var records []bookSegmentRecord
	if err := store.db.WithContext(ctx).Raw(query.String(), args...).Scan(&records).Error; err != nil {
		return nil, err
	}
	return records, nil
}

const trigramLength = 3

const segmentSearchColumns = "s.book_id, s.ordinal, s.location, s.heading_path, s.text"

func ftsMatchExpression(terms []string) string {
	quoted := make([]string, 0, len(terms))
	for _, term := range terms {
		if utf8.RuneCountInString(term) < trigramLength {
			continue
		}
		quoted = append(quoted, `"`+strings.ReplaceAll(term, `"`, `""`)+`"`)
	}
	return strings.Join(quoted, " AND ")
}

type rankedSegmentResult struct {
	SegmentSearchResult
	score int
}

func rankSegmentMatches(records []bookSegmentRecord, phrase string, terms []string) []rankedSegmentResult {
	ranked := make([]rankedSegmentResult, 0, len(records))
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
		ranked = append(ranked, rankedSegmentResult{
			Ordinal:     record.Ordinal,
			Location:    record.Location,
			HeadingPath: record.HeadingPath,
			Excerpt:     searchExcerpt(compact, firstMatch),
			MatchCount:  matchCount,
			score:       score,
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
	start := max(matchRuneIndex-55, 0)
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
