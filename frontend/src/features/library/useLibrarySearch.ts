import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchLibrary, type LibrarySearchHit } from "./api";
import type { LibrarySearchStatus } from "./LibrarySearch";

// Long enough to skip the keystrokes in a word, short enough to feel live.
const LIBRARY_SEARCH_DEBOUNCE_MS = 250;

/**
 * The search across the text of every book. While active, it searches as the
 * query is typed, once typing pauses. A newer search wins over an older one.
 */
export function useLibrarySearch(active: boolean) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibrarySearchHit[]>([]);
  const [status, setStatus] = useState<LibrarySearchStatus>("idle");
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  const run = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return;
      }
      const request = requestRef.current + 1;
      requestRef.current = request;
      setQuery(trimmed);
      setStatus("loading");
      setError("");
      try {
        const hits = await searchLibrary(trimmed);
        if (requestRef.current !== request) {
          return;
        }
        setResults(hits);
        setStatus("ready");
      } catch (reason) {
        if (requestRef.current !== request) {
          return;
        }
        setResults([]);
        setStatus("error");
        setError(reason instanceof Error ? reason.message : t("error.searchLibrary"));
      }
    },
    [t],
  );

  const submit = useCallback(() => run(input), [run, input]);

  const clear = useCallback(() => {
    requestRef.current += 1;
    setInput("");
    setQuery("");
    setResults([]);
    setStatus("idle");
    setError("");
  }, []);

  useEffect(() => {
    if (!active) {
      return;
    }
    const trimmed = input.trim();
    if (!trimmed || trimmed === query) {
      return;
    }
    const timer = window.setTimeout(() => {
      void run(trimmed);
    }, LIBRARY_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [active, input, query, run]);

  const changeInput = useCallback(
    (value: string) => {
      if (!value.trim()) {
        clear();
      }
      setInput(value);
    },
    [clear],
  );

  return { input, query, results, status, error, changeInput, submit, clear };
}

export type LibrarySearch = ReturnType<typeof useLibrarySearch>;
