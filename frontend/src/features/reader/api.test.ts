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

    await expect(listBookmarks("book-1", "pdf")).resolves.toEqual([]);
    await expect(searchBook("book-1", "missing")).resolves.toEqual([]);
  });

  it("delegates reading state and search", async () => {
    bindings.searchBook.mockResolvedValue([{ pageNumber: 2, excerpt: "match", matchCount: 1 }]);

    await saveReadingPosition("book-1", 3, 10);
    await saveReadingPosition("book-2", 2, 9, "epubcfi(/6/4!/4/2/1:0)");
    await saveBindingDirection("book-1", "rtl");
    await expect(searchBook("book-1", "page")).resolves.toEqual([
      { pageNumber: 2, excerpt: "match", matchCount: 1 },
    ]);

    expect(bindings.saveReadingPosition).toHaveBeenCalledWith("book-1", 3, 10, "");
    expect(bindings.saveReadingPosition).toHaveBeenCalledWith(
      "book-2",
      2,
      9,
      "epubcfi(/6/4!/4/2/1:0)",
    );
    expect(bindings.saveBindingDirection).toHaveBeenCalledWith("book-1", "rtl");
    expect(bindings.searchBook).toHaveBeenCalledWith("book-1", "page");
  });

  it("turns bookmark locations into a union of the two formats", async () => {
    const createdAt = "2026-06-23T00:00:00Z";
    const epubPlace = { section: 3, cfi: "epubcfi(/6/6!/4/2/1:0)", progress: 0.4 };
    bindings.listBookmarks.mockResolvedValue([
      { location: { pdf: { page: 4 } }, createdAt },
      { location: { epub: epubPlace }, createdAt },
    ]);
    bindings.addBookmark.mockResolvedValue({ location: { pdf: { page: 4 } }, createdAt });

    await expect(listBookmarks("book-1", "pdf")).resolves.toEqual([
      { location: { kind: "pdf", page: 4 }, createdAt },
    ]);
    await expect(listBookmarks("book-1", "epub")).resolves.toEqual([
      { location: { kind: "epub", ...epubPlace }, createdAt },
    ]);
    await expect(addBookmark("book-1", { kind: "pdf", page: 4 }, 10)).resolves.toEqual({
      location: { kind: "pdf", page: 4 },
      createdAt,
    });
    await removeBookmark("book-1", { kind: "pdf", page: 4 });
    await addBookmark("book-2", { kind: "epub", ...epubPlace }, 9);
    await removeBookmark("book-2", { kind: "epub", ...epubPlace });

    expect(bindings.addBookmark).toHaveBeenCalledWith("book-1", {
      location: { pdf: { page: 4 } },
      pageCount: 10,
    });
    expect(bindings.removeBookmark).toHaveBeenCalledWith("book-1", { pdf: { page: 4 } });
    expect(bindings.addBookmark).toHaveBeenCalledWith("book-2", {
      location: { epub: epubPlace },
      pageCount: 9,
    });
    expect(bindings.removeBookmark).toHaveBeenCalledWith("book-2", { epub: epubPlace });
  });

  it("rejects a bookmark without a location", async () => {
    bindings.listBookmarks.mockResolvedValue([{ location: {}, createdAt: "" }]);

    await expect(listBookmarks("book-1", "pdf")).rejects.toThrow("A bookmark has no location.");
  });

  it("turns highlight locations into a union and checks their colors", async () => {
    const rects = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }];
    const createdAt = "2026-11-25T00:00:00Z";
    const pdfHighlight = {
      id: 3,
      color: "green",
      text: "keep this",
      location: { pdf: { page: 2, rects } },
      createdAt,
    };
    const epubHighlight = {
      id: 4,
      color: "pink",
      text: "and this",
      location: { epub: { section: 1, cfi: "epubcfi(/6/4!/4/2,/1:0,/1:4)" } },
      createdAt,
    };
    bindings.listHighlights
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce([pdfHighlight, epubHighlight])
      .mockResolvedValueOnce([{ ...pdfHighlight, color: "red" }]);
    bindings.addHighlight.mockResolvedValue({
      ...pdfHighlight,
      location: { pdf: { page: 2, rects: null } },
    });
    const pdfLocation = { kind: "pdf" as const, page: 2, rects };

    await expect(listHighlights("book-1", "pdf")).resolves.toEqual([]);
    await expect(listHighlights("book-1", "pdf")).resolves.toEqual([
      { id: 3, color: "green", text: "keep this", location: pdfLocation, createdAt },
    ]);
    await expect(listHighlights("book-1", "pdf")).rejects.toThrow("Unknown highlight color: red");
    await expect(
      addHighlight("book-1", {
        location: pdfLocation,
        pageCount: 10,
        color: "green",
        text: "keep this",
      }),
    ).resolves.toEqual({
      id: 3,
      color: "green",
      text: "keep this",
      location: pdfLocation,
      createdAt,
    });
    bindings.changeHighlightColor.mockResolvedValue({ ...pdfHighlight, color: "purple" });
    await expect(changeHighlightColor("book-1", 3, "purple")).resolves.toBe("purple");
    await removeHighlight("book-1", 3);

    expect(bindings.addHighlight).toHaveBeenCalledWith("book-1", {
      location: { pdf: { page: 2, rects } },
      pageCount: 10,
      color: "green",
      text: "keep this",
    });
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
