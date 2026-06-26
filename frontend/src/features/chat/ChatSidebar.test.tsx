import { act, fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  listener: undefined as ((delta: {
    requestId: string;
    content?: string;
    done: boolean;
    error?: string;
  }) => void) | undefined,
  unsubscribe: vi.fn(),
  cancelChat: vi.fn(),
  getLLMConfig: vi.fn(),
  onAnswerDelta: vi.fn(),
  upsertProviderSettings: vi.fn(),
  startChat: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  cancelChat: backend.cancelChat,
  getLLMConfig: backend.getLLMConfig,
  onAnswerDelta: backend.onAnswerDelta,
  upsertProviderSettings: backend.upsertProviderSettings,
  startChat: backend.startChat,
}));

import { ChatSidebar } from "./ChatSidebar";
import { I18nProvider } from "../../shared/i18n/i18n";

function render(ui: ReactNode) {
  return renderBase(ui, { wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider> });
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.listener = undefined;
  backend.onAnswerDelta.mockImplementation((listener) => {
    backend.listener = listener;
    return backend.unsubscribe;
  });
  backend.getLLMConfig.mockResolvedValue({
    activeProviderId: "openrouter",
    providers: [{
      providerId: "openrouter",
      model: "provider/model",
      options: { zdr: true },
      hasApiKey: true,
      configured: true,
      isActive: true,
    }],
    catalog: [{
      id: "openrouter",
      displayName: "OpenRouter",
      authKind: "bearer",
      optionSchema: [],
      capabilities: { streaming: true, tools: false, images: false },
    }],
  });
  backend.startChat.mockResolvedValue(undefined);
  backend.cancelChat.mockResolvedValue(undefined);
  vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "request-1") });
});

