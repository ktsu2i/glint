import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  addHighlight: vi.fn(),
  changeHighlightColor: vi.fn(),
  listBookmarks: vi.fn(),
  listHighlights: vi.fn(),
  removeBookmark: vi.fn(),
  removeHighlight: vi.fn(),
  saveReadingPosition: vi.fn(),
  saveBindingDirection: vi.fn(),
  searchBook: vi.fn(),
  getReaderSettings: vi.fn(),
  saveReaderSettings: vi.fn(),
}));

vi.mock("../../../bindings/github.com/ktsu2i/glint/internal/app/booksservice", () => ({
  AddBookmark: bindings.addBookmark,
  AddHighlight: bindings.addHighlight,
  ChangeHighlightColor: bindings.changeHighlightColor,
  ListBookmarks: bindings.listBookmarks,
  ListHighlights: bindings.listHighlights,
  RemoveBookmark: bindings.removeBookmark,
  RemoveHighlight: bindings.removeHighlight,
  SaveReadingPosition: bindings.saveReadingPosition,
  SaveBindingDirection: bindings.saveBindingDirection,
  SearchBook: bindings.searchBook,
}));

vi.mock("../../../bindings/github.com/ktsu2i/glint/internal/app/settingsservice", () => ({
  GetReaderSettings: bindings.getReaderSettings,
  SaveReaderSettings: bindings.saveReaderSettings,
}));

import {
  addBookmark,
  addHighlight,
  changeHighlightColor,
  getReaderSettings,
  listBookmarks,
  listHighlights,
  removeBookmark,
  removeHighlight,
  saveBindingDirection,
  saveReaderSettings,
  saveReadingPosition,
  searchBook,
} from "./api";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reader api", () => {
  it("normalizes nullable slices from v3 bindings to empty lists", async () => {
    bindings.listBookmarks.mockResolvedValue(null);
    bindings.searchBook.mockResolvedValue(null);

    await expect(listBookmarks("book-1")).resolves.toEqual([]);
    await expect(searchBook("book-1", "missing")).resolves.toEqual([]);
  });

  it("delegates reading state, search, and bookmarks", async () => {
    bindings.searchBook.mockResolvedValue([{ pageNumber: 2, excerpt: "match", matchCount: 1 }]);
    const bookmark = { pageNumber: 4, cfi: "", progress: 0, createdAt: "2026-06-23T00:00:00Z" };
    bindings.listBookmarks.mockResolvedValue([bookmark]);
    bindings.addBookmark.mockResolvedValue(bookmark);

    await saveReadingPosition("book-1", 3, 10);
    await saveReadingPosition("book-2", 2, 9, "epubcfi(/6/4!/4/2/1:0)");
    await saveBindingDirection("book-1", "rtl");
    await expect(searchBook("book-1", "page")).resolves.toEqual([
      { pageNumber: 2, excerpt: "match", matchCount: 1 },
    ]);
    await expect(listBookmarks("book-1")).resolves.toEqual([bookmark]);
    await expect(addBookmark("book-1", 4, 10)).resolves.toEqual(bookmark);
    await removeBookmark("book-1", 4);
    await addBookmark("book-2", 3, 9, { cfi: "epubcfi(/6/6!/4/2/1:0)", progress: 0.4 });
    await removeBookmark("book-2", 3, "epubcfi(/6/6!/4/2/1:0)");

    expect(bindings.saveReadingPosition).toHaveBeenCalledWith("book-1", 3, 10, "");
    expect(bindings.saveReadingPosition).toHaveBeenCalledWith(
      "book-2",
      2,
      9,
      "epubcfi(/6/4!/4/2/1:0)",
    );
    expect(bindings.saveBindingDirection).toHaveBeenCalledWith("book-1", "rtl");
    expect(bindings.searchBook).toHaveBeenCalledWith("book-1", "page");
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
