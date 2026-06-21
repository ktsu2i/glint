import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  listener: undefined as ((delta: {
    requestId: string;
    content?: string;
    done: boolean;
    error?: string;
  }) => void) | undefined,
  unsubscribe: vi.fn(),
  getLLMSettings: vi.fn(),
  onAnswerDelta: vi.fn(),
  saveLLMSettings: vi.fn(),
  startChat: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  getLLMSettings: backend.getLLMSettings,
  onAnswerDelta: backend.onAnswerDelta,
  saveLLMSettings: backend.saveLLMSettings,
  startChat: backend.startChat,
}));

import { ChatSidebar } from "./ChatSidebar";

beforeEach(() => {
  vi.clearAllMocks();
  backend.listener = undefined;
  backend.onAnswerDelta.mockImplementation((listener) => {
    backend.listener = listener;
    return backend.unsubscribe;
  });
  backend.getLLMSettings.mockResolvedValue({
    provider: "openrouter",
    model: "provider/model",
    zdr: true,
    hasApiKey: true,
    configured: true,
  });
  backend.startChat.mockResolvedValue(undefined);
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "request-1") });
});

describe("ChatSidebar", () => {
  it("renders the empty-context state, ignores empty submissions, and unsubscribes", async () => {
    const { container, unmount } = render(
      <ChatSidebar context={{ bookName: "", pageNumber: 0, text: "" }} />,
    );

    await screen.findByText("OpenRouter");
    expect(screen.getByText("PDF未選択")).toBeTruthy();
    expect(screen.getByText("文脈なし")).toBeTruthy();
    expect(screen.getByRole("switch")).toBeTruthy();
    fireEvent.submit(container.querySelector("form")!);
    expect(backend.startChat).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("unused"));
    unmount();
    expect(backend.unsubscribe).toHaveBeenCalledOnce();
  });

  it("sends context, streams matching deltas, and handles keyboard submission", async () => {
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 7, text: "  page context  " }}
      />,
    );
    const textarea = screen.getByPlaceholderText("このページについて質問する…");

    await screen.findByText("OpenRouter");

    fireEvent.change(textarea, { target: { value: "  Explain this  " } });
    fireEvent.keyDown(textarea, { key: "A", shiftKey: false });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(backend.startChat).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });

    await waitFor(() => {
      expect(backend.startChat).toHaveBeenCalledWith({
        requestId: "request-1",
        question: "Explain this",
        contextText: "page context",
        bookName: "Guide.pdf",
        pageNumber: 7,
      });
    });
    expect(screen.getByText("応答中")).toBeTruthy();
    expect(container.querySelector(".typing-indicator")).toBeTruthy();

    act(() => backend.listener?.({ requestId: "other", content: "ignored", done: false }));
    act(() => backend.listener?.({ requestId: "request-1", done: false }));
    act(() => backend.listener?.({ requestId: "request-1", content: "First", done: false }));
    act(() => backend.listener?.({
      requestId: "request-1",
      content: " second",
      error: "provider failed",
      done: true,
    }));

    expect(screen.getByText("First second")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("provider failed");
    expect(screen.getByText("送信")).toBeTruthy();
  });

  it("omits disabled context and blocks a second request while sending", async () => {
    let resolveRequest!: () => void;
    backend.startChat.mockReturnValue(new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }));
    const { container } = render(
      <ChatSidebar context={{ bookName: "Guide.pdf", pageNumber: 2, text: "context" }} />,
    );

    await screen.findByText("OpenRouter");

    fireEvent.click(screen.getByRole("switch"));
    expect(screen.getByText("添付しない")).toBeTruthy();
    const textarea = screen.getByPlaceholderText("このページについて質問する…");
    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(backend.startChat).toHaveBeenCalledOnce());
    expect(backend.startChat.mock.calls[0][0].contextText).toBe("");

    fireEvent.change(textarea, { target: { value: "second" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(backend.startChat).toHaveBeenCalledOnce();
    resolveRequest();
  });

  it.each([
    [new Error("network down"), "network down"],
    ["unknown failure", "質問を送信できませんでした。"],
  ])("shows submission failures", async (reason, message) => {
    backend.startChat.mockRejectedValue(reason);
    const { container } = render(
      <ChatSidebar context={{ bookName: "Guide.pdf", pageNumber: 1, text: "context" }} />,
    );

    await screen.findByText("OpenRouter");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "question" } });
    fireEvent.submit(container.querySelector("form")!);

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
    expect(screen.getByText("送信")).toBeTruthy();
  });

  it("treats a page with no extracted text as unavailable", () => {
    render(
      <ChatSidebar context={{ bookName: "Guide.pdf", pageNumber: 3, text: "" }} />,
    );

    expect(screen.getByText("PDF未選択")).toBeTruthy();
  });

  it("prefers the active selection over the current page when available", async () => {
    const { container, rerender } = render(
      <ChatSidebar context={{ bookName: "Guide.pdf", pageNumber: 5, text: "page text" }} />,
    );

    await screen.findByText("OpenRouter");

    expect(screen.getByText("Page 5")).toBeTruthy();

    rerender(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 5, text: "page text" }}
        selection={{ pageNumber: 6, text: "highlighted phrase" }}
      />,
    );

    expect(screen.getByText("選択範囲（Page 6）")).toBeTruthy();
    expect(screen.getByText("Page 6 の選択範囲を添付")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "explain" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(backend.startChat).toHaveBeenCalledWith({
      requestId: "request-1",
      question: "explain",
      contextText: "highlighted phrase",
      bookName: "Guide.pdf",
      pageNumber: 6,
    }));
  });

  it("lets the user switch between selection and full page context", async () => {
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 5, text: "full page body" }}
        selection={{ pageNumber: 6, text: "highlighted phrase" }}
      />,
    );

    await screen.findByText("OpenRouter");

    fireEvent.click(screen.getByRole("tab", { name: "ページ全体" }));
    expect(screen.getByText("Page 5")).toBeTruthy();
    expect(screen.getByText("Page 5 を添付")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what is this" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(backend.startChat).toHaveBeenCalledWith({
      requestId: "request-1",
      question: "what is this",
      contextText: "full page body",
      bookName: "Guide.pdf",
      pageNumber: 5,
    }));
  });
});
