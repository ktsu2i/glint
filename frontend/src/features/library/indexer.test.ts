import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ saveBookPages: vi.fn() }));
const loader = vi.hoisted(() => ({
  createPdfLoadingTask: vi.fn(),
  extractPdfPage: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  saveBookPages: backend.saveBookPages,
}));

vi.mock("../reader/loadPdf", () => ({
  createPdfLoadingTask: loader.createPdfLoadingTask,
  extractPdfPage: loader.extractPdfPage,
}));

import { indexBookPages, isAbortError } from "./indexer";

function mockDocument(numPages: number) {
  const destroy = vi.fn(async () => undefined);
  return { numPages, destroy };
}

function mockLoadingTask(numPages: number) {
  const doc = mockDocument(numPages);
  loader.createPdfLoadingTask.mockResolvedValue({
    promise: Promise.resolve(doc),
    destroy: vi.fn(),
  });
  return doc;
}

beforeEach(() => {
  vi.clearAllMocks();
  loader.extractPdfPage.mockImplementation(async (_doc, pageNumber: number) => ({
    pageNumber,
    text: `page ${pageNumber}`,
    width: 100,
    height: 200,
  }));
});

describe("indexBookPages", () => {
  it("extracts missing pages in 16-page batches and persists each batch", async () => {
    const doc = mockLoadingTask(18);
    backend.saveBookPages.mockImplementation(async (_id: string, batch: { pageNumber: number }[]) => {
      return batch.at(-1)?.pageNumber ?? 0;
    });
    const progress: Array<[number, number]> = [];

    const result = await indexBookPages(
      { id: "book-1", url: "/asset/book-1", indexedPageCount: 0 },
      {
        signal: new AbortController().signal,
        onProgress: (current, total) => progress.push([current, total]),
      },
    );

    expect(backend.saveBookPages).toHaveBeenCalledTimes(2);
    expect(backend.saveBookPages.mock.calls[0][1]).toHaveLength(16);
    expect(backend.saveBookPages.mock.calls[1][1]).toHaveLength(2);
    expect(backend.saveBookPages.mock.calls[1][1].map((p: { pageNumber: number }) => p.pageNumber))
      .toEqual([17, 18]);
    expect(progress.at(-1)).toEqual([18, 18]);
    expect(result).toEqual({ pageCount: 18, persistedCount: 18 });
    expect(doc.destroy).toHaveBeenCalled();
  });

  it("resumes from the existing indexedPageCount without re-extracting earlier pages", async () => {
    mockLoadingTask(20);
    backend.saveBookPages.mockResolvedValue(20);

    await indexBookPages(
      { id: "book-1", url: "/asset/book-1", indexedPageCount: 17 },
      { signal: new AbortController().signal },
    );

    const requestedPages = loader.extractPdfPage.mock.calls.map((call) => call[1]);
    expect(requestedPages).toEqual([18, 19, 20]);
    expect(backend.saveBookPages).toHaveBeenCalledTimes(1);
  });

  it("returns without persisting when the book is already fully indexed", async () => {
    const doc = mockLoadingTask(5);
    const result = await indexBookPages(
      { id: "book-1", url: "/asset/book-1", indexedPageCount: 5 },
      { signal: new AbortController().signal },
    );
    expect(loader.extractPdfPage).not.toHaveBeenCalled();
    expect(backend.saveBookPages).not.toHaveBeenCalled();
    expect(result).toEqual({ pageCount: 5, persistedCount: 5 });
    expect(doc.destroy).toHaveBeenCalled();
  });

  it("stops mid-batch and rejects with an abort error when the signal fires", async () => {
    mockLoadingTask(10);
    const controller = new AbortController();
    backend.saveBookPages.mockResolvedValue(0);
    loader.extractPdfPage.mockImplementation(async (_doc, pageNumber: number) => {
      if (pageNumber === 3) {
        controller.abort();
      }
      return { pageNumber, text: "", width: 0, height: 0 };
    });

    await expect(
      indexBookPages(
        { id: "book-1", url: "/asset/book-1", indexedPageCount: 0 },
        { signal: controller.signal },
      ),
    ).rejects.toSatisfy(isAbortError);
    expect(backend.saveBookPages).not.toHaveBeenCalled();
  });
});
