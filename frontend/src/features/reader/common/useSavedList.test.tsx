import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../shared/i18n/i18n";
import { useSavedList } from "./useSavedList";

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider initialLanguage="en">{children}</I18nProvider>;
}

describe("useSavedList", () => {
  it("loads the entries of the book, and loads again for another book", async () => {
    const load = vi.fn(async (bookId: string) => [`${bookId}-entry`]);
    const onLoaded = vi.fn();
    const initialProps: { bookId: string | undefined } = { bookId: "book-1" };
    const { result, rerender } = renderHook(
      ({ bookId }) => useSavedList(bookId, { load, loadErrorKey: "error.loadBookmarks", onLoaded }),
      { wrapper, initialProps },
    );

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.entries).toEqual(["book-1-entry"]);
    expect(onLoaded).toHaveBeenCalledWith(["book-1-entry"]);

    rerender({ bookId: "book-2" });
    await waitFor(() => expect(result.current.entries).toEqual(["book-2-entry"]));

    rerender({ bookId: undefined });
    expect(result.current.entries).toEqual([]);
    expect(result.current.loaded).toBe(false);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("shows the error of a failed load", async () => {
    const { result } = renderHook(
      () =>
        useSavedList("book-1", {
          load: () => Promise.reject(new Error("load failed")),
          loadErrorKey: "error.loadBookmarks",
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.error).toBe("load failed");
  });

  it("reports whether a change worked, and shows why it did not", async () => {
    const { result } = renderHook(
      () => useSavedList("book-1", { load: async () => [], loadErrorKey: "error.loadBookmarks" }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let worked: boolean | undefined;
    await act(async () => {
      worked = await result.current.change(async () => {}, "error.saveBookmark");
    });
    expect(worked).toBe(true);

    await act(async () => {
      worked = await result.current.change(
        () => Promise.reject(new Error("save failed")),
        "error.saveBookmark",
      );
    });
    expect(worked).toBe(false);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBe("save failed");
  });
});
