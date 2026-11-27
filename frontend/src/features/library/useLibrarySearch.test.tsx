import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ searchLibrary: vi.fn() }));
vi.mock("./api", () => ({ searchLibrary: backend.searchLibrary }));

import { I18nProvider } from "../../shared/i18n/i18n";
import { useLibrarySearch } from "./useLibrarySearch";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLanguage="en">{children}</I18nProvider>;
}

function hit(id: string) {
  return { book: { id }, totalMatches: 1, pages: [] };
}

describe("useLibrarySearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    backend.searchLibrary.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("searches once typing pauses, only while active", async () => {
    backend.searchLibrary.mockResolvedValue([hit("book-1")]);
    const { result, rerender } = renderHook(({ active }) => useLibrarySearch(active), {
      wrapper,
      initialProps: { active: false },
    });

    act(() => result.current.changeInput("go"));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(backend.searchLibrary).not.toHaveBeenCalled();

    rerender({ active: true });
    act(() => result.current.changeInput("go "));
    await act(() => vi.advanceTimersByTimeAsync(249));
    expect(backend.searchLibrary).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));

    expect(backend.searchLibrary).toHaveBeenCalledExactlyOnceWith("go");
    expect(result.current.query).toBe("go");
    expect(result.current.status).toBe("ready");
    expect(result.current.results).toEqual([hit("book-1")]);
  });

  it("drops the answer to a search that was cleared before it came back", async () => {
    let answer!: (hits: unknown[]) => void;
    backend.searchLibrary.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderHook(() => useLibrarySearch(true), { wrapper });

    act(() => result.current.changeInput("go"));
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(result.current.status).toBe("loading");

    act(() => result.current.changeInput(""));
    await act(async () => answer([hit("book-1")]));

    expect(result.current.status).toBe("idle");
    expect(result.current.results).toEqual([]);
  });

  it("shows the error of a failed search", async () => {
    backend.searchLibrary.mockRejectedValue(new Error("search failed"));
    const { result } = renderHook(() => useLibrarySearch(true), { wrapper });

    act(() => result.current.changeInput("go"));
    await act(() => result.current.submit());

    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("search failed");
  });
});
