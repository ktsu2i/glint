import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getLibrarySettings: vi.fn(),
  saveLibrarySettings: vi.fn(),
}));
vi.mock("../../shared/api/backend", () => ({
  getLibrarySettings: backend.getLibrarySettings,
  saveLibrarySettings: backend.saveLibrarySettings,
}));
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
  let saved = "recent";
  beforeEach(() => {
    saved = "recent";
    backend.getLibrarySettings.mockReset().mockImplementation(async () => ({ sortOrder: saved }));
    backend.saveLibrarySettings
      .mockReset()
      .mockImplementation(async (settings: { sortOrder: string }) => {
        saved = settings.sortOrder;
        return settings;
      });
  });
  afterEach(() => window.localStorage.clear());

  it("remembers the chosen order in the library", async () => {
    const first = renderHook(() => useLibrarySortOrder());
    expect(first.result.current[0]).toBe("recent");
    act(() => first.result.current[1]("title"));
    expect(first.result.current[0]).toBe("title");
    expect(backend.saveLibrarySettings).toHaveBeenCalledWith({ sortOrder: "title" });

    const second = renderHook(() => useLibrarySortOrder());
    await waitFor(() => expect(second.result.current[0]).toBe("title"));
    expect(window.localStorage.length).toBe(0);
  });

  it("falls back to recently opened for an unknown saved order", async () => {
    saved = "size";
    const { result } = renderHook(() => useLibrarySortOrder());
    await waitFor(() => expect(backend.getLibrarySettings).toHaveBeenCalled());
    expect(result.current[0]).toBe("recent");
  });

  it("moves the order an earlier version kept to the library", async () => {
    window.localStorage.setItem("glint.library.sortOrder", "progress");
    const { result } = renderHook(() => useLibrarySortOrder());

    await waitFor(() => expect(result.current[0]).toBe("progress"));
    expect(backend.saveLibrarySettings).toHaveBeenCalledWith({ sortOrder: "progress" });
    await waitFor(() => expect(window.localStorage.getItem("glint.library.sortOrder")).toBeNull());
  });

  it("drops an unknown order an earlier version kept", async () => {
    window.localStorage.setItem("glint.library.sortOrder", "size");
    saved = "added";
    const { result } = renderHook(() => useLibrarySortOrder());

    await waitFor(() => expect(result.current[0]).toBe("added"));
    expect(window.localStorage.getItem("glint.library.sortOrder")).toBeNull();
    expect(backend.saveLibrarySettings).not.toHaveBeenCalled();
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
