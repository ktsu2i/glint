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
import type {
  BookHighlight as BookHighlightDto,
  BookmarkLocation as BookmarkLocationDto,
  HighlightLocation as HighlightLocationDto,
} from "../../../bindings/github.com/ktsu2i/glint/internal/app/models";
import type { BindingDirection, BookSearchResult } from "../../shared/api/books";

export type PdfBookmarkLocation = { kind: "pdf"; page: number };

export type EpubBookmarkLocation = {
  kind: "epub";
  section: number;
  cfi: string;
  progress: number;
};

type BookmarkLocation = PdfBookmarkLocation | EpubBookmarkLocation;

export type BookBookmark<L extends BookmarkLocation = BookmarkLocation> = {
  location: L;
  createdAt: string;
};

const highlightColors = ["yellow", "green", "pink", "purple"] as const;

export type HighlightColor = (typeof highlightColors)[number];

export type HighlightRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfHighlightLocation = { kind: "pdf"; page: number; rects: HighlightRect[] };

export type EpubHighlightLocation = { kind: "epub"; section: number; cfi: string };

type HighlightLocation = PdfHighlightLocation | EpubHighlightLocation;

export type BookHighlight<L extends HighlightLocation = HighlightLocation> = {
  id: number;
  color: HighlightColor;
  text: string;
  location: L;
  createdAt: string;
};

type HighlightInput<L extends HighlightLocation> = {
  location: L;
  pageCount: number;
  color: HighlightColor;
  text: string;
};

export type PdfBookmark = BookBookmark<PdfBookmarkLocation>;
export type EpubBookmark = BookBookmark<EpubBookmarkLocation>;
export type PdfHighlight = BookHighlight<PdfHighlightLocation>;
export type EpubHighlight = BookHighlight<EpubHighlightLocation>;

type LocationKind = BookmarkLocation["kind"];

export type EpubLayout = "single" | "spread";

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

function toBookmarkLocation(dto: BookmarkLocationDto): BookmarkLocation {
  if (dto.pdf) {
    return { kind: "pdf", page: dto.pdf.page };
  }
  if (dto.epub) {
    return { kind: "epub", ...dto.epub };
  }
  throw new Error("A bookmark has no location.");
}

function fromBookmarkLocation(location: BookmarkLocation): BookmarkLocationDto {
  if (location.kind === "pdf") {
    return { pdf: { page: location.page } };
  }
  return { epub: { section: location.section, cfi: location.cfi, progress: location.progress } };
}

function toHighlightLocation(dto: HighlightLocationDto): HighlightLocation {
  if (dto.pdf) {
    return { kind: "pdf", page: dto.pdf.page, rects: dto.pdf.rects ?? [] };
  }
  if (dto.epub) {
    return { kind: "epub", ...dto.epub };
  }
  throw new Error("A highlight has no location.");
}

function fromHighlightLocation(location: HighlightLocation): HighlightLocationDto {
  if (location.kind === "pdf") {
    return { pdf: { page: location.page, rects: location.rects } };
  }
  return { epub: { section: location.section, cfi: location.cfi } };
}

function toHighlightColor(color: string): HighlightColor {
  const known = highlightColors.find((entry) => entry === color);
  if (known === undefined) {
    throw new Error(`Unknown highlight color: ${color}`);
  }
  return known;
}

function toBookHighlight(dto: BookHighlightDto): BookHighlight {
  return {
    id: dto.id,
    color: toHighlightColor(dto.color),
    text: dto.text,
    location: toHighlightLocation(dto.location),
    createdAt: dto.createdAt,
  };
}

function hasKind<K extends LocationKind>(kind: K) {
  return <T extends { location: { kind: LocationKind } }>(
    entry: T,
  ): entry is T & { location: Extract<T["location"], { kind: K }> } => entry.location.kind === kind;
}

export async function listBookmarks<K extends LocationKind>(
  bookId: string,
  kind: K,
): Promise<BookBookmark<Extract<BookmarkLocation, { kind: K }>>[]> {
  const bookmarks = ((await ListBookmarks(bookId)) ?? []).map((dto): BookBookmark => ({
    location: toBookmarkLocation(dto.location),
    createdAt: dto.createdAt,
  }));
  return bookmarks.filter(hasKind(kind));
}

export async function addBookmark<L extends BookmarkLocation>(
  bookId: string,
  location: L,
  pageCount: number,
): Promise<BookBookmark<L>> {
  const saved = await AddBookmark(bookId, { location: fromBookmarkLocation(location), pageCount });
  return { location, createdAt: saved.createdAt };
}

export async function removeBookmark(bookId: string, location: BookmarkLocation): Promise<void> {
  await RemoveBookmark(bookId, fromBookmarkLocation(location));
}

export async function listHighlights<K extends LocationKind>(
  bookId: string,
  kind: K,
): Promise<BookHighlight<Extract<HighlightLocation, { kind: K }>>[]> {
  return ((await ListHighlights(bookId)) ?? [])
    .map((dto) => toBookHighlight(dto))
    .filter(hasKind(kind));
}

export async function addHighlight<L extends HighlightLocation>(
  bookId: string,
  input: HighlightInput<L>,
): Promise<BookHighlight<L>> {
  const saved = toBookHighlight(
    await AddHighlight(bookId, { ...input, location: fromHighlightLocation(input.location) }),
  );
  return { ...saved, location: input.location };
}

export async function changeHighlightColor(
  bookId: string,
  id: number,
  color: HighlightColor,
): Promise<HighlightColor> {
  return toHighlightColor((await ChangeHighlightColor(bookId, id, color)).color);
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
