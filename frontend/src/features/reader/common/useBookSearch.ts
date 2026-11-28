import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchBook } from "../api";
import type { BookSearchResult } from "../../../shared/api/books";

export function useBookSearch(bookId: string | undefined) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const submit = useCallback(async () => {
    if (bookId === undefined) {
      return;
    }
    const trimmed = query.trim();
    if (!trimmed) {
      setSubmittedQuery("");
      setResults([]);
      setError("");
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    setSearching(true);
    setError("");
    setSubmittedQuery(trimmed);
    try {
      const found = await searchBook(bookId, trimmed);
      if (requestRef.current === request) {
        setResults(found);
      }
    } catch (reason) {
      if (requestRef.current === request) {
        setResults([]);
        setError(reason instanceof Error ? reason.message : t("error.searchBook"));
      }
    } finally {
      if (requestRef.current === request) {
        setSearching(false);
      }
    }
  }, [bookId, query, t]);

  const reset = useCallback(() => {
    requestRef.current += 1;
    setQuery("");
    setSubmittedQuery("");
    setResults([]);
    setSearching(false);
    setError("");
  }, []);

  return { query, setQuery, submittedQuery, results, searching, error, submit, reset };
}
