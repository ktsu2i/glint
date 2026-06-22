import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openPDF: vi.fn(),
  relinkPDF: vi.fn(),
  removeBook: vi.fn(),
  renameBook: vi.fn(),
  saveBookCover: vi.fn(),
  saveBookPages: vi.fn(),
  saveReadingPosition: vi.fn(),
  searchBook: vi.fn(),
  getAppearanceSettings: vi.fn(),
  getLLMSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
  saveLLMSettings: vi.fn(),
  startChat: vi.fn(),
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock("../../../wailsjs/go/books/Service", () => ({
  ListBooks: bindings.listBooks,
  MarkBookCoverFailed: bindings.markBookCoverFailed,
  OpenBook: bindings.openBook,
  OpenPDF: bindings.openPDF,
  RelinkPDF: bindings.relinkPDF,
  RemoveBook: bindings.removeBook,
  RenameBook: bindings.renameBook,
  SaveBookCover: bindings.saveBookCover,
  SaveBookPages: bindings.saveBookPages,
  SaveReadingPosition: bindings.saveReadingPosition,
  SearchBook: bindings.searchBook,
}));

vi.mock("../../../wailsjs/go/chat/Service", () => ({
  StartChat: bindings.startChat,
}));

vi.mock("../../../wailsjs/go/settings/Service", () => ({
  GetAppearanceSettings: bindings.getAppearanceSettings,
  GetLLMSettings: bindings.getLLMSettings,
  SaveAppearanceSettings: bindings.saveAppearanceSettings,
  SaveLLMSettings: bindings.saveLLMSettings,
}));

vi.mock("../../../wailsjs/runtime/runtime", () => ({
  EventsOn: bindings.eventsOn,
  EventsOff: bindings.eventsOff,
}));

import {
  getAppearanceSettings,
  listBooks,
  getLLMSettings,
  markBookCoverFailed,
  onAnswerDelta,
  openBook,
  openPDF,
  relinkPDF,
  removeBook,
  renameBook,
  saveBookCover,
  saveBookPages,
  saveAppearanceSettings,
  saveReadingPosition,
  searchBook,
  saveLLMSettings,
  startChat,
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

  it("delegates LLM settings without exposing credential implementation", async () => {
    const settings = {
      provider: "openrouter", model: "provider/model", zdr: true,
      hasApiKey: true, configured: true,
    };
    const request = {
      model: "provider/model", apiKey: "new-key", zdr: true, clearApiKey: false,
    };
    bindings.getLLMSettings.mockResolvedValue(settings);
    bindings.saveLLMSettings.mockResolvedValue(settings);

    await expect(getLLMSettings()).resolves.toEqual(settings);
    await expect(saveLLMSettings(request)).resolves.toEqual(settings);
    expect(bindings.saveLLMSettings).toHaveBeenCalledWith(request);
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
    await saveBookCover("book-1", "data:image/png;base64,cover");
    await markBookCoverFailed("book-1");

    expect(bindings.saveReadingPosition).toHaveBeenCalledWith("book-1", 3, 10);
    expect(bindings.saveBookPages).toHaveBeenCalledWith("book-1", [{
      pageNumber: 1, text: "page text", width: 612, height: 792,
    }], 10);
    expect(bindings.searchBook).toHaveBeenCalledWith("book-1", "page");
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
