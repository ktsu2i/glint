import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BookFile } from "../../../shared/api/books";

const loader = vi.hoisted(() => ({ createPdfLoadingTask: vi.fn() }));
vi.mock("../../../shared/pdf/loadPdf", () => ({
  createPdfLoadingTask: loader.createPdfLoadingTask,
}));

import { usePdfDocument } from "./usePdfDocument";

const book = { id: "book-1", url: "/book/pending" } as BookFile;

function pendingTask() {
  let settle!: { resolve: (task: unknown) => void; reject: (reason: unknown) => void };
  loader.createPdfLoadingTask.mockReturnValue(
    new Promise((resolve, reject) => {
      settle = { resolve, reject };
    }),
  );
  return settle;
}

describe("usePdfDocument", () => {
  beforeEach(() => {
    loader.createPdfLoadingTask.mockReset();
  });

  it("does not report a document that loads after unmount", async () => {
    const task = pendingTask();
    const onLoaded = vi.fn();
    const { unmount } = renderHook(() =>
      usePdfDocument(book, 1, { onBookChange: vi.fn(), onLoaded }),
    );
    unmount();

    task.resolve({ promise: Promise.resolve({ numPages: 1 }), destroy: vi.fn() });
    await act(async () => {});

    expect(onLoaded).not.toHaveBeenCalled();
  });

  it("does not report a failure that arrives after unmount", async () => {
    const task = pendingTask();
    const { result, unmount } = renderHook(() =>
      usePdfDocument(book, 1, { onBookChange: vi.fn(), onLoaded: vi.fn() }),
    );
    unmount();

    task.reject(new Error("late failure"));
    await act(async () => {});

    expect(result.current.error).toBe("");
  });
});
