import {
  AddBookmark,
  AddHighlight,
  ChangeHighlightColor,
  ListBookmarks,
  ListHighlights,
  RemoveBookmark,
  RemoveHighlight,
  SaveBindingDirection,
  SaveReadingPosition,
  SearchBook,
} from "../../../bindings/github.com/ktsu2i/glint/internal/app/booksservice";
import {
  GetReaderSettings,
  SaveReaderSettings,
} from "../../../bindings/github.com/ktsu2i/glint/internal/app/settingsservice";
import { SetWindowControlsVisible } from "../../../bindings/github.com/ktsu2i/glint/internal/app/windowservice";
import type { BindingDirection, BookSearchResult } from "../../shared/api/books";

/**
 * A bookmark marks a PDF page, or a place in an EPUB by its CFI. For an EPUB,
 * pageNumber is the section, counted from 1, and progress is where the place
 * sits in the book, from 0 to 1. A PDF bookmark has an empty CFI and progress 0.
 */
export type BookBookmark = {
  pageNumber: number;
  cfi: string;
  progress: number;
  createdAt: string;
};

/** Where an EPUB bookmark sits; a PDF bookmark has none. */
type BookmarkPlace = {
  cfi: string;
  progress: number;
};

export type HighlightColor = "yellow" | "green" | "pink" | "purple";

/** A rectangle on the page, in fractions of the page width and height. */
export type HighlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * A highlight sits on a PDF page by its rectangles, or in an EPUB by its CFI.
 * For an EPUB, pageNumber is the section, counted from 1.
 */
export type BookHighlight = {
  id: number;
  pageNumber: number;
  color: HighlightColor;
  text: string;
  rects: HighlightRect[];
  cfi: string;
  createdAt: string;
};

type HighlightInput = {
  pageNumber: number;
  pageCount: number;
  color: HighlightColor;
  text: string;
  rects: HighlightRect[];
  cfi?: string;
};

export type EpubLayout = "single" | "spread";

/** How the reader shows books. Every book shares them. */
export type ReaderSettings = {
  epubFontScale: number;
  epubLayout: EpubLayout;
};

export async function saveReadingPosition(
  bookId: string,
  pageNumber: number,
  pageCount: number,
  cfi = "",
): Promise<void> {
  await SaveReadingPosition(bookId, pageNumber, pageCount, cfi);
}

export async function saveBindingDirection(
  bookId: string,
  direction: BindingDirection,
): Promise<void> {
  await SaveBindingDirection(bookId, direction);
}

export async function listBookmarks(bookId: string): Promise<BookBookmark[]> {
  return (await ListBookmarks(bookId)) ?? [];
}

export async function addBookmark(
  bookId: string,
  pageNumber: number,
  pageCount: number,
  place?: BookmarkPlace,
): Promise<BookBookmark> {
  return AddBookmark(bookId, {
    pageNumber,
    pageCount,
    cfi: place?.cfi ?? "",
    progress: place?.progress ?? 0,
  });
}

export async function removeBookmark(bookId: string, pageNumber: number, cfi = ""): Promise<void> {
  await RemoveBookmark(bookId, pageNumber, cfi);
}

export async function listHighlights(bookId: string): Promise<BookHighlight[]> {
  return ((await ListHighlights(bookId)) ?? []) as BookHighlight[];
}

export async function addHighlight(bookId: string, input: HighlightInput): Promise<BookHighlight> {
  return (await AddHighlight(bookId, { ...input, cfi: input.cfi ?? "" })) as BookHighlight;
}

export async function changeHighlightColor(
  bookId: string,
  id: number,
  color: HighlightColor,
): Promise<BookHighlight> {
  return (await ChangeHighlightColor(bookId, id, color)) as BookHighlight;
}

export async function removeHighlight(bookId: string, id: number): Promise<void> {
  await RemoveHighlight(bookId, id);
}

export async function searchBook(bookId: string, query: string): Promise<BookSearchResult[]> {
  return (await SearchBook(bookId, query)) ?? [];
}

export async function setWindowControlsVisible(visible: boolean): Promise<void> {
  await SetWindowControlsVisible(visible);
}

export async function getReaderSettings(): Promise<ReaderSettings> {
  return (await GetReaderSettings()) as ReaderSettings;
}

export async function saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings> {
  return (await SaveReaderSettings(settings)) as ReaderSettings;
}
