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
  type EpubBookmark,
  type EpubHighlight,
  type HighlightColor,
} from "../api";
import { useSavedList } from "../common/useSavedList";
import { isCFIOnPage, pageStartCFI, sortEpubBookmarks, sortEpubHighlights } from "./epubContent";

export type ReaderLocation = {
  cfi: string;
  fraction: number;
  section: number;
  sectionCount: number;
  tocHref: string;
  tocLabel: string;
};

type HighlightSelection = { cfi: string; text: string; section: number };

async function loadHighlights(bookId: string): Promise<EpubHighlight[]> {
  return sortEpubHighlights(await listHighlights(bookId, "epub"));
}

async function loadBookmarks(bookId: string): Promise<EpubBookmark[]> {
  return sortEpubBookmarks(await listBookmarks(bookId, "epub"));
}

export function useEpubHighlights(
  bookId: string,
  view: View | null,
  location: ReaderLocation | null,
  highlightsRef: RefObject<EpubHighlight[]>,
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

  useEffect(() => {
    if (!view || !loaded) {
      return;
    }
    for (const highlight of highlightsRef.current) {
      view.addAnnotation({ value: highlight.location.cfi }).catch(() => {});
    }
  }, [view, loaded, highlightsRef]);

  const store = useCallback(
    (next: EpubHighlight[]) => {
      highlightsRef.current = next;
      setEntries(next);
    },
    [highlightsRef, setEntries],
  );

  async function save(selection: HighlightSelection, color: HighlightColor): Promise<boolean> {
    if (!view || busy) {
      return false;
    }
    return change(async () => {
      const saved = await addHighlight(bookId, {
        location: { kind: "epub", section: selection.section, cfi: selection.cfi },
        pageCount: Math.max(selection.section, location?.sectionCount ?? 0),
        color,
        text: selection.text,
      });
      store(sortEpubHighlights([...highlightsRef.current, saved]));
      await view.addAnnotation({ value: saved.location.cfi });
    }, "error.saveHighlight");
  }

  async function recolor(id: number, color: HighlightColor) {
    if (!view || busy) {
      return;
    }
    const highlight = highlightsRef.current.find((entry) => entry.id === id);
    if (!highlight) {
      return;
    }
    await change(async () => {
      const changed = await changeHighlightColor(bookId, id, color);
      store(
        highlightsRef.current.map((entry) =>
          entry.id === id ? { ...entry, color: changed } : entry,
        ),
      );
      // Adding it again redraws it in the new color.
      await view.addAnnotation({ value: highlight.location.cfi });
    }, "error.saveHighlight");
  }

  async function remove(id: number, onRemoved: () => void) {
    const highlight = highlightsRef.current.find((entry) => entry.id === id);
    if (!view || !highlight || busy) {
      return;
    }
    await change(async () => {
      await removeHighlight(bookId, id);
      store(highlightsRef.current.filter((entry) => entry.id !== id));
      onRemoved();
      await view.deleteAnnotation({ value: highlight.location.cfi });
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

export function useEpubBookmarks(bookId: string, location: ReaderLocation | null) {
  const list = useSavedList(bookId, {
    load: loadBookmarks,
    loadErrorKey: "error.loadBookmarks",
  });
  const { entries: bookmarks, setEntries: setBookmarks, busy, change } = list;
  const pageCFI = location?.cfi ?? "";
  const pageBookmarks = pageCFI
    ? bookmarks.filter((bookmark) => isCFIOnPage(bookmark.location.cfi, pageCFI))
    : [];
  const pageBookmarked = pageBookmarks.length > 0;

  async function togglePage() {
    if (!location || busy) {
      return;
    }
    await change(async () => {
      if (pageBookmarked) {
        await Promise.all(
          pageBookmarks.map((bookmark) => removeBookmark(bookId, bookmark.location)),
        );
        setBookmarks((current) => current.filter((bookmark) => !pageBookmarks.includes(bookmark)));
      } else {
        const saved = await addBookmark(
          bookId,
          {
            kind: "epub",
            section: location.section,
            cfi: pageStartCFI(location.cfi),
            progress: Math.min(1, Math.max(0, location.fraction)),
          },
          Math.max(location.section, location.sectionCount),
        );
        setBookmarks((current) =>
          sortEpubBookmarks([
            ...current.filter((bookmark) => bookmark.location.cfi !== saved.location.cfi),
            saved,
          ]),
        );
      }
    }, "error.saveBookmark");
  }

  async function remove(bookmark: EpubBookmark) {
    if (busy) {
      return;
    }
    await change(async () => {
      await removeBookmark(bookId, bookmark.location);
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
