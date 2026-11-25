import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookSummary } from "../../shared/api/backend";
import { I18nProvider } from "../../shared/i18n/i18n";
import { LibrarySortMenu } from "./LibrarySortMenu";
import { sortBooks, useLibrarySortOrder } from "./librarySort";

function book(overrides: Partial<BookSummary> & { id: string }): BookSummary {
  return {
    title: overrides.id,
    fileName: `${overrides.id}.pdf`,
    size: 1,
    pageCount: 100,
    lastPage: 1,
    importedAt: "2026-01-01T00:00:00Z",
    lastOpenedAt: "",
    coverUrl: "",
    coverStatus: "ready",
    available: true,
    ...overrides,
  };
}

const books = [
  book({ id: "a", title: "Go 10", importedAt: "2026-03-01T00:00:00Z", lastPage: 10 }),
  book({
    id: "b",
    title: "go 9",
    importedAt: "2026-01-01T00:00:00Z",
    lastOpenedAt: "2026-04-02T00:00:00Z",
    lastPage: 80,
  }),
  book({
    id: "c",
    title: "Algorithms",
    importedAt: "2026-02-01T00:00:00Z",
    lastOpenedAt: "2026-04-05T00:00:00Z",
    lastPage: 30,
  }),
  book({ id: "d", title: "Zig", importedAt: "2026-04-01T00:00:00Z", pageCount: 0 }),
];

function ids(sorted: BookSummary[]) {
  return sorted.map((item) => item.id);
}

describe("sortBooks", () => {
  it("lists recently opened books first, then unopened books by newest import", () => {
    expect(ids(sortBooks(books, "recent", "en"))).toEqual(["c", "b", "d", "a"]);
  });

  it("lists the newest imports first", () => {
    expect(ids(sortBooks(books, "added", "en"))).toEqual(["d", "a", "c", "b"]);
  });

  it("sorts titles ignoring case and comparing numbers naturally", () => {
    expect(ids(sortBooks(books, "title", "en"))).toEqual(["c", "b", "a", "d"]);
  });

  it("lists the books read furthest first", () => {
    expect(ids(sortBooks(books, "progress", "en"))).toEqual(["b", "c", "a", "d"]);
  });

  it("leaves the given array untouched", () => {
    const original = [...books];
    sortBooks(books, "title", "en");
    expect(books).toEqual(original);
  });
});

describe("useLibrarySortOrder", () => {
  afterEach(() => window.localStorage.clear());

  it("remembers the chosen order", () => {
    const first = renderHook(() => useLibrarySortOrder());
    expect(first.result.current[0]).toBe("recent");
    act(() => first.result.current[1]("title"));
    expect(first.result.current[0]).toBe("title");

    const second = renderHook(() => useLibrarySortOrder());
    expect(second.result.current[0]).toBe("title");
  });

  it("falls back to recently opened for an unknown saved order", () => {
    window.localStorage.setItem("glint.library.sortOrder", "size");
    const { result } = renderHook(() => useLibrarySortOrder());
    expect(result.current[0]).toBe("recent");
  });
});

describe("LibrarySortMenu", () => {
  it("shows the current order and reports the chosen one", async () => {
    const onOrderChange = vi.fn();
    render(
      <I18nProvider initialLanguage="ja">
        <LibrarySortMenu order="recent" onOrderChange={onOrderChange} />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "本の並び順: 最近開いた順" }));
    expect(
      (await screen.findByRole("menuitemradio", { name: "最近開いた順" })).getAttribute(
        "aria-checked",
      ),
    ).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "タイトル順" }));
    expect(onOrderChange).toHaveBeenCalledWith("title");
  });
});
