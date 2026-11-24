import {
  AddBookmark,
  ListBookmarks,
  ListBooks,
  MarkBookCoverFailed,
  OpenBook,
  OpenBookFile,
  RelinkBook,
  RemoveBook,
  RemoveBookmark,
  RenameBook,
  PendingIndexBooks,
  SaveBookSegments,
  SaveBookCover,
  SaveReadingPosition,
  SearchBook,
  SearchLibrary,
} from "../../../wailsjs/go/books/Service";
import {
  GetAppearanceSettings,
  GetLanguageSettings,
  SaveAppearanceSettings,
  SaveLanguageSettings,
} from "../../../wailsjs/go/settings/Service";

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
  return ListBookmarks(bookId);
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

export async function saveBookSegments(
  bookId: string,
  segments: BookSegmentInput[],
  total: number,
): Promise<number> {
  return SaveBookSegments(bookId, segments, total);
}

export async function pendingIndexBooks(): Promise<IndexTarget[]> {
  return PendingIndexBooks();
}

export async function searchBook(bookId: string, query: string): Promise<BookSearchResult[]> {
  return SearchBook(bookId, query);
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
