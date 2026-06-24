import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  listBookmarks: vi.fn(),
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openPDF: vi.fn(),
  relinkPDF: vi.fn(),
  removeBook: vi.fn(),
  removeBookmark: vi.fn(),
  renameBook: vi.fn(),
  saveBookCover: vi.fn(),
  saveBookPages: vi.fn(),
  saveReadingPosition: vi.fn(),
  searchBook: vi.fn(),
  searchLibrary: vi.fn(),
  getAppearanceSettings: vi.fn(),
  getLLMConfig: vi.fn(),
  saveAppearanceSettings: vi.fn(),
  upsertProviderSettings: vi.fn(),
  deleteProviderSettings: vi.fn(),
  setActiveProvider: vi.fn(),
  startChat: vi.fn(),
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock("../../../wailsjs/go/books/Service", () => ({
  AddBookmark: bindings.addBookmark,
  ListBookmarks: bindings.listBookmarks,
  ListBooks: bindings.listBooks,
  MarkBookCoverFailed: bindings.markBookCoverFailed,
  OpenBook: bindings.openBook,
  OpenPDF: bindings.openPDF,
  RelinkPDF: bindings.relinkPDF,
  RemoveBook: bindings.removeBook,
  RemoveBookmark: bindings.removeBookmark,
  RenameBook: bindings.renameBook,
  SaveBookCover: bindings.saveBookCover,
  SaveBookPages: bindings.saveBookPages,
  SaveReadingPosition: bindings.saveReadingPosition,
  SearchBook: bindings.searchBook,
  SearchLibrary: bindings.searchLibrary,
}));

vi.mock("../../../wailsjs/go/chat/Service", () => ({
  StartChat: bindings.startChat,
}));

vi.mock("../../../wailsjs/go/settings/Service", () => ({
  GetAppearanceSettings: bindings.getAppearanceSettings,
  GetLLMConfig: bindings.getLLMConfig,
  SaveAppearanceSettings: bindings.saveAppearanceSettings,
  UpsertProviderSettings: bindings.upsertProviderSettings,
  DeleteProviderSettings: bindings.deleteProviderSettings,
  SetActiveProvider: bindings.setActiveProvider,
}));

vi.mock("../../../wailsjs/runtime/runtime", () => ({
  EventsOn: bindings.eventsOn,
  EventsOff: bindings.eventsOff,
}));

