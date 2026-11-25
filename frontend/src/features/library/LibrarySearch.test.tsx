import { fireEvent, render as renderBase, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BookSummary, LibrarySearchHit } from "../../shared/api/backend";
import { LibrarySearchField, LibrarySearchResults, matchBooksByTitle } from "./LibrarySearch";
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

const fieldProps = {
  searchInput: "",
  searchStatus: "idle" as const,
  resultCount: 0,
  onSearchInputChange: vi.fn(),
  onSearchSubmit: vi.fn(),
  onClose: vi.fn(),
};

const resultProps = {
  books: [] as BookSummary[],
  busyBookId: "",
  searchQuery: "",
  searchInput: "",
  searchResults: [] as LibrarySearchHit[],
  searchStatus: "idle" as const,
  searchError: "",
  onOpenAtPage: vi.fn(),
  onOpenBook: vi.fn(),
  onRelinkBook: vi.fn(),
};

const hit: LibrarySearchHit = {
  book: availableBook,
  totalMatches: 4,
  pages: [
    {
      pageNumber: 12,
      location: "page:12",
      headingPath: "",
      excerpt: "context builder filters",
      matchCount: 3,
    },
    {
      pageNumber: 50,
      location: "page:50",
      headingPath: "",
      excerpt: "context builder cited",
      matchCount: 1,
    },
  ],
};

describe("LibrarySearchField", () => {
  it("focuses the field, submits a query, and reports how many books matched", () => {
    const onSearchInputChange = vi.fn();
    const onSearchSubmit = vi.fn();
    const { rerender } = render(
      <LibrarySearchField
        {...fieldProps}
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
      />,
    );

    const searchBox = screen.getByRole<HTMLInputElement>("searchbox", { name: "検索語" });
    expect(document.activeElement).toBe(searchBox);
    fireEvent.change(searchBox, { target: { value: "context builder" } });
    expect(onSearchInputChange).toHaveBeenCalledWith("context builder");
    fireEvent.submit(searchBox.closest("form")!);
    expect(onSearchSubmit).not.toHaveBeenCalled();

    rerender(
      <LibrarySearchField
        {...fieldProps}
        searchInput="context builder"
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
      />,
    );
    fireEvent.submit(searchBox.closest("form")!);
    expect(onSearchSubmit).toHaveBeenCalledOnce();

    rerender(
      <LibrarySearchField {...fieldProps} searchInput="context builder" searchStatus="loading" />,
    );
    expect(screen.getByRole("status")).toHaveProperty("textContent", "検索中");
    rerender(
      <LibrarySearchField
        {...fieldProps}
        searchInput="context builder"
        searchStatus="ready"
        resultCount={1}
      />,
    );
    expect(screen.getByRole("status")).toHaveProperty("textContent", "1冊で見つかりました");
  });

  it("closes with Escape or the esc button", () => {
    const onClose = vi.fn();
    render(<LibrarySearchField {...fieldProps} onClose={onClose} />);

    fireEvent.keyDown(screen.getByRole("searchbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "検索を閉じる" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("matchBooksByTitle", () => {
  const books: BookSummary[] = [
    availableBook,
    { ...availableBook, id: "book-2", title: "Ｇｏ言語による並行処理" },
    { ...availableBook, id: "book-3", title: "Database Internals" },
  ];

  it("matches every term regardless of case and width", () => {
    expect(matchBooksByTitle(books, "systems").map((book) => book.id)).toEqual(["book-1"]);
    expect(matchBooksByTitle(books, "go 並行").map((book) => book.id)).toEqual(["book-2"]);
    expect(matchBooksByTitle(books, "guide internals")).toEqual([]);
  });

  it("matches nothing for a blank query", () => {
    expect(matchBooksByTitle(books, "   ")).toEqual([]);
  });
});

describe("LibrarySearchResults", () => {
  it("lists books whose title matches while typing and opens them", () => {
    const onOpenBook = vi.fn();
    const onRelinkBook = vi.fn();
    const missingBook: BookSummary = {
      ...availableBook,
      id: "book-2",
      title: "Systems Design",
      available: false,
    };
    render(
      <LibrarySearchResults
        {...resultProps}
        books={[availableBook, missingBook, { ...availableBook, id: "book-3", title: "Other" }]}
        searchInput="systems"
        onOpenBook={onOpenBook}
        onRelinkBook={onRelinkBook}
      />,
    );

    const titles = screen.getByRole("region", { name: "タイトル" });
    expect(within(titles).getAllByRole("button")).toHaveLength(2);
    expect(screen.getByText("Return キーで本文を横断検索します。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Systems Guideを開く" }));
    expect(onOpenBook).toHaveBeenCalledWith(availableBook);
    fireEvent.click(within(titles).getByRole("button", { name: /Systems Design/ }));
    expect(onRelinkBook).toHaveBeenCalledWith(missingBook);
  });

  it("shows title matches above the full-text hits", () => {
    render(
      <LibrarySearchResults
        {...resultProps}
        books={[availableBook]}
        searchInput="systems"
        searchQuery="systems"
        searchResults={[hit]}
        searchStatus="ready"
      />,
    );

    expect(screen.getByRole("heading", { name: "タイトル" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "本文" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Systems Guideの12ページを開く" })).toBeTruthy();
  });

  it("prompts for a query before the first search", () => {
    render(<LibrarySearchResults {...resultProps} />);
    expect(
      screen.getByText(
        "キーワードを入力すると、タイトルで本を探したり、準備済みのページを横断検索したりできます。",
      ),
    ).toBeTruthy();
  });

  it("opens a result at the matched page", () => {
    const onOpenAtPage = vi.fn();
    render(
      <LibrarySearchResults
        {...resultProps}
        searchQuery="context builder"
        searchResults={[hit]}
        searchStatus="ready"
        onOpenAtPage={onOpenAtPage}
      />,
    );

    expect(screen.getByText("4件")).toBeTruthy();
    expect(screen.getByText("一致 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Systems Guideの50ページを開く" }));
    expect(onOpenAtPage).toHaveBeenCalledWith(availableBook, 50);
  });

  it("shows an empty state when there are no matches", () => {
    render(
      <LibrarySearchResults
        {...resultProps}
        searchQuery="missing term"
        searchResults={[]}
        searchStatus="ready"
      />,
    );

    expect(screen.getByText("「missing term」を含む本は見つかりませんでした。")).toBeTruthy();
  });

  it("disables the result button when the book file is missing", () => {
    const missingBook: BookSummary = { ...availableBook, available: false };
    render(
      <LibrarySearchResults
        {...resultProps}
        searchQuery="missing"
        searchResults={[{ ...hit, book: missingBook }]}
        searchStatus="ready"
      />,
    );

    const button = screen.getByRole<HTMLButtonElement>("button", {
      name: "Systems Guideの12ページを開く",
    });
    expect(button.disabled).toBe(true);
    expect(screen.getByText("ファイルが見つかりません")).toBeTruthy();
  });

  it("surfaces a backend error in the results region", () => {
    render(
      <LibrarySearchResults
        {...resultProps}
        searchQuery="boom"
        searchStatus="error"
        searchError="本棚を検索できませんでした。"
      />,
    );

    expect(screen.getByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("本棚を検索できませんでした。"),
    );
  });
});
