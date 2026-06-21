import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BookSummary } from "../../shared/api/backend";
import { Library } from "./Library";

const availableBook: BookSummary = {
  id: "book-1",
  title: "Systems Guide",
  fileName: "systems.pdf",
  size: 42,
  pageCount: 200,
  lastPage: 50,
  importedAt: "2026-06-20T00:00:00Z",
  lastOpenedAt: "2026-06-21T00:00:00Z",
  coverUrl: "/cover/1",
  coverStatus: "ready",
  available: true,
};

const defaultProps = {
  books: [] as BookSummary[],
  loading: false,
  error: "",
  busyBookId: "",
  onImport: vi.fn(),
  onOpen: vi.fn(),
  onRelink: vi.fn(),
  onRemove: vi.fn(),
};

describe("Library", () => {
  it("offers PDF import from the empty state", () => {
    const onImport = vi.fn();
    render(<Library {...defaultProps} onImport={onImport} />);

    expect(screen.getByText("最初の一冊を、本棚へ。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "PDFを選ぶ" }));
    expect(onImport).toHaveBeenCalledOnce();
  });

  it("shows covers, reading progress, and opens an available book", () => {
    const onOpen = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onOpen={onOpen} />);

    expect(screen.getByText("50 / 200ページ")).toBeTruthy();
    expect(screen.getByRole("presentation")).toHaveProperty("src", expect.stringContaining("/cover/1"));
    fireEvent.click(screen.getByRole("button", { name: "Systems Guideを開く" }));
    expect(onOpen).toHaveBeenCalledWith(availableBook);
  });

  it("uses a placeholder and offers recovery for a missing source PDF", () => {
    const onRelink = vi.fn();
    const missing = {
      ...availableBook,
      id: "missing",
      coverUrl: "",
      coverStatus: "failed" as const,
      available: false,
    };
    render(<Library {...defaultProps} books={[missing]} onRelink={onRelink} />);

    expect(screen.getByText("ファイルが見つかりません")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Systems Guideを開く" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "再選択" }));
    expect(onRelink).toHaveBeenCalledWith(missing);
  });

  it("invokes onRemove when the delete button is clicked", () => {
    const onRemove = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "Systems Guideを本棚から削除" }));
    expect(onRemove).toHaveBeenCalledWith(availableBook);
  });

  it("shows loading and error states", () => {
    const { rerender } = render(<Library {...defaultProps} loading />);
    expect(screen.getByRole("status")).toHaveProperty("textContent", "本棚を読み込んでいます…");

    rerender(<Library {...defaultProps} error="database error" />);
    expect(screen.getByRole("alert")).toHaveProperty("textContent", expect.stringContaining("database error"));
  });
});
