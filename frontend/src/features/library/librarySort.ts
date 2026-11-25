import { useCallback, useState } from "react";
import type { BookSummary } from "../../shared/api/backend";

export const librarySortOrders = ["recent", "added", "title", "progress"] as const;

export type LibrarySortOrder = (typeof librarySortOrders)[number];

const sortOrderStorageKey = "glint.library.sortOrder";

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

// compareNewest puts the later time first.
function compareNewest(a: number, b: number): number {
  if (a === b) {
    return 0;
  }
  return a < b ? 1 : -1;
}

// Books never opened go after the opened ones, newest import first, which
// matches the order the backend lists them in.
function compareRecent(a: BookSummary, b: BookSummary): number {
  return (
    compareNewest(time(a.lastOpenedAt), time(b.lastOpenedAt)) ||
    compareNewest(time(a.importedAt), time(b.importedAt))
  );
}

// sortBooks returns a new array; it never reorders the books it was given.
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

function loadSortOrder(): LibrarySortOrder {
  if (typeof window === "undefined") {
    return "recent";
  }
  const stored = window.localStorage.getItem(sortOrderStorageKey);
  return isSortOrder(stored) ? stored : "recent";
}

// useLibrarySortOrder remembers the shelf order on this Mac between launches.
export function useLibrarySortOrder(): [LibrarySortOrder, (order: LibrarySortOrder) => void] {
  const [order, setOrder] = useState<LibrarySortOrder>(loadSortOrder);
  const changeOrder = useCallback((next: LibrarySortOrder) => {
    if (!isSortOrder(next)) {
      return;
    }
    setOrder(next);
    window.localStorage.setItem(sortOrderStorageKey, next);
  }, []);
  return [order, changeOrder];
}
