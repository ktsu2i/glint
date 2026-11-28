import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { BookFile, BookSummary } from "../../shared/api/books";
import { openBook, openBookFile, relinkBook, removeBook, renameBook } from "./api";
import type { LibraryBooks } from "./useLibraryBooks";

type LibraryActionOptions = {
  /** Shows a book that was imported, opened, or chosen again. */
  onOpen: (book: BookFile) => void;
  onRenamed: (summary: BookSummary) => void;
};

/**
 * What the shelf and the search results can do to a book. Failures show as
 * the library error, and busyBookId marks the book being worked on.
 */
export function useLibraryActions(
  library: LibraryBooks,
  { onOpen, onRenamed }: LibraryActionOptions,
) {
  const { t } = useTranslation();
  const { refresh, setError, replaceBook } = library;
  const [busyBookId, setBusyBookId] = useState("");
  const [opening, setOpening] = useState(false);

  async function importBook() {
    setOpening(true);
    setError("");
    try {
      const selected = await openBookFile();
      if (selected.url) {
        onOpen(selected);
        await refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error.addBook"));
    } finally {
      setOpening(false);
    }
  }

  async function open(summary: BookSummary, pageNumber?: number) {
    if (!summary.available) {
      return;
    }
    setBusyBookId(summary.id);
    setError("");
    try {
      const opened = await openBook(summary.id);
      // The saved place belongs to the section the book was left on.
      onOpen(
        pageNumber === undefined ? opened : { ...opened, initialPage: pageNumber, initialCfi: "" },
      );
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error.openBook"));
      await refresh();
    } finally {
      setBusyBookId("");
    }
  }

  async function remove(summary: BookSummary) {
    setBusyBookId(summary.id);
    setError("");
    try {
      const removed = await removeBook(summary.id);
      if (removed) {
        await refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error.removeBook"));
    } finally {
      setBusyBookId("");
    }
  }

  async function rename(summary: BookSummary, name: string) {
    setBusyBookId(summary.id);
    setError("");
    try {
      const renamed = await renameBook(summary.id, name);
      replaceBook(renamed);
      onRenamed(renamed);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error.renameBook"));
    } finally {
      setBusyBookId("");
    }
  }

  async function relink(summary: BookSummary) {
    setBusyBookId(summary.id);
    setError("");
    try {
      const selected = await relinkBook(summary.id);
      if (selected.url) {
        onOpen(selected);
        await refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("error.relinkBook"));
    } finally {
      setBusyBookId("");
    }
  }

  return {
    busyBookId,
    opening,
    importBook,
    openBook: (summary: BookSummary) => open(summary),
    openBookAtPage: (summary: BookSummary, pageNumber: number) => open(summary, pageNumber),
    removeBook: remove,
    renameBook: rename,
    relinkBook: relink,
  };
}

export type LibraryActions = ReturnType<typeof useLibraryActions>;
