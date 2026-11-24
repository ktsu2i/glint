import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openBookFile: vi.fn(),
  relinkBook: vi.fn(),
  removeBook: vi.fn(),
  removeBookmark: vi.fn(),
  renameBook: vi.fn(),
  saveBookCover: vi.fn(),
  saveBookSegments: vi.fn(),
  pendingIndexBooks: vi.fn(),
  saveReadingPosition: vi.fn(),
  searchBook: vi.fn(),
  searchLibrary: vi.fn(),
  getAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
}));

vi.mock("../../../wailsjs/go/books/Service", () => ({
  AddBookmark: bindings.addBookmark,
  ListBookmarks: bindings.listBookmarks,
  ListBooks: bindings.listBooks,
  MarkBookCoverFailed: bindings.markBookCoverFailed,
  OpenBook: bindings.openBook,
  OpenBookFile: bindings.openBookFile,
  RelinkBook: bindings.relinkBook,
  RemoveBook: bindings.removeBook,
  RemoveBookmark: bindings.removeBookmark,
  RenameBook: bindings.renameBook,
  SaveBookCover: bindings.saveBookCover,
  SaveBookSegments: bindings.saveBookSegments,
  PendingIndexBooks: bindings.pendingIndexBooks,
  SaveReadingPosition: bindings.saveReadingPosition,
  SearchBook: bindings.searchBook,
  SearchLibrary: bindings.searchLibrary,
}));

vi.mock("../../../wailsjs/go/settings/Service", () => ({
  GetAppearanceSettings: bindings.getAppearanceSettings,
  SaveAppearanceSettings: bindings.saveAppearanceSettings,
}));

import {
  addBookmark,
  getAppearanceSettings,
  listBooks,
  listBookmarks,
  markBookCoverFailed,
  openBook,
  openBookFile,
  relinkBook,
  removeBook,
  removeBookmark,
  renameBook,
  saveBookCover,
  saveBookSegments,
  pendingIndexBooks,
  saveAppearanceSettings,
  saveReadingPosition,
  searchBook,
  searchLibrary,
} from "./backend";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backend facade", () => {
  it("delegates book file selection to Wails bindings", async () => {
    const book = {
      id: "book-1",
      title: "Book",
      name: "book.pdf",
      url: "/book/1",
      size: 42,
      initialPage: 1,
      coverStatus: "ready",
    };
    bindings.openBookFile.mockResolvedValue(book);

    await expect(openBookFile()).resolves.toEqual(book);
  });

  it("delegates appearance settings through a typed theme contract", async () => {
    bindings.getAppearanceSettings.mockResolvedValue({ theme: "dark" });
    bindings.saveAppearanceSettings.mockResolvedValue({ theme: "system" });

    await expect(getAppearanceSettings()).resolves.toEqual({ theme: "dark" });
    await expect(saveAppearanceSettings("system")).resolves.toEqual({ theme: "system" });
    expect(bindings.saveAppearanceSettings).toHaveBeenCalledWith({ theme: "system" });
  });

  it("delegates library persistence operations", async () => {
    const summaries = [{ id: "book-1" }];
    const book = { id: "book-1", url: "/book/1" };
    bindings.listBooks.mockResolvedValue(summaries);
    bindings.openBook.mockResolvedValue(book);
    bindings.relinkBook.mockResolvedValue(book);
    bindings.removeBook.mockResolvedValue(true);
    bindings.renameBook.mockResolvedValue({ ...summaries[0], title: "Renamed" });
    bindings.saveBookSegments.mockResolvedValue(2);
    const pending = [{ id: "book-1", url: "/book/1", nextSegment: 3, total: 10 }];
    bindings.pendingIndexBooks.mockResolvedValue(pending);
    bindings.searchBook.mockResolvedValue([{ pageNumber: 2, excerpt: "match", matchCount: 1 }]);
    const libraryHit = {
      book: { id: "book-1", title: "Book", coverUrl: "/cover/1", available: true },
      totalMatches: 3,
      pages: [{ pageNumber: 7, excerpt: "library hit", matchCount: 2 }],
    };
    bindings.searchLibrary.mockResolvedValue([libraryHit]);
    const bookmark = { pageNumber: 4, createdAt: "2026-06-23T00:00:00Z" };
    bindings.listBookmarks.mockResolvedValue([bookmark]);
    bindings.addBookmark.mockResolvedValue(bookmark);

    await expect(listBooks()).resolves.toEqual(summaries);
    await expect(openBook("book-1")).resolves.toEqual(book);
    await expect(relinkBook("book-1")).resolves.toEqual(book);
    await expect(removeBook("book-1")).resolves.toBe(true);
    await expect(renameBook("book-1", "Renamed")).resolves.toEqual({
      ...summaries[0],
      title: "Renamed",
    });
    await saveReadingPosition("book-1", 3, 10);
    await expect(
      saveBookSegments(
        "book-1",
        [
          {
            ordinal: 1,
            location: "page:1",
            headingPath: "1章",
            text: "page text",
          },
        ],
        10,
      ),
    ).resolves.toBe(2);
    await expect(searchBook("book-1", "page")).resolves.toEqual([
      { pageNumber: 2, excerpt: "match", matchCount: 1 },
    ]);
    await expect(searchLibrary("page")).resolves.toEqual([libraryHit]);
    await expect(pendingIndexBooks()).resolves.toEqual(pending);
    await expect(listBookmarks("book-1")).resolves.toEqual([bookmark]);
    await expect(addBookmark("book-1", 4, 10)).resolves.toEqual(bookmark);
    await removeBookmark("book-1", 4);
    await saveBookCover("book-1", "data:image/png;base64,cover");
    await markBookCoverFailed("book-1");

    expect(bindings.saveReadingPosition).toHaveBeenCalledWith("book-1", 3, 10);
    expect(bindings.saveBookSegments).toHaveBeenCalledWith(
      "book-1",
      [
        {
          ordinal: 1,
          location: "page:1",
          headingPath: "1章",
          text: "page text",
        },
      ],
      10,
    );
    expect(bindings.searchBook).toHaveBeenCalledWith("book-1", "page");
    expect(bindings.searchLibrary).toHaveBeenCalledWith("page");
    expect(bindings.listBookmarks).toHaveBeenCalledWith("book-1");
    expect(bindings.addBookmark).toHaveBeenCalledWith("book-1", 4, 10);
    expect(bindings.removeBookmark).toHaveBeenCalledWith("book-1", 4);
    expect(bindings.renameBook).toHaveBeenCalledWith("book-1", "Renamed");
    expect(bindings.saveBookCover).toHaveBeenCalledWith("book-1", "data:image/png;base64,cover");
    expect(bindings.markBookCoverFailed).toHaveBeenCalledWith("book-1");
  });
});
