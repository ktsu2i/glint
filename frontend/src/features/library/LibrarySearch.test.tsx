import { fireEvent, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BookSummary, LibrarySearchHit } from "../../shared/api/backend";
import { LibrarySearchField, LibrarySearchResults } from "./LibrarySearch";
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
  busyBookId: "",
  searchQuery: "",
  searchInput: "",
  searchResults: [] as LibrarySearchHit[],
  searchStatus: "idle" as const,
  searchError: "",
  onOpenAtPage: vi.fn(),
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

describe("LibrarySearchResults", () => {
  it("prompts for a query before the first search", () => {
    render(<LibrarySearchResults {...resultProps} />);
    expect(
      screen.getByText("キーワードを入力すると、準備済みのページを横断検索します。"),
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
