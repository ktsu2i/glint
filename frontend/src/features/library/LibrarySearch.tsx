import { useEffect, useRef } from "react";
import { BookOpenText, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { BookSummary, LibrarySearchHit } from "../../shared/api/backend";
import { HighlightedExcerpt } from "../../shared/components/HighlightedExcerpt";

const SEARCH_QUERY_MAX_LENGTH = 200;

export type LibrarySearchStatus = "idle" | "loading" | "ready" | "error";

type LibrarySearchProps = {
  busyBookId: string;
  searchQuery: string;
  searchInput: string;
  searchResults: LibrarySearchHit[];
  searchStatus: LibrarySearchStatus;
  searchError: string;
  onSearchInputChange: (value: string) => void;
  onSearchSubmit: () => void;
  onSearchClear: () => void;
  onOpenAtPage: (book: BookSummary, pageNumber: number) => void;
};

export function LibrarySearch({
  busyBookId,
  searchQuery,
  searchInput,
  searchResults,
  searchStatus,
  searchError,
  onSearchInputChange,
  onSearchSubmit,
  onSearchClear,
  onOpenAtPage,
}: LibrarySearchProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isSearching = searchStatus === "loading";
  const hasSubmitted = searchStatus !== "idle";
  const canSubmit = searchInput.trim().length > 0 && !isSearching;
  const hasResults = searchStatus === "ready" && searchResults.length > 0;
  const canClear = Boolean(searchQuery) || searchInput.length > 0;

  return (
    <section className="library-search-view" aria-labelledby="library-search-title">
      <header className="library-search-header">
        <div>
          <p className="section-label">{t("librarySearch.section")}</p>
          <h1 id="library-search-title">{t("librarySearch.title")}</h1>
          <p>{t("librarySearch.description")}</p>
        </div>
      </header>

      <form
        className="library-search"
        role="search"
        aria-label={t("librarySearch.formAria")}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) {
            onSearchSubmit();
          }
        }}
      >
        <div className="library-search-input">
          <MagnifyingGlass size={15} weight="regular" aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            aria-label={t("librarySearch.inputAria")}
            placeholder={t("librarySearch.placeholder")}
            value={searchInput}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            onChange={(event) => onSearchInputChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && canClear) {
                event.preventDefault();
                onSearchClear();
              }
            }}
          />
          {canClear && (
            <button
              type="button"
              className="library-search-clear"
              onClick={onSearchClear}
              aria-label={t("librarySearch.clear")}
            >
              <X size={13} weight="bold" />
            </button>
          )}
        </div>
        <button type="submit" disabled={!canSubmit}>
          {isSearching ? t("librarySearch.inProgress") : t("librarySearch.action")}
        </button>
      </form>

      <div className="library-search-results" aria-live="polite">
        {!hasSubmitted && !searchError ? (
          <p className="library-search-message">{t("librarySearch.prompt")}</p>
        ) : searchError ? (
          <p className="library-search-message is-error" role="alert">{searchError}</p>
        ) : isSearching ? (
          <p className="library-search-message">
            {t("librarySearch.searchingFor", { query: searchQuery || searchInput })}
          </p>
        ) : !hasResults ? (
          <p className="library-search-message">
            {t("librarySearch.noResults", { query: searchQuery })}
          </p>
        ) : (
          <>
            <p className="library-search-count">
              {t("librarySearch.hitCount", { count: searchResults.length })}
            </p>
            <ul className="library-search-hits">
              {searchResults.map((hit) => (
                <li key={hit.book.id} className="library-search-hit">
                  <div className="library-search-hit-header">
                    <span className="library-search-hit-cover" aria-hidden="true">
                      {hit.book.coverUrl ? (
                        <img src={hit.book.coverUrl} alt="" />
                      ) : (
                        <BookOpenText size={18} weight="thin" />
                      )}
                    </span>
                    <div className="library-search-hit-meta">
                      <strong title={hit.book.title}>{hit.book.title}</strong>
                      <span>{t("librarySearch.totalMatches", { count: hit.totalMatches })}</span>
                    </div>
                  </div>
                  <ol className="library-search-hit-pages">
                    {hit.pages.map((page) => (
                      <li key={page.pageNumber}>
                        <button
                          type="button"
                          disabled={!hit.book.available || busyBookId === hit.book.id}
                          onClick={() => onOpenAtPage(hit.book, page.pageNumber)}
                          aria-label={t("librarySearch.goTo", {
                            title: hit.book.title,
                            page: page.pageNumber,
                          })}
                        >
                          <span className="library-search-hit-page-meta">
                            <strong>PAGE {String(page.pageNumber).padStart(3, "0")}</strong>
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
          </>
        )}
      </div>
    </section>
  );
}
