import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openPDF: vi.fn(),
  relinkPDF: vi.fn(),
  saveBookCover: vi.fn(),
  saveReadingPosition: vi.fn(),
  startMockChat: vi.fn(),
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock("../../../wailsjs/go/main/App", () => ({
  ListBooks: bindings.listBooks,
  MarkBookCoverFailed: bindings.markBookCoverFailed,
  OpenBook: bindings.openBook,
  OpenPDF: bindings.openPDF,
  RelinkPDF: bindings.relinkPDF,
  SaveBookCover: bindings.saveBookCover,
  SaveReadingPosition: bindings.saveReadingPosition,
  StartMockChat: bindings.startMockChat,
}));

vi.mock("../../../wailsjs/runtime/runtime", () => ({
  EventsOn: bindings.eventsOn,
  EventsOff: bindings.eventsOff,
}));

import {
  listBooks,
  markBookCoverFailed,
  onAnswerDelta,
  openBook,
  openPDF,
  relinkPDF,
  saveBookCover,
  saveReadingPosition,
  startMockChat,
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
    bindings.startMockChat.mockResolvedValue(undefined);

    await expect(openPDF()).resolves.toEqual(book);
    await expect(startMockChat(request)).resolves.toBeUndefined();
    expect(bindings.startMockChat).toHaveBeenCalledWith(request);
  });

  it("delegates library persistence operations", async () => {
    const summaries = [{ id: "book-1" }];
    const book = { id: "book-1", url: "/book/1" };
    bindings.listBooks.mockResolvedValue(summaries);
    bindings.openBook.mockResolvedValue(book);
    bindings.relinkPDF.mockResolvedValue(book);

    await expect(listBooks()).resolves.toEqual(summaries);
    await expect(openBook("book-1")).resolves.toEqual(book);
    await expect(relinkPDF("book-1")).resolves.toEqual(book);
    await saveReadingPosition("book-1", 3, 10);
    await saveBookCover("book-1", "data:image/png;base64,cover");
    await markBookCoverFailed("book-1");

    expect(bindings.saveReadingPosition).toHaveBeenCalledWith("book-1", 3, 10);
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
