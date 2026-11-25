import {
  AddBookmark,
  AddHighlight,
  ChangeHighlightColor,
  ListBookmarks,
  ListHighlights,
  ListBooks,
  MarkBookCoverFailed,
  OpenBook,
  OpenBookFile,
  RelinkBook,
  RemoveBook,
  RemoveBookmark,
  RemoveHighlight,
  RenameBook,
  PendingIndexBooks,
  SaveBookSegments,
  SaveBookCover,
  SaveReadingPosition,
  SearchBook,
  SearchLibrary,
} from "../../../bindings/github.com/kaito/glint/internal/app/booksservice";
import {
  GetAppearanceSettings,
  GetLanguageSettings,
  SaveAppearanceSettings,
  SaveLanguageSettings,
} from "../../../bindings/github.com/kaito/glint/internal/app/settingsservice";
import { SetWindowControlsVisible } from "../../../bindings/github.com/kaito/glint/internal/app/windowservice";

export type BookFormat = "pdf" | "epub";

export type EpubSpineItem = {
  index: number;
  id: string;
  href: string;
  mediaType: string;
  title: string;
};

export type BookFile = {
  id: string;
  title: string;
  name: string;
  url: string;
  format?: BookFormat;
  size: number;
  initialPage: number;
  indexedPageCount: number;
  nextSegment: number;
  coverStatus: "pending" | "ready" | "failed";
  spineItems?: EpubSpineItem[];
};

export type BookSegmentInput = {
  ordinal: number;
  location: string;
  headingPath: string;
  text: string;
};

export type IndexTarget = {
  id: string;
  url: string;
  nextSegment: number;
  total: number;
};

export type BookSearchResult = {
  pageNumber: number;
  location: string;
  headingPath: string;
  excerpt: string;
  matchCount: number;
};

export type BookBookmark = {
  pageNumber: number;
  createdAt: string;
};

export type HighlightColor = "yellow" | "green" | "pink" | "purple";

/** A rectangle on the page, in fractions of the page width and height. */
export type HighlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BookHighlight = {
  id: number;
  pageNumber: number;
  color: HighlightColor;
  text: string;
  rects: HighlightRect[];
  createdAt: string;
};

export type HighlightInput = {
  pageNumber: number;
  pageCount: number;
  color: HighlightColor;
  text: string;
  rects: HighlightRect[];
};

export type BookSummary = {
  id: string;
  title: string;
  fileName: string;
  format?: BookFormat;
  size: number;
  pageCount: number;
  lastPage: number;
  importedAt: string;
  lastOpenedAt: string;
  coverUrl: string;
  coverStatus: "pending" | "ready" | "failed";
  available: boolean;
};

export type LibrarySearchHit = {
  book: BookSummary;
  totalMatches: number;
  pages: BookSearchResult[];
};

export type ThemePreference = "light" | "dark" | "system";

export type AppearanceSettings = {
  theme: ThemePreference;
};

export type LanguagePreference = "en" | "ja";

export type LanguageSettings = {
  language: LanguagePreference;
};

export async function openBookFile(): Promise<BookFile> {
  return (await OpenBookFile()) as BookFile;
}

export async function listBooks(): Promise<BookSummary[]> {
  return (await ListBooks()) as BookSummary[];
}

export async function openBook(bookId: string): Promise<BookFile> {
  return (await OpenBook(bookId)) as BookFile;
}

export async function relinkBook(bookId: string): Promise<BookFile> {
  return (await RelinkBook(bookId)) as BookFile;
}

export async function removeBook(bookId: string): Promise<boolean> {
  return RemoveBook(bookId);
}

export async function renameBook(bookId: string, name: string): Promise<BookSummary> {
  return (await RenameBook(bookId, name)) as BookSummary;
}

export async function saveReadingPosition(
  bookId: string,
  pageNumber: number,
  pageCount: number,
): Promise<void> {
  await SaveReadingPosition(bookId, pageNumber, pageCount);
}

export async function listBookmarks(bookId: string): Promise<BookBookmark[]> {
  return (await ListBookmarks(bookId)) ?? [];
}

export async function addBookmark(
  bookId: string,
  pageNumber: number,
  pageCount: number,
): Promise<BookBookmark> {
  return AddBookmark(bookId, pageNumber, pageCount);
}

export async function removeBookmark(bookId: string, pageNumber: number): Promise<void> {
  await RemoveBookmark(bookId, pageNumber);
}

export async function listHighlights(bookId: string): Promise<BookHighlight[]> {
  return ((await ListHighlights(bookId)) ?? []) as BookHighlight[];
}

export async function addHighlight(bookId: string, input: HighlightInput): Promise<BookHighlight> {
  return (await AddHighlight(bookId, input)) as BookHighlight;
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

export async function saveBookSegments(
  bookId: string,
  segments: BookSegmentInput[],
  total: number,
): Promise<number> {
  return SaveBookSegments(bookId, segments, total);
}

export async function pendingIndexBooks(): Promise<IndexTarget[]> {
  return (await PendingIndexBooks()) ?? [];
}

export async function searchBook(bookId: string, query: string): Promise<BookSearchResult[]> {
  return (await SearchBook(bookId, query)) ?? [];
}

export async function searchLibrary(query: string): Promise<LibrarySearchHit[]> {
  return (await SearchLibrary(query)) as LibrarySearchHit[];
}

export async function saveBookCover(bookId: string, dataUrl: string): Promise<void> {
  await SaveBookCover(bookId, dataUrl);
}

export async function markBookCoverFailed(bookId: string): Promise<void> {
  await MarkBookCoverFailed(bookId);
}

export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  return (await GetAppearanceSettings()) as AppearanceSettings;
}

export async function saveAppearanceSettings(theme: ThemePreference): Promise<AppearanceSettings> {
  return (await SaveAppearanceSettings({ theme })) as AppearanceSettings;
}

export async function getLanguageSettings(): Promise<LanguageSettings> {
  return (await GetLanguageSettings()) as LanguageSettings;
}

export async function saveLanguageSettings(
  language: LanguagePreference,
): Promise<LanguageSettings> {
  return (await SaveLanguageSettings({ language })) as LanguageSettings;
}

export async function setWindowControlsVisible(visible: boolean): Promise<void> {
  await SetWindowControlsVisible(visible);
}
