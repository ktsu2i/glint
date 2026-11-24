import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ saveBookSegments: vi.fn() }));
const loader = vi.hoisted(() => ({
  createPdfLoadingTask: vi.fn(),
  extractPdfPage: vi.fn(),
  loadPdfOutline: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  saveBookSegments: backend.saveBookSegments,
}));

vi.mock("../reader/loadPdf", () => ({
  createPdfLoadingTask: loader.createPdfLoadingTask,
  extractPdfPage: loader.extractPdfPage,
  loadPdfOutline: loader.loadPdfOutline,
}));

import { headingPathForPage, indexBookPages, isAbortError } from "./indexer";

function mockDocument(numPages: number) {
  return { numPages };
}

function mockLoadingTask(numPages: number) {
  const doc = mockDocument(numPages);
  const task = { promise: Promise.resolve(doc), destroy: vi.fn(async () => {}) };
  loader.createPdfLoadingTask.mockResolvedValue(task);
  return task;
}

beforeEach(() => {
  vi.clearAllMocks();
  loader.loadPdfOutline.mockResolvedValue([]);
  loader.extractPdfPage.mockImplementation(async (_doc, pageNumber: number) => ({
    pageNumber,
    text: `page ${pageNumber}`,
    width: 100,
    height: 200,
  }));
});

describe("indexBookPages", () => {
  it("extracts missing pages in 16-page batches and persists each batch", async () => {
    const task = mockLoadingTask(18);
    backend.saveBookSegments.mockImplementation(
      async (_id: string, batch: { ordinal: number }[]) => {
        return batch.at(-1)?.ordinal ?? 0;
      },
    );
    const progress: Array<[number, number]> = [];

    const result = await indexBookPages(
      { id: "book-1", url: "/asset/book-1", nextSegment: 1 },
      {
        signal: new AbortController().signal,
        onProgress: (current, total) => progress.push([current, total]),
      },
    );

    expect(backend.saveBookSegments).toHaveBeenCalledTimes(2);
    expect(backend.saveBookSegments.mock.calls[0]![1]).toHaveLength(16);
    expect(backend.saveBookSegments.mock.calls[1]![1]).toHaveLength(2);
    expect(
      backend.saveBookSegments.mock.calls[1]![1].map((p: { ordinal: number }) => p.ordinal),
    ).toEqual([17, 18]);
    expect(progress.at(-1)).toEqual([18, 18]);
    expect(result).toEqual({ pageCount: 18, persistedCount: 18 });
    expect(task.destroy).toHaveBeenCalled();
  });

  it("resumes from the first missing segment without re-extracting earlier pages", async () => {
    mockLoadingTask(20);
    backend.saveBookSegments.mockResolvedValue(20);

    await indexBookPages(
      { id: "book-1", url: "/asset/book-1", nextSegment: 18 },
      { signal: new AbortController().signal },
    );

    const requestedPages = loader.extractPdfPage.mock.calls.map((call) => call[1]);
    expect(requestedPages).toEqual([18, 19, 20]);
    expect(backend.saveBookSegments).toHaveBeenCalledTimes(1);
  });

  it("returns without persisting when the book is already fully indexed", async () => {
    const task = mockLoadingTask(5);
    const result = await indexBookPages(
      { id: "book-1", url: "/asset/book-1", nextSegment: 6 },
      { signal: new AbortController().signal },
    );
    expect(loader.extractPdfPage).not.toHaveBeenCalled();
    expect(backend.saveBookSegments).not.toHaveBeenCalled();
    expect(result).toEqual({ pageCount: 5, persistedCount: 5 });
    expect(task.destroy).toHaveBeenCalled();
  });

  it("stops mid-batch and rejects with an abort error when the signal fires", async () => {
    mockLoadingTask(10);
    const controller = new AbortController();
    backend.saveBookSegments.mockResolvedValue(0);
    loader.extractPdfPage.mockImplementation(async (_doc, pageNumber: number) => {
      if (pageNumber === 3) {
        controller.abort();
      }
      return { pageNumber, text: "", width: 0, height: 0 };
    });

    await expect(
      indexBookPages(
        { id: "book-1", url: "/asset/book-1", nextSegment: 1 },
        { signal: controller.signal },
      ),
    ).rejects.toSatisfy(isAbortError);
    expect(backend.saveBookSegments).not.toHaveBeenCalled();
  });

  it("saves each page with its location and outline heading path", async () => {
    mockLoadingTask(3);
    loader.loadPdfOutline.mockResolvedValue([
      {
        title: "1章 並行処理",
        pageNumber: 1,
        children: [{ title: "1.1 goroutine", pageNumber: 2, children: [] }],
      },
    ]);
    backend.saveBookSegments.mockResolvedValue(3);

    await indexBookPages(
      { id: "book-1", url: "/asset/book-1", nextSegment: 1 },
      { signal: new AbortController().signal },
    );

    expect(backend.saveBookSegments).toHaveBeenCalledWith(
      "book-1",
      [
        { ordinal: 1, location: "page:1", headingPath: "1章 並行処理", text: "page 1" },
        {
          ordinal: 2,
          location: "page:2",
          headingPath: "1章 並行処理 > 1.1 goroutine",
          text: "page 2",
        },
        {
          ordinal: 3,
          location: "page:3",
          headingPath: "1章 並行処理 > 1.1 goroutine",
          text: "page 3",
        },
      ],
      3,
    );
  });

  it("indexes without headings when the outline cannot be read", async () => {
    mockLoadingTask(1);
    loader.loadPdfOutline.mockRejectedValue(new Error("broken outline"));
    backend.saveBookSegments.mockResolvedValue(1);

    await indexBookPages(
      { id: "book-1", url: "/asset/book-1", nextSegment: 1 },
      { signal: new AbortController().signal },
    );

    expect(backend.saveBookSegments.mock.calls[0]![1][0].headingPath).toBe("");
  });
});

describe("headingPathForPage", () => {
  const outline = [
    { title: "Preface", pageNumber: 1, children: [] },
    {
      title: "Part I",
      pageNumber: 5,
      children: [
        { title: "Chapter 1", pageNumber: 5, children: [] },
        { title: "Unresolved", pageNumber: null, children: [] },
        { title: "Chapter 2", pageNumber: 12, children: [] },
      ],
    },
    {
      title: "  ",
      pageNumber: 30,
      children: [{ title: "Appendix A", pageNumber: 30, children: [] }],
    },
  ];

  it.each([
    [1, "Preface"],
    [4, "Preface"],
    [5, "Part I > Chapter 1"],
    [11, "Part I > Chapter 1"],
    [12, "Part I > Chapter 2"],
    [31, "Appendix A"],
  ])("returns the deepest heading that starts on or before page %i", (page, expected) => {
    expect(headingPathForPage(outline, page)).toBe(expected);
  });

  it("returns an empty path before the first heading or without an outline", () => {
    expect(headingPathForPage([{ title: "Late", pageNumber: 3, children: [] }], 1)).toBe("");
    expect(headingPathForPage([], 1)).toBe("");
  });
});
