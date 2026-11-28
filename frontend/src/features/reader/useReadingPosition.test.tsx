import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookFile } from "../../shared/api/books";

const backend = vi.hoisted(() => ({ saveReadingPosition: vi.fn() }));
vi.mock("./api", () => ({ saveReadingPosition: backend.saveReadingPosition }));

import { useReadingPosition } from "./useReadingPosition";

const book = { id: "book-1" } as BookFile;

describe("useReadingPosition", () => {
  beforeEach(() => {
    backend.saveReadingPosition.mockReset().mockResolvedValue(undefined);
  });

  it("skips a place that was just saved until it is reset", () => {
    const { result } = renderHook(() => useReadingPosition(book));

    result.current.save(3, 10);
    result.current.save(3, 10);
    result.current.save(4, 10, "epubcfi(/6/4)");
    expect(backend.saveReadingPosition).toHaveBeenCalledTimes(2);
    expect(backend.saveReadingPosition).toHaveBeenLastCalledWith("book-1", 4, 10, "epubcfi(/6/4)");

    result.current.reset();
    result.current.save(4, 10, "epubcfi(/6/4)");
    expect(backend.saveReadingPosition).toHaveBeenCalledTimes(3);
  });

  it("ignores places without a book or outside the book", () => {
    const { result, rerender } = renderHook(({ current }) => useReadingPosition(current), {
      initialProps: { current: null as BookFile | null },
    });
    result.current.save(1, 10);

    rerender({ current: book });
    result.current.save(0, 10);
    result.current.save(1, 0);

    expect(backend.saveReadingPosition).not.toHaveBeenCalled();
  });
});
