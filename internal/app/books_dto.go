package app

import "github.com/ktsu2i/glint/internal/library"

type BookFile struct {
	ID               string      `json:"id"`
	Title            string      `json:"title"`
	Name             string      `json:"name"`
	URL              string      `json:"url"`
	Format           string      `json:"format"`
	Size             int64       `json:"size"`
	InitialPage      int         `json:"initialPage"`
	InitialCFI       string      `json:"initialCfi"`
	BindingDirection string      `json:"bindingDirection"`
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

type PDFBookmarkLocation struct {
	Page int `json:"page"`
}

type EPUBBookmarkLocation struct {
	Section  int     `json:"section"`
	CFI      string  `json:"cfi"`
	Progress float64 `json:"progress"`
}

type BookmarkLocation struct {
	PDF  *PDFBookmarkLocation  `json:"pdf,omitempty"`
	EPUB *EPUBBookmarkLocation `json:"epub,omitempty"`
}

type BookBookmark struct {
	Location  BookmarkLocation `json:"location"`
	CreatedAt string           `json:"createdAt"`
}

type BookmarkInput struct {
	Location  BookmarkLocation `json:"location"`
	PageCount int              `json:"pageCount"`
}

type HighlightRect struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
}

type PDFHighlightLocation struct {
	Page  int             `json:"page"`
	Rects []HighlightRect `json:"rects"`
}

type EPUBHighlightLocation struct {
	Section int    `json:"section"`
	CFI     string `json:"cfi"`
}

type HighlightLocation struct {
	PDF  *PDFHighlightLocation  `json:"pdf,omitempty"`
	EPUB *EPUBHighlightLocation `json:"epub,omitempty"`
}

type BookHighlight struct {
	ID        int64             `json:"id"`
	Color     string            `json:"color"`
	Text      string            `json:"text"`
	Location  HighlightLocation `json:"location"`
	CreatedAt string            `json:"createdAt"`
}

type HighlightInput struct {
	Location  HighlightLocation `json:"location"`
	PageCount int               `json:"pageCount"`
	Color     string            `json:"color"`
	Text      string            `json:"text"`
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

func toBookmarkLocation(location library.BookmarkLocation) BookmarkLocation {
	switch location := location.(type) {
	case library.PDFBookmarkLocation:
		return BookmarkLocation{PDF: &PDFBookmarkLocation{Page: location.Page}}
	case library.EPUBBookmarkLocation:
		epub := EPUBBookmarkLocation(location)
		return BookmarkLocation{EPUB: &epub}
	default:
		return BookmarkLocation{}
	}
}

func (location BookmarkLocation) toLibrary() library.BookmarkLocation {
	switch {
	case location.PDF != nil && location.EPUB == nil:
		return library.PDFBookmarkLocation{Page: location.PDF.Page}
	case location.EPUB != nil && location.PDF == nil:
		return library.EPUBBookmarkLocation(*location.EPUB)
	default:
		return nil
	}
}

func toBookBookmark(bookmark library.BookBookmark) BookBookmark {
	return BookBookmark{
		Location:  toBookmarkLocation(bookmark.Location),
		CreatedAt: bookmark.CreatedAt,
	}
}

func (input BookmarkInput) toNewBookmark() library.NewBookmark {
	return library.NewBookmark{Location: input.Location.toLibrary(), PageCount: input.PageCount}
}

func toHighlightLocation(location library.HighlightLocation) HighlightLocation {
	switch location := location.(type) {
	case library.PDFHighlightLocation:
		rects := make([]HighlightRect, len(location.Rects))
		for i, rect := range location.Rects {
			rects[i] = HighlightRect(rect)
		}
		return HighlightLocation{PDF: &PDFHighlightLocation{Page: location.Page, Rects: rects}}
	case library.EPUBHighlightLocation:
		epub := EPUBHighlightLocation(location)
		return HighlightLocation{EPUB: &epub}
	default:
		return HighlightLocation{}
	}
}

func (location HighlightLocation) toLibrary() library.HighlightLocation {
	switch {
	case location.PDF != nil && location.EPUB == nil:
		rects := make([]library.HighlightRect, len(location.PDF.Rects))
		for i, rect := range location.PDF.Rects {
			rects[i] = library.HighlightRect(rect)
		}
		return library.PDFHighlightLocation{Page: location.PDF.Page, Rects: rects}
	case location.EPUB != nil && location.PDF == nil:
		return library.EPUBHighlightLocation(*location.EPUB)
	default:
		return nil
	}
}

func toBookHighlight(highlight library.BookHighlight) BookHighlight {
	return BookHighlight{
		ID:        highlight.ID,
		Color:     highlight.Color,
		Text:      highlight.Text,
		Location:  toHighlightLocation(highlight.Location),
		CreatedAt: highlight.CreatedAt,
	}
}

func (input HighlightInput) toNewHighlight() library.NewHighlight {
	return library.NewHighlight{
		Location:  input.Location.toLibrary(),
		PageCount: input.PageCount,
		Color:     input.Color,
		Text:      input.Text,
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
