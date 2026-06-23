import { fireEvent, render as renderBase, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BookSummary, LibrarySearchHit } from "../../shared/api/backend";
import { LibrarySearch } from "./LibrarySearch";
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
  busyBookId: "",
  searchQuery: "",
  searchInput: "",
  searchResults: [] as LibrarySearchHit[],
  searchStatus: "idle" as const,
  searchError: "",
  onSearchInputChange: vi.fn(),
  onSearchSubmit: vi.fn(),
  onSearchClear: vi.fn(),
  onOpenAtPage: vi.fn(),
};

describe("LibrarySearch", () => {
  it("submits a query and opens a result at the matched page", () => {
    const onSearchInputChange = vi.fn();
    const onSearchSubmit = vi.fn();
    const onOpenAtPage = vi.fn();
    const hit: LibrarySearchHit = {
      book: availableBook,
      totalMatches: 4,
      pages: [
        { pageNumber: 12, excerpt: "context builder filters", matchCount: 3 },
        { pageNumber: 50, excerpt: "context builder cited", matchCount: 1 },
      ],
    };

    const { rerender } = render(
      <LibrarySearch
        {...defaultProps}
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
        onOpenAtPage={onOpenAtPage}
      />,
    );

    const searchBox = screen.getByRole("searchbox") as HTMLInputElement;
    fireEvent.change(searchBox, { target: { value: "context builder" } });
    expect(onSearchInputChange).toHaveBeenCalledWith("context builder");

    rerender(
      <LibrarySearch
        {...defaultProps}
        searchInput="context builder"
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
        onOpenAtPage={onOpenAtPage}
      />,
    );
    fireEvent.submit(screen.getByRole("searchbox").closest("form")!);
    expect(onSearchSubmit).toHaveBeenCalledOnce();

    rerender(
      <LibrarySearch
        {...defaultProps}
        searchQuery="context builder"
        searchInput="context builder"
        searchResults={[hit]}
        searchStatus="ready"
        onSearchInputChange={onSearchInputChange}
        onSearchSubmit={onSearchSubmit}
        onOpenAtPage={onOpenAtPage}
      />,
    );

    expect(screen.getByText("1冊で見つかりました")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Systems Guideの50ページを開く" }));
    expect(onOpenAtPage).toHaveBeenCalledWith(availableBook, 50);
  });

  it("shows an empty state when there are no matches and lets the user clear", () => {
    const onSearchClear = vi.fn();
    render(
      <LibrarySearch
        {...defaultProps}
        searchQuery="missing term"
        searchInput="missing term"
        searchResults={[]}
        searchStatus="ready"
        onSearchClear={onSearchClear}
      />,
    );

    expect(screen.getByText("「missing term」を含む本は見つかりませんでした。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "検索をクリア" }));
    expect(onSearchClear).toHaveBeenCalledOnce();
  });

  it("disables the result button when the book file is missing", () => {
    const missingBook: BookSummary = { ...availableBook, available: false };
    const hit: LibrarySearchHit = {
      book: missingBook,
      totalMatches: 1,
      pages: [{ pageNumber: 7, excerpt: "missing match", matchCount: 1 }],
    };

    render(
      <LibrarySearch
        {...defaultProps}
        searchQuery="missing"
        searchInput="missing"
        searchResults={[hit]}
        searchStatus="ready"
      />,
    );

    const button = screen.getByRole("button", { name: "Systems Guideの7ページを開く" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("ファイルが見つかりません")).toBeTruthy();
  });

  it("surfaces a backend error in the results region", () => {
    render(
      <LibrarySearch
        {...defaultProps}
        searchQuery="boom"
        searchInput="boom"
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
