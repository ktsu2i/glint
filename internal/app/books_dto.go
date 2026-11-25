package app

import "github.com/kaito/glint/internal/library"

type BookFile struct {
	ID               string      `json:"id"`
	Title            string      `json:"title"`
	Name             string      `json:"name"`
	URL              string      `json:"url"`
	Format           string      `json:"format"`
	Size             int64       `json:"size"`
	InitialPage      int         `json:"initialPage"`
	IndexedPageCount int         `json:"indexedPageCount"`
	NextSegment      int         `json:"nextSegment"`
	CoverStatus      string      `json:"coverStatus"`
	SpineItems       []SpineItem `json:"spineItems,omitempty"`
}

type SpineItem struct {
	Index     int    `json:"index"`
	ID        string `json:"id"`
	Href      string `json:"href"`
	MediaType string `json:"mediaType"`
	Title     string `json:"title"`
}

type BookSegmentInput struct {
	Ordinal     int    `json:"ordinal"`
	Location    string `json:"location"`
	HeadingPath string `json:"headingPath"`
	Text        string `json:"text"`
}

type IndexTarget struct {
	ID          string `json:"id"`
	URL         string `json:"url"`
	NextSegment int    `json:"nextSegment"`
	Total       int    `json:"total"`
}

type BookSearchResult struct {
	PageNumber  int    `json:"pageNumber"`
	Location    string `json:"location"`
	HeadingPath string `json:"headingPath"`
	Excerpt     string `json:"excerpt"`
	MatchCount  int    `json:"matchCount"`
}

type BookBookmark struct {
	PageNumber int    `json:"pageNumber"`
	CreatedAt  string `json:"createdAt"`
}

type HighlightRect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type BookHighlight struct {
	ID         int64           `json:"id"`
	PageNumber int             `json:"pageNumber"`
	Color      string          `json:"color"`
	Text       string          `json:"text"`
	Rects      []HighlightRect `json:"rects"`
	CFI        string          `json:"cfi"`
	CreatedAt  string          `json:"createdAt"`
}

type HighlightInput struct {
	PageNumber int             `json:"pageNumber"`
	PageCount  int             `json:"pageCount"`
	Color      string          `json:"color"`
	Text       string          `json:"text"`
	Rects      []HighlightRect `json:"rects"`
	CFI        string          `json:"cfi"`
}

type BookSummary struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	FileName    string `json:"fileName"`
	Format      string `json:"format"`
	Size        int64  `json:"size"`
	PageCount   int    `json:"pageCount"`
	LastPage    int    `json:"lastPage"`
	ImportedAt  string `json:"importedAt"`
	LastOpened  string `json:"lastOpenedAt"`
	CoverURL    string `json:"coverUrl"`
	CoverStatus string `json:"coverStatus"`
	Available   bool   `json:"available"`
}

type LibrarySearchHit struct {
	Book         BookSummary        `json:"book"`
	TotalMatches int                `json:"totalMatches"`
	Pages        []BookSearchResult `json:"pages"`
}

func toBookBookmark(bookmark library.BookBookmark) BookBookmark {
	return BookBookmark{PageNumber: bookmark.PageNumber, CreatedAt: bookmark.CreatedAt}
}

func toBookHighlight(highlight library.BookHighlight) BookHighlight {
	rects := make([]HighlightRect, len(highlight.Rects))
	for i, rect := range highlight.Rects {
		rects[i] = HighlightRect(rect)
	}
	return BookHighlight{
		ID:         highlight.ID,
		PageNumber: highlight.PageNumber,
		Color:      highlight.Color,
		Text:       highlight.Text,
		Rects:      rects,
		CFI:        highlight.CFI,
		CreatedAt:  highlight.CreatedAt,
	}
}

func (input HighlightInput) toNewHighlight() library.NewHighlight {
	rects := make([]library.HighlightRect, len(input.Rects))
	for i, rect := range input.Rects {
		rects[i] = library.HighlightRect(rect)
	}
	return library.NewHighlight{
		PageNumber: input.PageNumber,
		PageCount:  input.PageCount,
		Color:      input.Color,
		Text:       input.Text,
		Rects:      rects,
		CFI:        input.CFI,
	}
}

func toBookSearchResults(results []library.SegmentSearchResult) []BookSearchResult {
	output := make([]BookSearchResult, len(results))
	for i, result := range results {
		output[i] = BookSearchResult{
			PageNumber:  result.Ordinal,
			Location:    result.Location,
			HeadingPath: result.HeadingPath,
			Excerpt:     result.Excerpt,
			MatchCount:  result.MatchCount,
		}
	}
	return output
}
