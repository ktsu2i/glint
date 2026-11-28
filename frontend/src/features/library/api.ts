import {
  ListBooks,
  MarkBookCoverFailed,
  OpenBook,
  OpenBookFile,
  PendingIndexBooks,
  RelinkBook,
  RemoveBook,
  RenameBook,
  SaveBookCover,
  SaveBookSegments,
  SearchLibrary,
} from "../../../bindings/github.com/ktsu2i/glint/internal/app/booksservice";
import {
  GetLibrarySettings,
  SaveLibrarySettings,
} from "../../../bindings/github.com/ktsu2i/glint/internal/app/settingsservice";
import type { BookFile, BookSearchResult, BookSummary } from "../../shared/api/books";

export type BookSegmentInput = {
  ordinal: number;
  location: string;
  headingPath: string;
  text: string;
};

type IndexTarget = {
  id: string;
  url: string;
  nextSegment: number;
  total: number;
};

export type LibrarySearchHit = {
  book: BookSummary;
  totalMatches: number;
  pages: BookSearchResult[];
};

type LibrarySettings = {
  sortOrder: string;
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

export async function searchLibrary(query: string): Promise<LibrarySearchHit[]> {
  return (await SearchLibrary(query)) as LibrarySearchHit[];
}

export async function saveBookCover(bookId: string, dataUrl: string): Promise<void> {
  await SaveBookCover(bookId, dataUrl);
}

export async function markBookCoverFailed(bookId: string): Promise<void> {
  await MarkBookCoverFailed(bookId);
}

export async function getLibrarySettings(): Promise<LibrarySettings> {
  return GetLibrarySettings();
}

export async function saveLibrarySettings(settings: LibrarySettings): Promise<LibrarySettings> {
  return SaveLibrarySettings(settings);
}
