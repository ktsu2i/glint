import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  addHighlight: vi.fn(),
  changeHighlightColor: vi.fn(),
  listBookmarks: vi.fn(),
  listHighlights: vi.fn(),
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openBookFile: vi.fn(),
  relinkBook: vi.fn(),
  removeBook: vi.fn(),
  removeBookmark: vi.fn(),
  removeHighlight: vi.fn(),
  renameBook: vi.fn(),
  saveBookCover: vi.fn(),
  saveBookSegments: vi.fn(),
  pendingIndexBooks: vi.fn(),
  saveReadingPosition: vi.fn(),
  saveBindingDirection: vi.fn(),
  searchBook: vi.fn(),
  searchLibrary: vi.fn(),
  getAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
  getReaderSettings: vi.fn(),
  saveReaderSettings: vi.fn(),
}));

vi.mock("../../../bindings/github.com/kaito/glint/internal/app/booksservice", () => ({
  AddBookmark: bindings.addBookmark,
  AddHighlight: bindings.addHighlight,
  ChangeHighlightColor: bindings.changeHighlightColor,
  ListBookmarks: bindings.listBookmarks,
  ListHighlights: bindings.listHighlights,
  ListBooks: bindings.listBooks,
  MarkBookCoverFailed: bindings.markBookCoverFailed,
  OpenBook: bindings.openBook,
  OpenBookFile: bindings.openBookFile,
  RelinkBook: bindings.relinkBook,
  RemoveBook: bindings.removeBook,
  RemoveBookmark: bindings.removeBookmark,
  RemoveHighlight: bindings.removeHighlight,
  RenameBook: bindings.renameBook,
  SaveBookCover: bindings.saveBookCover,
  SaveBookSegments: bindings.saveBookSegments,
  PendingIndexBooks: bindings.pendingIndexBooks,
  SaveReadingPosition: bindings.saveReadingPosition,
  SaveBindingDirection: bindings.saveBindingDirection,
  SearchBook: bindings.searchBook,
  SearchLibrary: bindings.searchLibrary,
}));

vi.mock("../../../bindings/github.com/kaito/glint/internal/app/settingsservice", () => ({
  GetAppearanceSettings: bindings.getAppearanceSettings,
  SaveAppearanceSettings: bindings.saveAppearanceSettings,
  GetReaderSettings: bindings.getReaderSettings,
  SaveReaderSettings: bindings.saveReaderSettings,
}));

import {
  addBookmark,
  addHighlight,
  changeHighlightColor,
  getAppearanceSettings,
  getReaderSettings,
  listBooks,
  listBookmarks,
  listHighlights,
  markBookCoverFailed,
  openBook,
  openBookFile,
  relinkBook,
  removeBook,
  removeBookmark,
  removeHighlight,
  renameBook,
  saveBookCover,
  saveBookSegments,
  pendingIndexBooks,
  saveAppearanceSettings,
  saveBindingDirection,
  saveReaderSettings,
  saveReadingPosition,
  searchBook,
  searchLibrary,
} from "./backend";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backend facade", () => {
  it("normalizes nullable slices from v3 bindings to empty lists", async () => {
    bindings.listBookmarks.mockResolvedValue(null);
    bindings.pendingIndexBooks.mockResolvedValue(null);
    bindings.searchBook.mockResolvedValue(null);

    await expect(listBookmarks("book-1")).resolves.toEqual([]);
    await expect(pendingIndexBooks()).resolves.toEqual([]);
    await expect(searchBook("book-1", "missing")).resolves.toEqual([]);
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
    const bookmark = { pageNumber: 4, cfi: "", progress: 0, createdAt: "2026-06-23T00:00:00Z" };
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
    await saveReadingPosition("book-2", 2, 9, "epubcfi(/6/4!/4/2/1:0)");
    await saveBindingDirection("book-1", "rtl");
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
    await addBookmark("book-2", 3, 9, { cfi: "epubcfi(/6/6!/4/2/1:0)", progress: 0.4 });
    await removeBookmark("book-2", 3, "epubcfi(/6/6!/4/2/1:0)");
    await saveBookCover("book-1", "data:image/png;base64,cover");
    await markBookCoverFailed("book-1");

    // A PDF position goes out with an empty CFI.
    expect(bindings.saveReadingPosition).toHaveBeenCalledWith("book-1", 3, 10, "");
    expect(bindings.saveReadingPosition).toHaveBeenCalledWith(
      "book-2",
      2,
      9,
      "epubcfi(/6/4!/4/2/1:0)",
    );
    expect(bindings.saveBindingDirection).toHaveBeenCalledWith("book-1", "rtl");
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
    expect(bindings.addBookmark).toHaveBeenCalledWith("book-1", {
      pageNumber: 4,
      pageCount: 10,
      cfi: "",
      progress: 0,
    });
    expect(bindings.removeBookmark).toHaveBeenCalledWith("book-1", 4, "");
    expect(bindings.addBookmark).toHaveBeenCalledWith("book-2", {
      pageNumber: 3,
      pageCount: 9,
      cfi: "epubcfi(/6/6!/4/2/1:0)",
      progress: 0.4,
    });
    expect(bindings.removeBookmark).toHaveBeenCalledWith("book-2", 3, "epubcfi(/6/6!/4/2/1:0)");
    expect(bindings.renameBook).toHaveBeenCalledWith("book-1", "Renamed");
    expect(bindings.saveBookCover).toHaveBeenCalledWith("book-1", "data:image/png;base64,cover");
    expect(bindings.markBookCoverFailed).toHaveBeenCalledWith("book-1");
  });

  it("passes highlights through and treats a missing list as empty", async () => {
    const highlight = {
      id: 3,
      pageNumber: 2,
      color: "green",
      text: "keep this",
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }],
      createdAt: "2026-11-25T00:00:00Z",
    };
    bindings.listHighlights.mockResolvedValueOnce(null).mockResolvedValueOnce([highlight]);
    bindings.addHighlight.mockResolvedValue(highlight);
    const { id: _id, createdAt: _createdAt, ...rest } = highlight;
    const input = { ...rest, color: "green" as const, pageCount: 10 };

    await expect(listHighlights("book-1")).resolves.toEqual([]);
    await expect(listHighlights("book-1")).resolves.toEqual([highlight]);
    await expect(addHighlight("book-1", input)).resolves.toEqual(highlight);
    bindings.changeHighlightColor.mockResolvedValue({ ...highlight, color: "purple" });
    await expect(changeHighlightColor("book-1", 3, "purple")).resolves.toMatchObject({
      color: "purple",
    });
    await removeHighlight("book-1", 3);

    // A PDF highlight goes out with an empty CFI.
    expect(bindings.addHighlight).toHaveBeenCalledWith("book-1", { ...input, cfi: "" });
    expect(bindings.changeHighlightColor).toHaveBeenCalledWith("book-1", 3, "purple");
    expect(bindings.removeHighlight).toHaveBeenCalledWith("book-1", 3);
  });

  it("passes the reader settings through", async () => {
    const reader = { epubFontScale: 120, epubLayout: "single" as const };
    bindings.getReaderSettings.mockResolvedValue(reader);
    bindings.saveReaderSettings.mockResolvedValue(reader);

    await expect(getReaderSettings()).resolves.toEqual(reader);
    await expect(saveReaderSettings(reader)).resolves.toEqual(reader);
    expect(bindings.saveReaderSettings).toHaveBeenCalledWith(reader);
  });
});