describe("ChatSidebar", () => {
  it("shows the active provider and model in the composer footer", async () => {
    render(<ChatSidebar context={{ bookName: "", pageNumber: 0 }} />);
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    const label = await screen.findByText(/現在のmodel: OpenRouter \/ provider\/model/);
    expect(label).toBeTruthy();
  });

  it("falls back to a generic 'configure a model' label when no provider is active", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [{
        id: "openrouter",
        displayName: "OpenRouter",
        authKind: "bearer",
        optionSchema: [],
        capabilities: { streaming: true, tools: false, images: false },
      }],
    });
    render(<ChatSidebar context={{ bookName: "", pageNumber: 0 }} />);
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    expect(await screen.findByText("質問するモデルを設定してください")).toBeTruthy();
  });

  it("hides the context chip when there is no selection, ignores empty submissions, and unsubscribes", async () => {
    const { container, unmount } = render(
      <ChatSidebar context={{ bookName: "", pageNumber: 0 }} />,
    );

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());
    expect(container.querySelector(".context-chip")).toBeNull();
    expect(screen.getByText("文脈なし")).toBeTruthy();
    fireEvent.submit(container.querySelector("form")!);
    expect(backend.startChat).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("unused"));
    unmount();
    expect(backend.unsubscribe).toHaveBeenCalledOnce();
  });

  it("sends the selection with Command+Enter and keeps Enter available for newlines and IME", async () => {
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 7 }}
        selection={{ pageNumber: 7, text: "  highlighted phrase  " }}
      />,
    );
    const textarea = screen.getByPlaceholderText("このページについて質問する…");

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.change(textarea, { target: { value: "  Explain this  " } });
    expect(fireEvent.keyDown(textarea, { key: "Enter" })).toBe(true);
    expect(fireEvent.keyDown(textarea, {
      key: "Enter",
      metaKey: true,
      isComposing: true,
    })).toBe(true);
    expect(backend.startChat).not.toHaveBeenCalled();
    expect(fireEvent.keyDown(textarea, { key: "Enter", metaKey: true })).toBe(false);

    await waitFor(() => {
      expect(backend.startChat).toHaveBeenCalledWith({
        requestId: "request-1",
        question: "Explain this",
        contextText: "highlighted phrase",
        bookName: "Guide.pdf",
        pageNumber: 7,
      });
    });
    expect(screen.getByRole("button", { name: /中止/ })).toBeTruthy();
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

  it("renders a Cursor-style chip above the input with selection metadata and preview", async () => {
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 4 }}
        selection={{ pageNumber: 6, text: "  highlighted   phrase   from\n\nbook   " }}
      />,
    );
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    const chip = container.querySelector(".context-chip");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toContain("Page 6 の選択範囲");
    expect(container.querySelector(".context-chip-preview")?.textContent)
      .toBe("highlighted phrase from book");
    expect(screen.getByText("Page 6 の選択範囲を添付")).toBeTruthy();
  });

  it("clears the selection when the user clicks the chip remove button", async () => {
    const onClearSelection = vi.fn();
    render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 3 }}
        selection={{ pageNumber: 3, text: "highlighted phrase" }}
        onClearSelection={onClearSelection}
      />,
    );
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByRole("button", { name: "この文脈を取り外す" }));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it("clears the attached selection after dispatching the question", async () => {
    const onClearSelection = vi.fn();
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 4 }}
        selection={{ pageNumber: 4, text: "highlighted phrase" }}
        onClearSelection={onClearSelection}
      />,
    );
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "explain" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(backend.startChat).toHaveBeenCalledWith({
      requestId: "request-1",
      question: "explain",
      contextText: "highlighted phrase",
      bookName: "Guide.pdf",
      pageNumber: 4,
    }));
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it("does not call onClearSelection when there was no selection to clear", async () => {
    const onClearSelection = vi.fn();
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 5 }}
        onClearSelection={onClearSelection}
      />,
    );
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "explain" } });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(backend.startChat).toHaveBeenCalledOnce());
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("blocks a second request while sending", async () => {
    let resolveRequest!: () => void;
    backend.startChat.mockReturnValue(new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }));
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 2 }}
        selection={{ pageNumber: 2, text: "highlighted phrase" }}
      />,
    );

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    const textarea = screen.getByPlaceholderText("このページについて質問する…");
    fireEvent.change(textarea, { target: { value: "first" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(backend.startChat).toHaveBeenCalledOnce());

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
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 1 }}
        selection={{ pageNumber: 1, text: "context" }}
      />,
    );

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "question" } });
    fireEvent.submit(container.querySelector("form")!);

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
    expect(screen.getByText("送信")).toBeTruthy();
  });

  it("sends the current page number with no contextText when nothing is selected", async () => {
    const { container } = render(
      <ChatSidebar context={{ bookName: "Guide.pdf", pageNumber: 5 }} />,
    );

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());
    expect(container.querySelector(".context-chip")).toBeNull();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "what is this" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(backend.startChat).toHaveBeenCalledWith({
      requestId: "request-1",
      question: "what is this",
      contextText: "",
      bookName: "Guide.pdf",
      pageNumber: 5,
    }));
  });

  it("lets the user cancel an in-flight request and ignores its later deltas", async () => {
    let resolveRequest!: () => void;
    backend.startChat.mockReturnValue(new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }));
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 2 }}
        selection={{ pageNumber: 2, text: "context" }}
      />,
    );
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "long question" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(backend.startChat).toHaveBeenCalledOnce());
    resolveRequest();

    const cancelButton = await screen.findByRole("button", { name: /中止/ });
    fireEvent.click(cancelButton);
    await waitFor(() => expect(backend.cancelChat).toHaveBeenCalledWith("request-1"));
    await waitFor(() => expect(screen.getByRole("button", { name: /送信/ })).toBeTruthy());
    expect(screen.getByRole("status").textContent).toBe("回答を中止しました");
    expect(container.querySelector(".typing-indicator")).toBeNull();

    act(() => backend.listener?.({ requestId: "request-1", content: "stale", done: false }));
    act(() => backend.listener?.({ requestId: "request-1", done: true }));
    expect(screen.queryByText("stale")).toBeNull();
  });

  it("cancels an in-flight request with Escape and ignores Escape while idle", async () => {
    const { container } = render(
      <ChatSidebar context={{ bookName: "Guide.pdf", pageNumber: 2 }} />,
    );
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(backend.cancelChat).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "long question" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(backend.startChat).toHaveBeenCalledOnce());

    expect(fireEvent.keyDown(window, { key: "Escape" })).toBe(false);
    await waitFor(() => expect(backend.cancelChat).toHaveBeenCalledWith("request-1"));
    expect(screen.getByRole("status").textContent).toBe("回答を中止しました");
    expect(screen.getByRole("button", { name: /送信/ })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(backend.cancelChat).toHaveBeenCalledOnce();
  });

  it("surfaces an error when cancel itself fails", async () => {
    let resolveRequest!: () => void;
    backend.startChat.mockReturnValue(new Promise<void>((resolve) => {
      resolveRequest = resolve;
    }));
    backend.cancelChat.mockRejectedValue(new Error("backend down"));
    const { container } = render(
      <ChatSidebar
        context={{ bookName: "Guide.pdf", pageNumber: 2 }}
        selection={{ pageNumber: 2, text: "context" }}
      />,
    );
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "question" } });
    fireEvent.submit(container.querySelector("form")!);
    resolveRequest();

    fireEvent.click(await screen.findByRole("button", { name: /中止/ }));
    expect((await screen.findByRole("alert")).textContent).toBe("backend down");
  });
});
