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

function shelfHeading(name: string) {
  const shelf = screen.getByRole("region", { name: "import済みの本" });
  return within(shelf).getByRole("heading", { name });
}

describe("Library", () => {
  it("offers PDF import from the empty state", () => {
    const onImport = vi.fn();
    render(<Library {...defaultProps} onImport={onImport} />);

    expect(screen.getByText("最初の一冊を、本棚へ。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "本を選ぶ" }));
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

  it("continues the most recently opened book from the hero", () => {
    const onOpen = vi.fn();
    const older = {
      ...availableBook,
      id: "book-0",
      title: "Older Notes",
      lastOpenedAt: "2026-06-01T00:00:00Z",
    };
    render(<Library {...defaultProps} books={[older, availableBook]} onOpen={onOpen} />);

    const hero = screen.getByRole("region", { name: "最近開いた本" });
    expect(within(hero).getByRole("heading", { name: "Systems Guide" })).toBeTruthy();
    expect(within(hero).getByText("50 / 200ページ")).toBeTruthy();
    expect(within(hero).queryByText("最近開いた本")).toBeNull();
    fireEvent.click(within(hero).getByRole("button", { name: "Systems Guideの続きを読む" }));
    expect(onOpen).toHaveBeenCalledWith(availableBook);
  });

  it("has no hero before any book is opened", () => {
    render(<Library {...defaultProps} books={[{ ...availableBook, lastOpenedAt: "" }]} />);
    expect(screen.queryByRole("region", { name: "最近開いた本" })).toBeNull();
  });

  it("has no shelf heading, only the covers in the given order", () => {
    const unopened = {
      ...availableBook,
      id: "book-2",
      title: "Fresh Book",
      lastOpenedAt: "",
      lastPage: 1,
    };
    render(<Library {...defaultProps} books={[availableBook, unopened]} />);

    expect(screen.queryByText("2冊")).toBeNull();
    const shelf = screen.getByRole("region", { name: "import済みの本" });
    expect(
      within(shelf)
        .getAllByRole("heading")
        .map((heading) => heading.textContent),
    ).toEqual(["Systems Guide", "Fresh Book"]);
    expect(within(shelf).getByText("まだ開いていません")).toBeTruthy();
    expect(within(shelf).queryByRole("button", { name: "続きを読む" })).toBeNull();
  });

  it("relinks a missing source PDF from its cover", () => {
    const onOpen = vi.fn();
    const onRelink = vi.fn();
    const missing = {
      ...availableBook,
      id: "missing",
      coverUrl: "",
      coverStatus: "failed" as const,
      available: false,
    };
    render(<Library {...defaultProps} books={[missing]} onOpen={onOpen} onRelink={onRelink} />);

    expect(screen.getByText("ファイルが見つかりません")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Systems Guideのファイルを再選択" }));
    expect(onRelink).toHaveBeenCalledWith(missing);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("offers relinking in the context menu of a missing book", async () => {
    const onRelink = vi.fn();
    const missing = { ...availableBook, id: "missing", available: false };
    render(<Library {...defaultProps} books={[missing]} onRelink={onRelink} />);

    fireEvent.contextMenu(shelfHeading("Systems Guide"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "ファイルを再選択…" }));
    expect(onRelink).toHaveBeenCalledWith(missing);
  });

  it("removes a book from its context menu", async () => {
    const onRemove = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onRemove={onRemove} />);

    expect(screen.queryByRole("button", { name: /削除/ })).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Systems Guideを開く" }));
    const menu = await screen.findByRole("menu", { name: "Systems Guideの操作" });
    expect(within(menu).queryByRole("menuitem", { name: "ファイルを再選択…" })).toBeNull();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "本棚から削除" }));
    expect(onRemove).toHaveBeenCalledWith(availableBook);
  });

  it("renames a book from its context menu and trims whitespace", async () => {
    const onRename = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onRename={onRename} />);

    expect(screen.queryByRole("button", { name: /名前を変更/ })).toBeNull();
    fireEvent.contextMenu(shelfHeading("Systems Guide"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "名前を変更" }));
    const input = await screen.findByLabelText<HTMLInputElement>("Systems Guideの表示名");
    expect(input.value).toBe("Systems Guide");
    fireEvent.change(input, { target: { value: "  Real Title  " } });
    fireEvent.submit(input.closest("form")!);
    expect(onRename).toHaveBeenCalledWith(availableBook, "Real Title");
    expect(screen.queryByLabelText("Systems Guideの表示名")).toBeNull();
  });

  it("cancels with Escape and skips blank names on blur", async () => {
    const onRename = vi.fn();
    render(<Library {...defaultProps} books={[availableBook]} onRename={onRename} />);

    fireEvent.contextMenu(shelfHeading("Systems Guide"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "名前を変更" }));
    fireEvent.keyDown(await screen.findByLabelText("Systems Guideの表示名"), { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Systems Guideの表示名")).toBeNull();

    fireEvent.contextMenu(shelfHeading("Systems Guide"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "名前を変更" }));
    const input = await screen.findByLabelText<HTMLInputElement>("Systems Guideの表示名");
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
