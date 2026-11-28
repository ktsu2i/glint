import { useTranslation } from "react-i18next";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  addBookmark,
  addHighlight,
  changeHighlightColor,
  listBookmarks,
  listHighlights,
  removeBookmark,
  removeHighlight,
  type BookHighlight,
  type HighlightColor,
} from "../api";
import type { BookFile } from "../../../shared/api/books";
import { useSavedList } from "../common/useSavedList";
import type { PageSelection } from "./highlights";

async function loadSortedHighlights(bookId: string): Promise<BookHighlight[]> {
  return sortHighlights(await listHighlights(bookId));
}

function sortHighlights(highlights: BookHighlight[]): BookHighlight[] {
  return highlights.toSorted((a, b) => a.pageNumber - b.pageNumber || a.id - b.id);
}

export function usePdfBookmarks(
  book: BookFile | null,
  document: PDFDocumentProxy | null,
  pageNumber: number,
) {
  const list = useSavedList(book?.id, {
    load: listBookmarks,
    loadErrorKey: "error.loadBookmarks",
  });
  const { entries: bookmarks, setEntries: setBookmarks, change } = list;
  const numPages = document?.numPages ?? 0;
  const pageBookmarks =
    numPages > 0 ? bookmarks.filter((bookmark) => bookmark.pageNumber <= numPages) : bookmarks;
  const currentPageBookmarked = bookmarks.some((bookmark) => bookmark.pageNumber === pageNumber);

  async function remove(page: number) {
    if (!book) {
      return;
    }
    const bookId = book.id;
    await change(async () => {
      await removeBookmark(bookId, page);
      setBookmarks((current) => current.filter((entry) => entry.pageNumber !== page));
    }, "error.saveBookmark");
  }

  async function toggleCurrentPage() {
    if (!book || !document || list.busy) {
      return;
    }
    if (currentPageBookmarked) {
      await remove(pageNumber);
      return;
    }
    const bookId = book.id;
    const pageCount = document.numPages;
    await change(async () => {
      const saved = await addBookmark(bookId, pageNumber, pageCount);
      setBookmarks((current) =>
        [...current, saved].toSorted((a, b) => a.pageNumber - b.pageNumber),
      );
    }, "error.saveBookmark");
  }

  return {
    pageBookmarks,
    loaded: list.loaded,
    busy: list.busy,
    error: list.error,
    currentPageBookmarked,
    toggleCurrentPage,
    remove,
  };
}

export function usePdfHighlights(book: BookFile | null, document: PDFDocumentProxy | null) {
  const { t } = useTranslation();
  const list = useSavedList(book?.id, {
    load: loadSortedHighlights,
    loadErrorKey: "error.loadHighlights",
  });
  const { entries: highlights, setEntries: setHighlights, busy, setBusy, setError, change } = list;
  const numPages = document?.numPages ?? 0;
  const pageHighlights =
    numPages > 0 ? highlights.filter((highlight) => highlight.pageNumber <= numPages) : highlights;

  async function saveSelection(parts: PageSelection[], color: HighlightColor): Promise<boolean> {
    if (!book || !document || busy) {
      return false;
    }
    const bookId = book.id;
    const pageCount = document.numPages;
    setBusy(true);
    setError("");
    const results = await Promise.allSettled(
      parts.map((part) => addHighlight(bookId, { ...part, color, pageCount })),
    );
    const saved = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const failure = results.find((result) => result.status === "rejected");
    setHighlights((current) => sortHighlights([...current, ...saved]));
    if (failure) {
      const reason: unknown = failure.reason;
      setError(reason instanceof Error ? reason.message : t("error.saveHighlight"));
    }
    setBusy(false);
    return !failure;
  }

  async function recolor(id: number, color: HighlightColor) {
    if (!book || busy) {
      return;
    }
    const bookId = book.id;
    await change(async () => {
      const updated = await changeHighlightColor(bookId, id, color);
      setHighlights((current) =>
        current.map((highlight) => (highlight.id === id ? updated : highlight)),
      );
    }, "error.saveHighlight");
  }

  async function remove(id: number): Promise<boolean> {
    if (!book || busy) {
      return false;
    }
    const bookId = book.id;
    return change(async () => {
      await removeHighlight(bookId, id);
      setHighlights((current) => current.filter((highlight) => highlight.id !== id));
    }, "error.saveHighlight");
  }

  return {
    highlights,
    pageHighlights,
    loaded: list.loaded,
    busy,
    error: list.error,
    saveSelection,
    recolor,
    remove,
  };
}
