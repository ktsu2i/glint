import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BookSummary } from "../../shared/api/books";
import { listBooks } from "./api";

export function useLibraryBooks() {
  const { t } = useTranslation();
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      setBooks(await listBooks());
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error.loadLibrary"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- 初回 load。loading の初期値は true で、setState は await 後に行われる。
    void refresh();
  }, [refresh]);

  const replaceBook = useCallback((updated: BookSummary) => {
    setBooks((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
  }, []);

  return { books, loading, error, setError, refresh, replaceBook };
}

export type LibraryBooks = ReturnType<typeof useLibraryBooks>;