import {
  addBookmark,
  deleteProviderSettings,
  getAppearanceSettings,
  getLLMConfig,
  listBooks,
  listBookmarks,
  markBookCoverFailed,
  onAnswerDelta,
  openBook,
  openPDF,
  relinkPDF,
  removeBook,
  removeBookmark,
  renameBook,
  saveBookCover,
  saveBookPages,
  saveAppearanceSettings,
  saveReadingPosition,
  searchBook,
  searchLibrary,
  setActiveProvider,
  startChat,
  upsertProviderSettings,
} from "./backend";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backend facade", () => {
  it("delegates PDF selection and chat requests to Wails bindings", async () => {
    const book = {
      id: "book-1", title: "Book", name: "book.pdf", url: "/book/1", size: 42,
      initialPage: 1, coverStatus: "ready",
    };
    const request = {
      requestId: "request-1",
      question: "why?",
      contextText: "context",
      bookName: book.name,
      pageNumber: 2,
    };
    bindings.openPDF.mockResolvedValue(book);
    bindings.startChat.mockResolvedValue(undefined);

    await expect(openPDF()).resolves.toEqual(book);
    await expect(startChat(request)).resolves.toBeUndefined();
    expect(bindings.startChat).toHaveBeenCalledWith(request);
  });

  it("delegates LLM config without exposing credential implementation", async () => {
    const config = {
      activeProviderId: "openrouter",
      providers: [{
        providerId: "openrouter", model: "provider/model",
        options: { zdr: true }, hasApiKey: true, configured: true, isActive: true,
      }],
      catalog: [{
        id: "openrouter", displayName: "OpenRouter", authKind: "bearer",
        optionSchema: [], capabilities: { streaming: true, tools: false, images: false },
      }],
    };
    const upsertRequest = {
      providerId: "openrouter", model: "provider/model",
      options: { zdr: true }, apiKey: "new-key", activate: true,
    };
    bindings.getLLMConfig.mockResolvedValue(config);
    bindings.upsertProviderSettings.mockResolvedValue(config);
    bindings.deleteProviderSettings.mockResolvedValue(config);
    bindings.setActiveProvider.mockResolvedValue(config);

    await expect(getLLMConfig()).resolves.toEqual(config);
    await expect(upsertProviderSettings(upsertRequest)).resolves.toEqual(config);
    expect(bindings.upsertProviderSettings).toHaveBeenCalledWith(upsertRequest);
    await expect(deleteProviderSettings("openrouter")).resolves.toEqual(config);
    expect(bindings.deleteProviderSettings).toHaveBeenCalledWith("openrouter");
    await expect(setActiveProvider("openrouter")).resolves.toEqual(config);
    expect(bindings.setActiveProvider).toHaveBeenCalledWith("openrouter");
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
    bindings.relinkPDF.mockResolvedValue(book);
    bindings.removeBook.mockResolvedValue(true);
    bindings.renameBook.mockResolvedValue({ ...summaries[0], title: "Renamed" });
    bindings.saveBookPages.mockResolvedValue(2);
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
    await expect(relinkPDF("book-1")).resolves.toEqual(book);
    await expect(removeBook("book-1")).resolves.toBe(true);
    await expect(renameBook("book-1", "Renamed")).resolves.toEqual({
      ...summaries[0],
      title: "Renamed",
    });
    await saveReadingPosition("book-1", 3, 10);
    await expect(saveBookPages("book-1", [{
      pageNumber: 1, text: "page text", width: 612, height: 792,
    }], 10)).resolves.toBe(2);
    await expect(searchBook("book-1", "page")).resolves.toEqual([
      { pageNumber: 2, excerpt: "match", matchCount: 1 },
    ]);
    await expect(searchLibrary("page")).resolves.toEqual([libraryHit]);
    await expect(listBookmarks("book-1")).resolves.toEqual([bookmark]);
    await expect(addBookmark("book-1", 4, 10)).resolves.toEqual(bookmark);
    await removeBookmark("book-1", 4);
    await saveBookCover("book-1", "data:image/png;base64,cover");
    await markBookCoverFailed("book-1");

    expect(bindings.saveReadingPosition).toHaveBeenCalledWith("book-1", 3, 10);
    expect(bindings.saveBookPages).toHaveBeenCalledWith("book-1", [{
      pageNumber: 1, text: "page text", width: 612, height: 792,
    }], 10);
    expect(bindings.searchBook).toHaveBeenCalledWith("book-1", "page");
    expect(bindings.searchLibrary).toHaveBeenCalledWith("page");
    expect(bindings.listBookmarks).toHaveBeenCalledWith("book-1");
    expect(bindings.addBookmark).toHaveBeenCalledWith("book-1", 4, 10);
    expect(bindings.removeBookmark).toHaveBeenCalledWith("book-1", 4);
    expect(bindings.renameBook).toHaveBeenCalledWith("book-1", "Renamed");
    expect(bindings.saveBookCover).toHaveBeenCalledWith("book-1", "data:image/png;base64,cover");
    expect(bindings.markBookCoverFailed).toHaveBeenCalledWith("book-1");
  });

  it("registers and unregisters answer delta listeners", () => {
    const callback = vi.fn();
    const unsubscribe = onAnswerDelta(callback);

    expect(bindings.eventsOn).toHaveBeenCalledWith("chat:delta", callback);
    unsubscribe();
    expect(bindings.eventsOff).toHaveBeenCalledWith("chat:delta");
  });
});
