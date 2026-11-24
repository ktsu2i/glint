import { useEffect, useRef } from "react";
import { BookOpenTextIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { BookSummary, LibrarySearchHit } from "../../shared/api/backend";
import { HighlightedExcerpt } from "../../shared/components/HighlightedExcerpt";

const SEARCH_QUERY_MAX_LENGTH = 200;

export type LibrarySearchStatus = "idle" | "loading" | "ready" | "error";

type LibrarySearchFieldProps = {
  searchInput: string;
  searchStatus: LibrarySearchStatus;
  resultCount: number;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => Promise<void>;
  onClose: () => void;
};

// LibrarySearchField turns the library top bar into the search box.
export function LibrarySearchField({
  searchInput,
  searchStatus,
  resultCount,
  onSearchInputChange,
  onSearchSubmit,
  onClose,
}: LibrarySearchFieldProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const isSearching = searchStatus === "loading";
  const canSubmit = searchInput.trim().length > 0 && !isSearching;
  const summary = isSearching
    ? t("librarySearch.inProgress")
    : searchStatus === "ready" && resultCount > 0
      ? t("librarySearch.hitCount", { count: resultCount })
      : "";

  return (
    <form
      className="library-search-field"
      role="search"
      aria-label={t("librarySearch.formAria")}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) {
          void onSearchSubmit();
        }
      }}
    >
      <MagnifyingGlassIcon size={14} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        aria-label={t("librarySearch.inputAria")}
        placeholder={t("librarySearch.placeholder")}
        value={searchInput}
        maxLength={SEARCH_QUERY_MAX_LENGTH}
        onChange={(event) => onSearchInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      {summary && (
        <span className="library-search-summary" role="status">
          {summary}
        </span>
      )}
      <button
        type="button"
        className="library-search-close"
        aria-label={t("librarySearch.close")}
        onClick={onClose}
      >
        esc
      </button>
    </form>
  );
}

type LibrarySearchResultsProps = {
  busyBookId: string;
  searchQuery: string;
  searchInput: string;
  searchResults: LibrarySearchHit[];
  searchStatus: LibrarySearchStatus;
  searchError: string;
  onOpenAtPage: (book: BookSummary, pageNumber: number) => Promise<void>;
};

// LibrarySearchResults lays the hits out where the shelf usually is.
export function LibrarySearchResults({
  busyBookId,
  searchQuery,
  searchInput,
  searchResults,
  searchStatus,
  searchError,
  onOpenAtPage,
}: LibrarySearchResultsProps) {
  const { t } = useTranslation();
  const isSearching = searchStatus === "loading";
  const hasSubmitted = searchStatus !== "idle";
  const hasResults = searchStatus === "ready" && searchResults.length > 0;

  return (
    <section className="library-search-view" aria-labelledby="library-search-title">
      <h2 id="library-search-title" className="visually-hidden">
        {t("librarySearch.title")}
      </h2>
      <div className="library-search-results" aria-live="polite">
        {!hasSubmitted && !searchError ? (
          <p className="library-search-message">{t("librarySearch.prompt")}</p>
        ) : searchError ? (
          <p className="library-search-message is-error" role="alert">
            {searchError}
          </p>
        ) : isSearching ? (
          <p className="library-search-message">
            {t("librarySearch.searchingFor", { query: searchQuery || searchInput })}
          </p>
        ) : hasResults ? (
          <ul className="library-search-hits">
            {searchResults.map((hit) => (
              <li key={hit.book.id} className="library-search-hit glass">
                <div className="library-search-hit-header">
                  <span className="library-search-hit-cover" aria-hidden="true">
                    {hit.book.coverUrl ? (
                      <img src={hit.book.coverUrl} alt="" />
                    ) : (
                      <BookOpenTextIcon size={16} weight="thin" />
                    )}
                  </span>
                  <strong title={hit.book.title}>{hit.book.title}</strong>
                  <span>{t("librarySearch.totalMatches", { count: hit.totalMatches })}</span>
                </div>
                <ol className="library-search-hit-pages">
                  {hit.pages.map((page) => (
                    <li key={page.pageNumber}>
                      <button
                        type="button"
                        disabled={!hit.book.available || busyBookId === hit.book.id}
                        onClick={() => void onOpenAtPage(hit.book, page.pageNumber)}
                        aria-label={t("librarySearch.goTo", {
                          title: hit.book.title,
                          page: page.pageNumber,
                        })}
                      >
                        <span className="library-search-hit-page-meta">
                          <strong>{t("reader.bookmarkPage", { page: page.pageNumber })}</strong>
                          <span>{t("reader.matches", { count: page.matchCount })}</span>
                        </span>
                        <span className="library-search-hit-excerpt">
                          <HighlightedExcerpt text={page.excerpt} query={searchQuery} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                {!hit.book.available && (
                  <p className="library-search-hit-missing">{t("library.missingFile")}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="library-search-message">
            {t("librarySearch.noResults", { query: searchQuery })}
          </p>
        )}
      </div>
    </section>
  );
}
