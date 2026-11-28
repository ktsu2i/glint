import { useCallback, useEffect, useLayoutEffect, type RefObject } from "react";
import type { View } from "foliate-js/view.js";
import {
  addBookmark,
  addHighlight,
  changeHighlightColor,
  listBookmarks,
  listHighlights,
  removeBookmark,
  removeHighlight,
  type BookBookmark,
  type BookHighlight,
  type HighlightColor,
} from "../api";
import { useSavedList } from "../common/useSavedList";
import { isCFIOnPage, pageStartCFI, sortEpubBookmarks, sortEpubHighlights } from "./epubContent";

/** Where the reader is in the book. */
export type ReaderLocation = {
  /** The range CFI of what the page shows. */
  cfi: string;
  fraction: number;
  section: number;
  sectionCount: number;
  tocHref: string;
  tocLabel: string;
};

/** Text selected in a section, to highlight. */
type HighlightSelection = { cfi: string; text: string; section: number };

async function loadHighlights(bookId: string): Promise<BookHighlight[]> {
  return sortEpubHighlights(await listHighlights(bookId));
}

async function loadBookmarks(bookId: string): Promise<BookBookmark[]> {
  return sortEpubBookmarks(await listBookmarks(bookId));
}

/**
 * The highlights of an EPUB, by CFI, drawn on the view as annotations.
 * highlightsRef holds them for foliate-js, which asks while it draws a
 * section, outside React's render.
 */
export function useEpubHighlights(
  bookId: string,
  view: View | null,
  location: ReaderLocation | null,
  highlightsRef: RefObject<BookHighlight[]>,
) {
  const list = useSavedList(bookId, {
    load: loadHighlights,
    loadErrorKey: "error.loadHighlights",
    onLoaded: (saved) => {
      highlightsRef.current = saved;
    },
  });
  const { entries: highlights, setEntries, loaded, busy, change } = list;

  useLayoutEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights, highlightsRef]);

  // Highlights that arrive after the first section was drawn are added to it now.
  useEffect(() => {
    if (!view || !loaded) {
      return;
    }
    for (const highlight of highlightsRef.current) {
      if (highlight.cfi) {
        view.addAnnotation({ value: highlight.cfi }).catch(() => {});
      }
    }
  }, [view, loaded, highlightsRef]);

  const store = useCallback(
    (next: BookHighlight[]) => {
      highlightsRef.current = next;
      setEntries(next);
    },
    [highlightsRef, setEntries],
  );

  /** Saves the selection in the color and draws it. Reports whether that worked. */
  async function save(selection: HighlightSelection, color: HighlightColor): Promise<boolean> {
    if (!view || busy) {
      return false;
    }
    return change(async () => {
      const saved = await addHighlight(bookId, {
        pageNumber: selection.section,
        pageCount: Math.max(selection.section, location?.sectionCount ?? 0),
        color,
        text: selection.text,
        rects: [],
        cfi: selection.cfi,
      });
      store(sortEpubHighlights([...highlightsRef.current, saved]));
      await view.addAnnotation({ value: saved.cfi });
    }, "error.saveHighlight");
  }

  async function recolor(id: number, color: HighlightColor) {
    if (!view || busy) {
      return;
    }
    await change(async () => {
      const changed = await changeHighlightColor(bookId, id, color);
      store(highlightsRef.current.map((entry) => (entry.id === id ? changed : entry)));
      // Adding it again redraws it in the new color.
      await view.addAnnotation({ value: changed.cfi });
    }, "error.saveHighlight");
  }

  /** Removes the highlight; onRemoved runs once it is gone from the list. */
  async function remove(id: number, onRemoved: () => void) {
    const highlight = highlightsRef.current.find((entry) => entry.id === id);
    if (!view || !highlight || busy) {
      return;
    }
    await change(async () => {
      await removeHighlight(bookId, id);
      store(highlightsRef.current.filter((entry) => entry.id !== id));
      onRemoved();
      await view.deleteAnnotation({ value: highlight.cfi });
    }, "error.saveHighlight");
  }

  return {
    highlights,
    loaded,
    busy,
    error: list.error,
    save,
    recolor,
    remove,
  };
}

/** The bookmarks of an EPUB, and those on the page being read. */
export function useEpubBookmarks(bookId: string, location: ReaderLocation | null) {
  const list = useSavedList(bookId, {
    load: loadBookmarks,
    loadErrorKey: "error.loadBookmarks",
  });
  const { entries: bookmarks, setEntries: setBookmarks, busy, change } = list;
  const pageCFI = location?.cfi ?? "";
  const pageBookmarks = pageCFI
    ? bookmarks.filter((bookmark) => isCFIOnPage(bookmark.cfi, pageCFI))
    : [];
  const pageBookmarked = pageBookmarks.length > 0;

  async function togglePage() {
    if (!location || busy) {
      return;
    }
    await change(async () => {
      if (pageBookmarked) {
        await Promise.all(
          pageBookmarks.map((bookmark) =>
            removeBookmark(bookId, bookmark.pageNumber, bookmark.cfi),
          ),
        );
        setBookmarks((current) => current.filter((bookmark) => !pageBookmarks.includes(bookmark)));
      } else {
        const saved = await addBookmark(
          bookId,
          location.section,
          Math.max(location.section, location.sectionCount),
          {
            cfi: pageStartCFI(location.cfi),
            progress: Math.min(1, Math.max(0, location.fraction)),
          },
        );
        setBookmarks((current) =>
          sortEpubBookmarks([...current.filter((bookmark) => bookmark.cfi !== saved.cfi), saved]),
        );
      }
    }, "error.saveBookmark");
  }

  async function remove(bookmark: BookBookmark) {
    if (busy) {
      return;
    }
    await change(async () => {
      await removeBookmark(bookId, bookmark.pageNumber, bookmark.cfi);
      setBookmarks((current) => current.filter((entry) => entry !== bookmark));
    }, "error.saveBookmark");
  }

  return {
    bookmarks,
    pageBookmarks,
    pageBookmarked,
    loaded: list.loaded,
    busy,
    error: list.error,
    togglePage,
    remove,
  };
}
