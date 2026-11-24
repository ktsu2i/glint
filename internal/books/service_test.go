package books

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/kaito/glint/internal/library"
	"github.com/kaito/glint/internal/settings"
)

func TestServiceLocalizesNativeCopyFromSavedLanguage(t *testing.T) {
	h := newHarness(t)
	manager := settings.NewManager(h.store)
	service := New(h.store, h.assets, h.dataDir, manager)

	assert.Equal(t, "Remove", service.localized("Remove", "削除"))
	_, err := manager.SaveLanguage(t.Context(), settings.SaveLanguageSettingsRequest{
		Language: settings.LanguageJapanese,
	})
	require.NoError(t, err)
	assert.Equal(t, "削除", service.localized("Remove", "削除"))
}

func TestServiceLocalizesLibraryErrors(t *testing.T) {
	h := newHarness(t)
	manager := settings.NewManager(h.store)
	service := New(h.store, h.assets, h.dataDir, manager)
	_, err := manager.SaveLanguage(t.Context(), settings.SaveLanguageSettingsRequest{
		Language: settings.LanguageJapanese,
	})
	require.NoError(t, err)

	cases := []struct {
		err  error
		want string
	}{
		{err: ErrBookFileMissing, want: "本のファイルが見つかりません。本棚からファイルを再選択してください。"},
		{err: ErrBookFormatChanged, want: "選択されたファイルの形式が本棚の記録と一致しません。"},
		{err: ErrRelinkFormatMismatch, want: "選択したファイルの形式が本棚の記録と一致しません。"},
		{err: ErrEPUBDRMProtected, want: "このEPUBはDRM保護されているため開けません。"},
		{err: ErrUnsupportedBookFormat, want: "PDF または EPUB のみ取り込めます。"},
		{err: library.ErrInvalidDisplayName, want: "本の名前は1〜200文字で入力してください。"},
		{err: library.ErrInvalidSegmentBatch, want: "本の索引データが不正です。"},
		{err: library.ErrInvalidBookSearchQuery, want: "検索語は1〜200文字で入力してください。"},
	}
	for _, tc := range cases {
		t.Run(tc.err.Error(), func(t *testing.T) {
			assert.EqualError(t, service.userError(tc.err), tc.want)
		})
	}
	assert.NoError(t, service.userError(nil))
	assert.ErrorIs(t, service.userError(library.ErrBookNotFound), library.ErrBookNotFound,
		"errors without a user-facing message pass through unchanged")
}

func TestServiceTranslatesErrorsFromLibraryCalls(t *testing.T) {
	h := newHarness(t)
	path := h.writePDF("Moved.pdf", "%PDF-1.7\nfixture")
	book, err := h.books.ImportBook(t.Context(), path)
	require.NoError(t, err)

	_, err = h.service.RenameBook(book.ID, "   ")
	assert.EqualError(t, err, "Book names must be between 1 and 200 characters.")
	_, err = h.service.SearchBook(book.ID, "   ")
	assert.EqualError(t, err, "Search terms must be between 1 and 200 characters.")
	_, err = h.service.AddBookmark(book.ID, 13, 12)
	assert.EqualError(t, err, "The bookmark page is outside this document.")

	require.NoError(t, os.Remove(path))
	_, err = h.service.OpenBook(book.ID)
	assert.EqualError(t, err, "The book could not be found. Choose the file again from the library.")
}

func TestServiceRemoveBookWithoutAppContextSkipsConfirmation(t *testing.T) {
	h := newHarness(t)
	book, err := h.books.ImportBook(t.Context(), h.writePDF("Removable.pdf", "%PDF-1.7\nfixture"))
	require.NoError(t, err)

	removed, err := h.service.RemoveBook(book.ID)
	require.NoError(t, err)
	assert.True(t, removed)
	_, err = h.service.RemoveBook(book.ID)
	assert.ErrorIs(t, err, library.ErrBookNotFound)
}
