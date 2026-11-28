import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Library } from "./Library";
import { LibrarySearchField, LibrarySearchResults } from "./LibrarySearch";
import { LibraryTopBar } from "./LibraryTopBar";
import { sortBooks, type useLibrarySortOrder } from "./librarySort";
import type { LibraryActions } from "./useLibraryActions";
import type { LibraryBooks } from "./useLibraryBooks";
import type { LibrarySearch } from "./useLibrarySearch";
import "./library.css";

type LibraryScreenProps = {
  /** Whether the top bar shows the shelf or the search across every book. */
  mode: "shelf" | "search";
  library: LibraryBooks;
  search: LibrarySearch;
  actions: LibraryActions;
  sort: ReturnType<typeof useLibrarySortOrder>;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
};

export function LibraryScreen({
  mode,
  library,
  search,
  actions,
  sort: [sortOrder, setSortOrder],
  onOpenSearch,
  onCloseSearch,
}: LibraryScreenProps) {
  const { t, i18n } = useTranslation();
  const shelfBooks = useMemo(
    () => sortBooks(library.books, sortOrder, i18n.language),
    [library.books, sortOrder, i18n.language],
  );
  // Opening the search again remounts the field, which focuses it.
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);

  const openSearch = () => {
    onOpenSearch();
    setSearchFocusSignal((current) => current + 1);
  };

  useEffect(() => {
    function openLibrarySearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        onOpenSearch();
        setSearchFocusSignal((current) => current + 1);
      }
    }
    window.addEventListener("keydown", openLibrarySearch);
    return () => window.removeEventListener("keydown", openLibrarySearch);
  }, [onOpenSearch]);

  // Escape closes the library search wherever the focus is, not only in the field.
  useEffect(() => {
    if (mode !== "search") {
      return;
    }
    function closeLibrarySearch(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
        return;
      }
      event.preventDefault();
      onCloseSearch();
    }
    window.addEventListener("keydown", closeLibrarySearch);
    return () => window.removeEventListener("keydown", closeLibrarySearch);
  }, [mode, onCloseSearch]);

  return (
    <div className="library-screen ambient">
      <LibraryTopBar
        title={t("app.library")}
        opening={actions.opening}
        search={
          mode === "search" ? (
            <LibrarySearchField
              key={searchFocusSignal}
              searchInput={search.input}
              searchStatus={search.status}
              resultCount={search.results.length}
              onSearchInputChange={search.changeInput}
              onSearchSubmit={search.submit}
              onClose={onCloseSearch}
            />
          ) : null
        }
        sortOrder={sortOrder}
        onImport={() => void actions.importBook()}
        onSearch={openSearch}
        onSortOrderChange={setSortOrder}
      />
      <div className="library-content">
        {mode === "search" ? (
          <LibrarySearchResults
            books={library.books}
            busyBookId={actions.busyBookId}
            searchQuery={search.query}
            searchInput={search.input}
            searchResults={search.results}
            searchStatus={search.status}
            searchError={search.error}
            onOpenAtPage={actions.openBookAtPage}
            onOpenBook={actions.openBook}
            onRelinkBook={actions.relinkBook}
          />
        ) : (
          <Library
            books={shelfBooks}
            loading={library.loading}
            error={library.error}
            busyBookId={actions.busyBookId}
            opening={actions.opening}
            onImport={actions.importBook}
            onOpen={actions.openBook}
            onRelink={actions.relinkBook}
            onRemove={actions.removeBook}
            onRename={actions.renameBook}
          />
        )}
      </div>
    </div>
  );
}
