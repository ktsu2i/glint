import type { Ref } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import type { BookSearchResult } from "../../../shared/api/books";
import { HighlightedExcerpt } from "../../../shared/components/HighlightedExcerpt";

type BookSearchPanelProps = {
  inputRef: Ref<HTMLInputElement>;
  query: string;
  onQueryChange: (query: string) => void;
  onSubmit: () => void;
  /** The query whose results are shown. */
  submittedQuery: string;
  searching: boolean;
  error: string;
  results: BookSearchResult[];
  /** How a result is named in the list and to assistive technology. */
  describeResult: (result: BookSearchResult) => { title: string; label: string; active: boolean };
  onSelectResult: (result: BookSearchResult) => void;
};

/** The search form and results inside the side sheet. */
export function BookSearchPanel({
  inputRef,
  query,
  onQueryChange,
  onSubmit,
  submittedQuery,
  searching,
  error,
  results,
  describeResult,
  onSelectResult,
}: BookSearchPanelProps) {
  const { t } = useTranslation();
  return (
    <>
      <form
        className="reader-search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="reader-search-field">
          <MagnifyingGlassIcon size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            aria-label={t("reader.openSearch")}
            placeholder={t("reader.searchPlaceholder")}
            maxLength={200}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <button type="submit" className="solid-button" disabled={!query.trim() || searching}>
          {searching ? t("reader.searchingAction") : t("reader.searchAction")}
        </button>
      </form>
      <div className="reader-sheet-scroll">
        {error ? (
          <p className="reader-sheet-message is-error" role="alert">
            {error}
          </p>
        ) : submittedQuery ? (
          searching ? (
            <p className="reader-sheet-message">
              {t("reader.searchingFor", { query: submittedQuery })}
            </p>
          ) : results.length === 0 ? (
            <p className="reader-sheet-message">
              {t("reader.noResults", { query: submittedQuery })}
            </p>
          ) : (
            <>
              <p className="reader-search-count">
                {t("reader.resultsFound", { count: results.length })}
              </p>
              <ol className="reader-search-results">
                {results.map((result) => {
                  const { title, label, active } = describeResult(result);
                  return (
                    <li key={result.pageNumber}>
                      <button
                        type="button"
                        className={active ? "is-active" : ""}
                        aria-label={label}
                        onClick={() => onSelectResult(result)}
                      >
                        <span className="reader-search-result-meta">
                          <strong>{title}</strong>
                          <span>{t("reader.matches", { count: result.matchCount })}</span>
                        </span>
                        <span className="reader-search-excerpt">
                          <HighlightedExcerpt text={result.excerpt} query={submittedQuery} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )
        ) : (
          <p className="reader-sheet-message">{t("reader.searchPrompt")}</p>
        )}
      </div>
    </>
  );
}
