import { useCallback, useEffect, useRef, useState } from "react";
import { getLibrarySettings, saveLibrarySettings } from "./api";
import type { BookSummary } from "../../shared/api/books";

export const librarySortOrders = ["recent", "added", "title", "progress"] as const;

export type LibrarySortOrder = (typeof librarySortOrders)[number];

export function readingProgress(book: BookSummary): number {
  if (book.pageCount < 1) {
    return 0;
  }
  return Math.min(100, Math.max(0, (book.lastPage / book.pageCount) * 100));
}

function time(value: string): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function compareNewest(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  return a < b ? 1 : -1;
}

function compareRecent(a: BookSummary, b: BookSummary): number {
  return (
    compareNewest(time(a.lastOpenedAt), time(b.lastOpenedAt)) ||
    compareNewest(time(a.importedAt), time(b.importedAt))
  );
}

export function sortBooks(
  books: readonly BookSummary[],
  order: LibrarySortOrder,
  locale: string,
): BookSummary[] {
  const sorted = [...books];
  switch (order) {
    case "added":
      sorted.sort(
        (a, b) => compareNewest(time(a.importedAt), time(b.importedAt)) || compareRecent(a, b),
      );
      break;
    case "title": {
      const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
      sorted.sort((a, b) => collator.compare(a.title, b.title) || compareRecent(a, b));
      break;
    }
    case "progress":
      sorted.sort((a, b) => readingProgress(b) - readingProgress(a) || compareRecent(a, b));
      break;
    case "recent":
      sorted.sort(compareRecent);
  }
  return sorted;
}

function isSortOrder(value: unknown): value is LibrarySortOrder {
  return librarySortOrders.some((order) => order === value);
}

async function loadSortOrder(): Promise<LibrarySortOrder> {
  const saved = await getLibrarySettings();
  return isSortOrder(saved.sortOrder) ? saved.sortOrder : "recent";
}

export function useLibrarySortOrder(): [LibrarySortOrder, (order: LibrarySortOrder) => void] {
  const [order, setOrder] = useState<LibrarySortOrder>("recent");
  const chosenRef = useRef(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const saved = await loadSortOrder();
        if (active && !chosenRef.current) {
          setOrder(saved);
        }
      } catch (reason) {
        console.warn("Loading the library sort order failed", reason);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, []);

  const changeOrder = useCallback((next: LibrarySortOrder) => {
    if (!isSortOrder(next)) {
      return;
    }
    chosenRef.current = true;
    setOrder(next);
    saveLibrarySettings({ sortOrder: next }).catch((reason: unknown) => {
      console.warn("Saving the library sort order failed", reason);
    });
  }, []);
  return [order, changeOrder];
}
