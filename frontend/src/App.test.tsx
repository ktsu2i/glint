import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ openPDF: vi.fn() }));

vi.mock("./shared/api/backend", () => ({ openPDF: mocks.openPDF }));
vi.mock("./features/reader/PdfReader", () => ({
  PdfReader: ({ book, onPageContextChange }: {
    book: { name: string } | null;
    onPageContextChange: (page: number, text: string) => void;
  }) => (
    <div data-testid="pdf-reader">
      <span>{book?.name ?? "no-book"}</span>
      <button type="button" onClick={() => onPageContextChange(4, "page text")}>set-page</button>
    </div>
  ),
}));
vi.mock("./features/chat/ChatSidebar", () => ({
  ChatSidebar: ({ context }: { context: { bookName: string; pageNumber: number; text: string } }) => (
    <div data-testid="chat-context">{JSON.stringify(context)}</div>
  ),
}));

import App from "./App";

beforeEach(() => {
  vi.clearAllMocks();
  document.body.className = "";
});

describe("App", () => {
  it("opens a PDF, propagates page context, and resizes the assistant panel", async () => {
    let resolveEmpty!: (value: { name: string; url: string; size: number }) => void;
    mocks.openPDF.mockReturnValueOnce(new Promise((resolve) => {
      resolveEmpty = resolve;
    }));
    const { unmount } = render(<App />);

    expect(screen.getByText("本はまだ開かれていません")).toBeTruthy();
    expect(screen.getByLabelText("ページ未選択")).toBeTruthy();
    fireEvent.pointerMove(window, { clientX: 10 });
    fireEvent.pointerUp(window);

    fireEvent.click(screen.getByRole("button", { name: /PDFを開く/ }));
    expect(screen.getByText("開いています…")).toBeTruthy();
    resolveEmpty({ name: "ignored.pdf", url: "", size: 0 });
    await waitFor(() => expect(screen.getByText("PDFを開く")).toBeTruthy());

    mocks.openPDF.mockResolvedValueOnce({ name: "Guide.pdf", url: "/book/1", size: 10 });
    fireEvent.click(screen.getByRole("button", { name: /PDFを開く/ }));
    await waitFor(() => expect(screen.getAllByText("Guide.pdf")).toHaveLength(2));
    expect(screen.getByText("別のPDF")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "set-page" }));
    expect(screen.getByLabelText("4ページ")).toBeTruthy();
    expect(screen.getByText("004")).toBeTruthy();
    expect(screen.getByTestId("chat-context").textContent).toContain('"pageNumber":4');

    const separator = screen.getByRole("separator");
    fireEvent.keyDown(separator, { key: "Other" });
    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(separator, { key: "ArrowLeft" });
    }
    expect(separator.getAttribute("aria-valuenow")).toBe("520");
    for (let index = 0; index < 20; index += 1) {
      fireEvent.keyDown(separator, { key: "ArrowRight" });
    }
    expect(separator.getAttribute("aria-valuenow")).toBe("328");

    fireEvent.pointerDown(separator, { clientX: 500 });
    expect(document.body.classList.contains("is-resizing")).toBe(true);
    fireEvent.pointerMove(window, { clientX: 400 });
    expect(separator.getAttribute("aria-valuenow")).toBe("428");
    fireEvent.pointerMove(window, { clientX: -1000 });
    expect(separator.getAttribute("aria-valuenow")).toBe("520");
    fireEvent.pointerUp(window);
    expect(document.body.classList.contains("is-resizing")).toBe(false);
    fireEvent.pointerUp(window);

    fireEvent.pointerDown(separator, { clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 1000 });
    expect(separator.getAttribute("aria-valuenow")).toBe("328");
    fireEvent.pointerUp(window);
    unmount();
  });

  it.each([
    [new Error("dialog failed"), "dialog failed"],
    ["unknown", "PDFを開けませんでした。"],
  ])("shows PDF selection errors", async (reason, message) => {
    mocks.openPDF.mockRejectedValueOnce(reason);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /PDFを開く/ }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
  });
});
