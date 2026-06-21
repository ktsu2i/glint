import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBooks: vi.fn(),
  markBookCoverFailed: vi.fn(),
  openBook: vi.fn(),
  openPDF: vi.fn(),
  relinkPDF: vi.fn(),
  saveBookCover: vi.fn(),
  saveReadingPosition: vi.fn(),
  generateCoverThumbnail: vi.fn(),
  getLLMSettings: vi.fn(),
  saveLLMSettings: vi.fn(),
}));

vi.mock("./shared/api/backend", () => ({
  listBooks: mocks.listBooks,
  markBookCoverFailed: mocks.markBookCoverFailed,
  openBook: mocks.openBook,
  openPDF: mocks.openPDF,
  relinkPDF: mocks.relinkPDF,
  saveBookCover: mocks.saveBookCover,
  saveReadingPosition: mocks.saveReadingPosition,
  getLLMSettings: mocks.getLLMSettings,
  saveLLMSettings: mocks.saveLLMSettings,
}));
vi.mock("./features/library/generateCover", () => ({
  generateCoverThumbnail: mocks.generateCoverThumbnail,
}));
vi.mock("./features/reader/PdfReader", () => ({
  PdfReader: ({ book, initialPage, onPageContextChange }: {
    book: { name: string } | null;
    initialPage: number;
    onPageContextChange: (page: number, text: string, pageCount: number) => void;
  }) => (
    <div data-testid="pdf-reader">
      <span>{book?.name ?? "no-book"}</span>
      <span>initial-{initialPage}</span>
      <button type="button" onClick={() => onPageContextChange(4, "page text", 12)}>set-page</button>
    </div>
  ),
}));
vi.mock("./features/chat/ChatSidebar", () => ({
  ChatSidebar: ({ context }: { context: { bookName: string; pageNumber: number; text: string } }) => (
    <div data-testid="chat-context">{JSON.stringify(context)}</div>
  ),
}));

import App from "./App";

const openedBook = {
  id: "book-1",
  title: "Guide",
  name: "Guide.pdf",
  url: "/book/1",
  size: 10,
  initialPage: 3,
  coverStatus: "ready" as const,
};

const summary = {
  id: "book-1",
  title: "Guide",
  fileName: "Guide.pdf",
  size: 10,
  pageCount: 12,
  lastPage: 3,
  importedAt: "2026-06-21T00:00:00Z",
  lastOpenedAt: "2026-06-21T01:00:00Z",
  coverUrl: "/cover/1",
  coverStatus: "ready" as const,
  available: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.className = "";
  mocks.listBooks.mockResolvedValue([]);
  mocks.saveReadingPosition.mockResolvedValue(undefined);
  mocks.saveBookCover.mockResolvedValue(undefined);
  mocks.markBookCoverFailed.mockResolvedValue(undefined);
  mocks.generateCoverThumbnail.mockResolvedValue("data:image/png;base64,cover");
  mocks.getLLMSettings.mockResolvedValue({
    provider: "openrouter",
    model: "provider/model",
    zdr: true,
    hasApiKey: true,
    configured: true,
  });
});

describe("App", () => {
  it("starts in the library, imports a PDF, saves page context, and returns", async () => {
    let resolveEmpty!: (value: typeof openedBook) => void;
    mocks.openPDF.mockReturnValueOnce(new Promise((resolve) => {
      resolveEmpty = resolve;
    }));
    const { unmount } = render(<App />);

    expect(await screen.findByText("最初の一冊を、本棚へ。")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "メインナビゲーション" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "本棚" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("button", { name: "読書" })).toHaveProperty("disabled", true);
    fireEvent.pointerMove(window, { clientX: 10 });
    fireEvent.pointerUp(window);

    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    expect(screen.getByText("選択しています…")).toBeTruthy();
    resolveEmpty({ ...openedBook, id: "", url: "" });
    await waitFor(() => expect(screen.getByRole("button", { name: "PDFを追加" })).toBeTruthy());

    mocks.openPDF.mockResolvedValueOnce(openedBook);
    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    await waitFor(() => expect(screen.getByText("initial-3")).toBeTruthy());
    expect(screen.getByRole("button", { name: "読書" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "set-page" }));
    expect(screen.getByLabelText("4ページ")).toBeTruthy();
    expect(screen.getByText("004")).toBeTruthy();
    expect(screen.getByTestId("chat-context").textContent).toContain('"pageNumber":4');
    expect(mocks.saveReadingPosition).toHaveBeenCalledWith("book-1", 4, 12);

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(await screen.findByRole("heading", { name: "設定", level: 1 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "設定" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "読書" }));
    expect(await screen.findByText("initial-4")).toBeTruthy();

    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "Other" });
    for (let index = 0; index < 12; index += 1) fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator.getAttribute("aria-valuenow")).toBe("520");
    for (let index = 0; index < 20; index += 1) fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator.getAttribute("aria-valuenow")).toBe("328");

    fireEvent.pointerDown(separator, { clientX: 500 });
    expect(document.body.classList.contains("is-resizing")).toBe(true);
    fireEvent.pointerMove(window, { clientX: 400 });
    expect(separator.getAttribute("aria-valuenow")).toBe("428");
    fireEvent.pointerMove(window, { clientX: -1000 });
    expect(separator.getAttribute("aria-valuenow")).toBe("520");
    fireEvent.pointerUp(window);
    expect(document.body.classList.contains("is-resizing")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "本棚" }));
    expect(await screen.findByRole("heading", { name: "本棚" })).toBeTruthy();
    unmount();
  });

  it("opens a saved book at its reading position", async () => {
    mocks.listBooks.mockResolvedValue([summary]);
    mocks.openBook.mockResolvedValue(openedBook);
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Guideを開く" }));
    expect(await screen.findByText("initial-3")).toBeTruthy();
    expect(mocks.openBook).toHaveBeenCalledWith("book-1");
  });

  it("opens the settings page from the library and returns", async () => {
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "設定" }));
    expect(await screen.findByRole("heading", { name: "設定", level: 1 })).toBeTruthy();
    expect(screen.getByDisplayValue("provider/model")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "本棚" }));
    expect(await screen.findByRole("heading", { name: "本棚" })).toBeTruthy();
  });

  it("generates a pending cover without blocking the reader", async () => {
    mocks.openPDF.mockResolvedValue({ ...openedBook, coverStatus: "pending" });
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    await waitFor(() => expect(mocks.saveBookCover).toHaveBeenCalledWith(
      "book-1",
      "data:image/png;base64,cover",
    ));
    expect(screen.getByTestId("pdf-reader")).toBeTruthy();
  });

  it.each([
    [new Error("dialog failed"), "dialog failed"],
    ["unknown", "PDFを追加できませんでした。"],
  ])("shows PDF selection errors", async (reason, message) => {
    mocks.openPDF.mockRejectedValueOnce(reason);
    render(<App />);
    await screen.findByText("最初の一冊を、本棚へ。");

    fireEvent.click(screen.getByRole("button", { name: "PDFを追加" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining(message));
  });
});
