import { fireEvent, render as renderBase, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BookSummary } from "../../shared/api/backend";
import { Library } from "./Library";
import { I18nProvider } from "../../shared/i18n/i18n";

function render(ui: ReactNode) {
  return renderBase(ui, {
    wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider>,
  });
}

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
  opening: false,
  onImport: vi.fn(),
  onOpen: vi.fn(),
  onRelink: vi.fn(),
  onRemove: vi.fn(),
  onRename: vi.fn(),
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

    const shelf = screen.getByRole("region", { name: "import済みの本" });
    expect(within(shelf).getByText("50 / 200ページ")).toBeTruthy();
    expect(within(shelf).getByText("PDF")).toBeTruthy();
    expect(within(shelf).getByRole("presentation")).toHaveProperty(
      "src",
      expect.stringContaining("/cover/1"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Systems Guideを開く" }));
    expect(onOpen).toHaveBeenCalledWith(availableBook);
  });

  it("features the most recently opened book and continues reading from it", () => {
    const onOpen = vi.fn();
    const older = {
      ...availableBook,
      id: "book-0",
      title: "Older Notes",
      lastOpenedAt: "2026-06-01T00:00:00Z",
    };
    const unopened = {
      ...availableBook,
      id: "book-2",
      title: "Fresh Book",
      lastOpenedAt: "",
      lastPage: 1,
    };
    render(<Library {...defaultProps} books={[older, availableBook, unopened]} onOpen={onOpen} />);

    const hero = screen.getByRole("region", { name: "最近開いた本" });
    expect(within(hero).getByRole("heading", { name: "Systems Guide" })).toBeTruthy();
    expect(within(hero).getByText("50 / 200ページ")).toBeTruthy();
    fireEvent.click(within(hero).getByRole("button", { name: "Systems Guideの続きを読む" }));
    expect(onOpen).toHaveBeenCalledWith(availableBook);

    const shelf = screen.getByRole("region", { name: "import済みの本" });
    expect(within(shelf).getByText("3冊")).toBeTruthy();
    expect(within(shelf).getByText("まだ開いていません")).toBeTruthy();
    expect(within(shelf).getByRole("button", { name: "読み始める" })).toBeTruthy();
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
    expect(screen.getByRole("button", { name: "Systems Guideを開く" })).toHaveProperty(
      "disabled",
      true,
    );
    fireEvent.click(screen.getByRole("button", { name: "再選択" }));
    expect(onRelink).toHaveBeenCalledWith(missing);
  });

  it("invokes onRemove when the delete button is clicked", () => {
    const onRemove = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "Systems Guideを本棚から削除" }));
    expect(onRemove).toHaveBeenCalledWith(availableBook);
  });

  it("renames a book through the inline editor and trims whitespace", () => {
    const onRename = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onRename={onRename} />);

    const titleButton = screen.getByRole("button", { name: "Systems Guideの名前を変更" });
    expect(titleButton).toHaveProperty("textContent", "Systems Guide");
    fireEvent.click(titleButton);
    const input = screen.getByLabelText<HTMLInputElement>("Systems Guideの表示名");
    expect(input.value).toBe("Systems Guide");
    fireEvent.change(input, { target: { value: "  Real Title  " } });
    fireEvent.submit(input.closest("form")!);
    expect(onRename).toHaveBeenCalledWith(availableBook, "Real Title");
    expect(screen.queryByLabelText("Systems Guideの表示名")).toBeNull();
  });

  it("cancels with Escape and skips blank names on blur", () => {
    const onRename = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onRename={onRename} />);

    fireEvent.click(screen.getByRole("button", { name: "Systems Guideの名前を変更" }));
    fireEvent.keyDown(screen.getByLabelText("Systems Guideの表示名"), { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Systems Guideの表示名")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Systems Guideの名前を変更" }));
    const input = screen.getByLabelText<HTMLInputElement>("Systems Guideの表示名");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Systems Guideの表示名")).toBeNull();
  });

  it("shows loading and error states", () => {
    const { rerender } = render(<Library {...defaultProps} loading />);
    expect(screen.getByRole("status")).toHaveProperty("textContent", "本棚を読み込んでいます…");

    rerender(<Library {...defaultProps} error="database error" />);
    expect(screen.getByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("database error"),
    );
  });
});
