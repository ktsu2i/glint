import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  openPDF: vi.fn(),
  startMockChat: vi.fn(),
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock("../../../wailsjs/go/main/App", () => ({
  OpenPDF: bindings.openPDF,
  StartMockChat: bindings.startMockChat,
}));

vi.mock("../../../wailsjs/runtime/runtime", () => ({
  EventsOn: bindings.eventsOn,
  EventsOff: bindings.eventsOff,
}));

import { onAnswerDelta, openPDF, startMockChat } from "./backend";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("backend facade", () => {
  it("delegates PDF selection and chat requests to Wails bindings", async () => {
    const book = { name: "book.pdf", url: "/book/1", size: 42 };
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

  it("registers and unregisters answer delta listeners", () => {
    const callback = vi.fn();
    const unsubscribe = onAnswerDelta(callback);

    expect(bindings.eventsOn).toHaveBeenCalledWith("chat:delta", callback);
    unsubscribe();
    expect(bindings.eventsOff).toHaveBeenCalledWith("chat:delta");
  });
});
