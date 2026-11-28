import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ searchBook: vi.fn() }));
vi.mock("../api", () => ({ searchBook: backend.searchBook }));

import { I18nProvider } from "../../../shared/i18n/i18n";
import { useBookSearch } from "./useBookSearch";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLanguage="en">{children}</I18nProvider>;
}

const result = { pageNumber: 2, location: "page:2", headingPath: "", excerpt: "go", matchCount: 1 };

describe("useBookSearch", () => {
  beforeEach(() => backend.searchBook.mockReset());

  it("searches the book for the trimmed query", async () => {
    backend.searchBook.mockResolvedValue([result]);
    const { result: hook } = renderHook(() => useBookSearch("book-1"), { wrapper });

    act(() => hook.current.setQuery("  go "));
    await act(() => hook.current.submit());

    expect(backend.searchBook).toHaveBeenCalledWith("book-1", "go");
    expect(hook.current.submittedQuery).toBe("go");
    expect(hook.current.results).toEqual([result]);
    expect(hook.current.searching).toBe(false);
  });

  it("drops the answer to a search that was reset before it came back", async () => {
    let answer!: (results: unknown[]) => void;
    backend.searchBook.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result: hook } = renderHook(() => useBookSearch("book-1"), { wrapper });

    act(() => hook.current.setQuery("go"));
    let pending!: Promise<void>;
    act(() => {
      pending = hook.current.submit();
    });
    expect(hook.current.searching).toBe(true);

    act(() => hook.current.reset());
    await act(async () => {
      answer([result]);
      await pending;
    });

    expect(hook.current.results).toEqual([]);
    expect(hook.current.submittedQuery).toBe("");
    expect(hook.current.searching).toBe(false);
  });

  it("does nothing without a book", async () => {
    const { result: hook } = renderHook(() => useBookSearch(undefined), { wrapper });
    act(() => hook.current.setQuery("go"));
    await act(() => hook.current.submit());
    expect(backend.searchBook).not.toHaveBeenCalled();
  });
});
