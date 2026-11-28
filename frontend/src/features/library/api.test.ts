import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openBookFile: vi.fn(),
  pendingIndexBooks: vi.fn(),
  relinkBook: vi.fn(),
  removeBook: vi.fn(),
  renameBook: vi.fn(),
  saveBookCover: vi.fn(),
  saveBookSegments: vi.fn(),
  searchLibrary: vi.fn(),
  getLibrarySettings: vi.fn(),
  saveLibrarySettings: vi.fn(),
}));

vi.mock("../../../bindings/github.com/ktsu2i/glint/internal/app/booksservice", () => ({
  ListBooks: bindings.listBooks,
  MarkBookCoverFailed: bindings.markBookCoverFailed,
  OpenBook: bindings.openBook,
  OpenBookFile: bindings.openBookFile,
  PendingIndexBooks: bindings.pendingIndexBooks,
  RelinkBook: bindings.relinkBook,
  RemoveBook: bindings.removeBook,
  RenameBook: bindings.renameBook,
  SaveBookCover: bindings.saveBookCover,
  SaveBookSegments: bindings.saveBookSegments,
  SearchLibrary: bindings.searchLibrary,
}));

vi.mock("../../../bindings/github.com/ktsu2i/glint/internal/app/settingsservice", () => ({
  GetLibrarySettings: bindings.getLibrarySettings,
  SaveLibrarySettings: bindings.saveLibrarySettings,
}));

import {
  getLibrarySettings,
  listBooks,
  markBookCoverFailed,
  openBook,
  openBookFile,
  pendingIndexBooks,
  relinkBook,
  removeBook,
  renameBook,
  saveBookCover,
  saveBookSegments,
  saveLibrarySettings,
  searchLibrary,
} from "./api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("library api", () => {
  it("treats a missing list of books to index as empty", async () => {
    bindings.pendingIndexBooks.mockResolvedValue(null);

    await expect(pendingIndexBooks()).resolves.toEqual([]);
  });

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
    const libraryHit = {
      book: { id: "book-1", title: "Book", coverUrl: "/cover/1", available: true },
      totalMatches: 3,
      pages: [{ pageNumber: 7, excerpt: "library hit", matchCount: 2 }],
    };
    bindings.searchLibrary.mockResolvedValue([libraryHit]);

    await expect(listBooks()).resolves.toEqual(summaries);
    await expect(openBook("book-1")).resolves.toEqual(book);
    await expect(relinkBook("book-1")).resolves.toEqual(book);
    await expect(removeBook("book-1")).resolves.toBe(true);
    await expect(renameBook("book-1", "Renamed")).resolves.toEqual({
      ...summaries[0],
      title: "Renamed",
    });
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
    await expect(searchLibrary("page")).resolves.toEqual([libraryHit]);
    await expect(pendingIndexBooks()).resolves.toEqual(pending);
    await saveBookCover("book-1", "data:image/png;base64,cover");
    await markBookCoverFailed("book-1");

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
    expect(bindings.searchLibrary).toHaveBeenCalledWith("page");
    expect(bindings.renameBook).toHaveBeenCalledWith("book-1", "Renamed");
    expect(bindings.saveBookCover).toHaveBeenCalledWith("book-1", "data:image/png;base64,cover");
    expect(bindings.markBookCoverFailed).toHaveBeenCalledWith("book-1");
  });

  it("passes the library settings through", async () => {
    const library = { sortOrder: "title" };
    bindings.getLibrarySettings.mockResolvedValue(library);
    bindings.saveLibrarySettings.mockResolvedValue(library);

    await expect(getLibrarySettings()).resolves.toEqual(library);
    await expect(saveLibrarySettings(library)).resolves.toEqual(library);
    expect(bindings.saveLibrarySettings).toHaveBeenCalledWith(library);
  });
});
