package library

import (
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/stretchr/testify/require"
	"pgregory.net/rapid"
)

// searchRunes mixes the characters search has to treat with care: FTS5 query syntax, LIKE
// wildcards and their escape, ASCII and non-ASCII case pairs, full-width forms, and Japanese.
var searchRunes = []rune(`aAbBzZ09 "'*:^()-+%_\éÉäÄßσΣςжЖかカ漢ＡＢ１`)

func searchTextGen() *rapid.Generator[string] {
	return rapid.StringOfN(rapid.SampledFrom(searchRunes), 1, 60, -1)
}

func openPropertyStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(filepath.Join(t.TempDir(), "library.sqlite3"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestPropertySearchFindsEverySubstringOfAPage(t *testing.T) {
	store := openPropertyStore(t)
	now := time.Now()
	books := 0

	rapid.Check(t, func(t *rapid.T) {
		texts := rapid.SliceOfN(searchTextGen(), 1, 4).Draw(t, "texts")
		target := rapid.IntRange(0, len(texts)-1).Draw(t, "target")
		pageText := []rune(normalizeSearchText(texts[target]))
		if len(pageText) == 0 {
			t.Skip("page text is only whitespace")
		}
		start := rapid.IntRange(0, len(pageText)-1).Draw(t, "start")
		end := rapid.IntRange(start+1, min(len(pageText), start+12)).Draw(t, "end")
		query := string(pageText[start:end])
		if strings.TrimSpace(query) == "" {
			t.Skip("query is only whitespace")
		}

		books++
		bookID := "book-" + strconv.Itoa(books)
		_, err := store.Import(t.Context(), bookID, "/tmp/"+bookID+".pdf", bookID, "pdf", int64(len(texts)), now)
		require.NoError(t, err)
		segments := make([]BookSegment, len(texts))
		for i, text := range texts {
			segments[i] = pageSegment(i+1, text)
		}
		_, err = store.SaveBookSegments(t.Context(), bookID, segments, len(texts), now)
		require.NoError(t, err)

		results, err := store.SearchBookSegments(t.Context(), bookID, query, 100)
		require.NoError(t, err)
		_, terms, err := normalizeBookSearchQuery(query)
		require.NoError(t, err)
		found := false
		for _, result := range results {
			found = found || result.Ordinal == target+1
			folded := foldCase(normalizeSearchText(texts[result.Ordinal-1]))
			for _, term := range terms {
				require.Contains(t, folded, term, "page %d does not contain every term", result.Ordinal)
			}
		}
		require.True(t, found, "page %d contains %q but was not found", target+1, query)
	})
}

func TestPropertySearchAcceptsAnyQuery(t *testing.T) {
	store := openPropertyStore(t)
	now := time.Now()
	_, err := store.Import(t.Context(), "book-1", "/tmp/Guide.pdf", "hash-1", "pdf", 1, now)
	require.NoError(t, err)
	_, err = store.SaveBookSegments(t.Context(), "book-1", []BookSegment{pageSegment(1, `a "quoted" 100% _match_ \ かな`)}, 1, now)
	require.NoError(t, err)

	rapid.Check(t, func(t *rapid.T) {
		query := rapid.OneOf(searchTextGen(), rapid.String()).Draw(t, "query")
		_, err := store.SearchBookSegments(t.Context(), "book-1", query, 20)
		if err != nil {
			require.ErrorIs(t, err, ErrInvalidBookSearchQuery)
		}
		_, err = store.SearchLibrarySegments(t.Context(), query, 3, 10)
		if err != nil {
			require.ErrorIs(t, err, ErrInvalidBookSearchQuery)
		}
	})
}

func TestPropertyEscapedLikeTermMatchesLiterally(t *testing.T) {
	store := openPropertyStore(t)
	ascii := rapid.SampledFrom([]rune(`aAbB%_\ x`))

	rapid.Check(t, func(t *rapid.T) {
		text := rapid.StringOf(ascii).Draw(t, "text")
		term := rapid.StringOfN(ascii, 1, 4, -1).Draw(t, "term")
		var matched bool
		err := store.db.QueryRowContext(t.Context(), `SELECT ? LIKE ? ESCAPE '\'`,
			text, "%"+escapeLikeTerm(term)+"%").Scan(&matched)
		require.NoError(t, err)
		// LIKE folds ASCII case only, which is all this alphabet has.
		require.Equal(t, strings.Contains(strings.ToLower(text), strings.ToLower(term)), matched)
	})
}

func TestPropertyCaseVariantsFoldToTheTerm(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		term := rapid.StringOfN(rapid.SampledFrom(searchRunes), 1, 4, -1).Draw(t, "term")
		folded := foldCase(term)
		require.Equal(t, folded, foldCase(folded), "folding is idempotent")
		variants := caseVariants(term)
		require.Contains(t, variants, term)
		for _, variant := range variants {
			require.Equal(t, folded, foldCase(variant))
		}
	})
}

func TestPropertyNormalizedQueryIsStable(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		query := rapid.OneOf(searchTextGen(), rapid.String()).Draw(t, "query")
		phrase, terms, err := normalizeBookSearchQuery(query)
		if err != nil {
			require.ErrorIs(t, err, ErrInvalidBookSearchQuery)
			return
		}
		again, againTerms, err := normalizeBookSearchQuery(phrase)
		require.NoError(t, err)
		require.Equal(t, phrase, again)
		require.Equal(t, terms, againTerms)
		require.Equal(t, phrase, strings.Join(terms, " "))
	})
}

func TestPropertySearchExcerptKeepsTheMatch(t *testing.T) {
	rapid.Check(t, func(t *rapid.T) {
		text := []rune(rapid.StringOfN(rapid.SampledFrom(searchRunes), 0, 600, -1).Draw(t, "text"))
		if len(text) == 0 {
			require.Empty(t, searchExcerpt("", 0))
			return
		}
		match := rapid.IntRange(0, len(text)-1).Draw(t, "match")
		matchByte := len(string(text[:match]))

		excerpt := searchExcerpt(string(text), matchByte)
		if len(text) <= searchExcerptRunes {
			require.Equal(t, string(text), excerpt)
			return
		}
		body := strings.TrimSuffix(strings.TrimPrefix(excerpt, "…"), "…")
		require.Equal(t, searchExcerptRunes, utf8.RuneCountInString(body))
		require.Contains(t, string(text), body)
		require.Contains(t, body, string(text[match:min(len(text), match+100)]))
	})
}
