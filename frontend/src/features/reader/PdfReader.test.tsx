import { act, fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({
  createPdfLoadingTask: vi.fn(),
  createPdfTextLayer: vi.fn(),
  extractPdfPage: vi.fn(),
  loadPdfOutline: vi.fn(),
}));
const backend = vi.hoisted(() => ({
  addBookmark: vi.fn(),
  addHighlight: vi.fn(),
  changeHighlightColor: vi.fn(),
  listBookmarks: vi.fn(),
  listHighlights: vi.fn(),
  removeBookmark: vi.fn(),
  removeHighlight: vi.fn(),
  saveBindingDirection: vi.fn(),
  saveBookSegments: vi.fn(),
  searchBook: vi.fn(),
  setWindowControlsVisible: vi.fn(),
}));

vi.mock("./loadPdf", () => ({
  createPdfLoadingTask: loader.createPdfLoadingTask,
  createPdfTextLayer: loader.createPdfTextLayer,
  extractPdfPage: loader.extractPdfPage,
  loadPdfOutline: loader.loadPdfOutline,
}));
vi.mock("../../shared/api/backend", () => ({
  addBookmark: backend.addBookmark,
  addHighlight: backend.addHighlight,
  changeHighlightColor: backend.changeHighlightColor,
  listBookmarks: backend.listBookmarks,
  listHighlights: backend.listHighlights,
  removeBookmark: backend.removeBookmark,
  removeHighlight: backend.removeHighlight,
  saveBindingDirection: backend.saveBindingDirection,
  saveBookSegments: backend.saveBookSegments,
  searchBook: backend.searchBook,
  setWindowControlsVisible: backend.setWindowControlsVisible,
}));
vi.mock("../../shared/components/ToolButton", () => ({
  ToolButton: ({
    label,
    className = "",
    disabled = false,
    expanded,
    onClick,
    children,
  }: {
    label: string;
    className?: string;
    disabled?: boolean;
    expanded?: boolean;
    onClick?: () => void;
    children: React.ReactNode;
  }) => (
    <button
      aria-label={label}
      aria-expanded={expanded}
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

import { PdfReader } from "./PdfReader";
import { I18nProvider } from "../../shared/i18n/i18n";

function render(ui: ReactNode) {
  return renderBase(ui, {
    wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider>,
  });
}
import type { BookFile } from "../../shared/api/backend";

type ResizeCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

const resize = {
  callbacks: [] as ResizeCallback[],
  observe: vi.fn(),
  disconnect: vi.fn(),
};

class FakeResizeObserver {
  constructor(callback: ResizeCallback) {
    resize.callbacks.push(callback);
  }

  observe = resize.observe;
  disconnect = resize.disconnect;
}

function makePage(overrides: Record<string, unknown> = {}) {
  const renderTask = {
    promise: Promise.resolve(),
    cancel: vi.fn(),
  };
  return {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({
      width: 200 * scale,
      height: 100 * scale,
    })),
    render: vi.fn(() => renderTask),
    getTextContent: vi.fn(async () => ({
      items: [
        { str: "Alpha", hasEOL: true },
        { str: "Beta", hasEOL: false },
        { type: "marked-content" },
      ],
    })),
    renderTask,
    ...overrides,
  };
}

function makeDocument(page = makePage()) {
  return {
    numPages: 2,
    getPage: vi.fn(async (_pageNumber: number) => page),
  };
}

function makeBook(url = "/book/1", indexedPageCount = 2): BookFile {
  return {
    id: "book-1",
    title: "Guide",
    name: "Guide.pdf",
    url,
    size: 10,
    initialPage: 1,
    indexedPageCount,
    nextSegment: indexedPageCount + 1,
    coverStatus: "pending",
  };
}

function resolveDocument(document = makeDocument()) {
  const task = { promise: Promise.resolve(document), destroy: vi.fn(async () => {}) };
  loader.createPdfLoadingTask.mockResolvedValue(task);
  return { task, document };
}

beforeEach(() => {
  vi.clearAllMocks();
  resize.callbacks = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
  loader.createPdfTextLayer.mockImplementation(async () => ({
    render: vi.fn(async () => {}),
    cancel: vi.fn(),
  }));
  loader.extractPdfPage.mockImplementation(
    async (document: ReturnType<typeof makeDocument>, pageNumber: number) => {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      return {
        pageNumber,
        text: textContent.items
          .filter((item: { str?: string }) => "str" in item)
          .map(
            (item: { str?: string; hasEOL?: boolean }) =>
              `${item.str ?? ""}${item.hasEOL === true ? "\n" : " "}`,
          )
          .join("")
          .trim(),
        width: viewport.width,
        height: viewport.height,
      };
    },
  );
  loader.loadPdfOutline.mockResolvedValue([]);
  backend.saveBookSegments.mockImplementation(
    async (_bookId: string, pages: Array<{ pageNumber: number }>) => pages.at(-1)?.pageNumber ?? 0,
  );
  backend.searchBook.mockResolvedValue([]);
  backend.listBookmarks.mockResolvedValue([]);
  backend.addBookmark.mockImplementation(async (_bookId: string, pageNumber: number) => ({
    pageNumber,
    createdAt: "2026-06-23T00:00:00Z",
  }));
  backend.removeBookmark.mockResolvedValue(undefined);
  backend.listHighlights.mockResolvedValue([]);
  backend.addHighlight.mockImplementation(
    async (_bookId: string, input: { pageCount: number } & Record<string, unknown>) => {
      const { pageCount: _pageCount, ...rest } = input;
      return { ...rest, id: 41, createdAt: "2026-11-25T00:00:00Z" };
    },
  );
  backend.removeHighlight.mockResolvedValue(undefined);
  backend.changeHighlightColor.mockImplementation(
    async (_bookId: string, id: number, color: string) => ({
      id,
      pageNumber: 1,
      color,
      text: "Alpha Beta",
      rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.1 }],
      createdAt: "2026-11-25T00:00:00Z",
    }),
  );
  backend.setWindowControlsVisible.mockResolvedValue(undefined);
  backend.saveBindingDirection.mockResolvedValue(undefined);
});

describe("PdfReader", () => {
  it("renders the empty state and resets the page", () => {
    const onPageChange = vi.fn();
    const { unmount } = render(<PdfReader book={null} onPageChange={onPageChange} />);

    expect(screen.getByText("本とコードのあいだを読む。")).toBeTruthy();
    expect(onPageChange).toHaveBeenCalledWith(0, 0);
    unmount();
  });

  it("loads, renders, navigates, and adjusts zoom", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    const page = makePage();
    const { task, document } = resolveDocument(makeDocument(page));
    const onPageChange = vi.fn();
    const { unmount } = render(<PdfReader book={makeBook()} onPageChange={onPageChange} />);

    await waitFor(() =>
      expect(loader.createPdfLoadingTask).toHaveBeenCalledWith("/book/1", expect.any(AbortSignal)),
    );

    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1, 2));
    expect(page.render).toHaveBeenCalledWith(
      expect.objectContaining({
        transform: [2, 0, 0, 2, 0, 0],
      }),
    );
    expect(screen.getByText("200%")).toBeTruthy();

    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 1000, height: 300 } }]));
    await screen.findByText("300%");
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 20, height: 300 } }]));
    await screen.findByText("10%");

    fireEvent.click(screen.getByRole("button", { name: "拡大" }));
    await screen.findByText("40%");
    expect(screen.getByRole("button", { name: "全体を表示" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "縮小" }));
    await screen.findByText("40%");
    fireEvent.click(screen.getByRole("button", { name: "全体を表示" }));
    expect(screen.getByRole("button", { name: "全体を表示" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await waitFor(() => expect(document.getPage).toHaveBeenCalledWith(2));
    expect(screen.getByRole("button", { name: "次のページ" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "前のページ" }));
    await waitFor(() => expect(document.getPage).toHaveBeenLastCalledWith(1));

    unmount();
    expect(page.renderTask.cancel).toHaveBeenCalled();
    expect(task.destroy).toHaveBeenCalled();
  });

  it("reads the extracted page text aloud", async () => {
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", {
      speak,
      cancel: vi.fn(),
      getVoices: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        lang = "";
        voice: unknown = null;
        constructor(readonly text: string) {}
        addEventListener() {}
      },
    );
    resolveDocument(makeDocument());
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);

    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    const button = screen.getByRole("button", { name: "読み上げを開始" });
    await waitFor(() => expect(button).toHaveProperty("disabled", false));
    fireEvent.click(button);

    await waitFor(() => expect(speak).toHaveBeenCalled());
    expect(speak.mock.calls[0]?.[0]).toMatchObject({ text: "Alpha\nBeta" });
  });

  it("jumps to a page typed in the toolbar input and clamps invalid values", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 12;
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    let input = screen.getByLabelText<HTMLInputElement>("ページ番号");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(7));
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("7 ");

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    input = screen.getByLabelText<HTMLInputElement>("ページ番号");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(12));
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("12 ");

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    input = screen.getByLabelText<HTMLInputElement>("ページ番号");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(pdfDocument.getPage).toHaveBeenLastCalledWith(12);
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("12 ");

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    input = screen.getByLabelText<HTMLInputElement>("ページ番号");
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("12 ");
  });

  it("jumps with the bottom page slider and resets the reader scroll position", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 12;
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    const stage = globalThis.document.querySelector(".pdf-stage") as HTMLDivElement;
    stage.scrollTop = 180;
    stage.scrollLeft = 90;
    const slider = screen.getByRole<HTMLInputElement>("slider", { name: "ページスライダー" });
    expect(slider.min).toBe("1");
    expect(slider.max).toBe("12");
    expect(slider.value).toBe("1");
    expect(slider.getAttribute("aria-valuetext")).toBe("12ページ中1ページ");

    fireEvent.change(slider, { target: { value: "8" } });

    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(8));
    expect(slider.value).toBe("8");
    expect(slider.getAttribute("aria-valuetext")).toBe("12ページ中8ページ");
    expect(stage.scrollTop).toBe(0);
    expect(stage.scrollLeft).toBe(0);
  });

  it("shows bookmarks on the page slider and jumps from their markers", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 12;
    backend.listBookmarks.mockResolvedValue([
      { pageNumber: 4, createdAt: "2026-06-23T00:00:00Z" },
      { pageNumber: 10, createdAt: "2026-06-23T00:01:00Z" },
    ]);
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    const pageFourMarker = await screen.findByRole("button", { name: "しおり付きの4ページへ移動" });
    expect(pageFourMarker.parentElement?.className).toBe("reader-slider-bookmarks");
    expect(pageFourMarker.getAttribute("style")).toContain("27.2727");
    expect(pageFourMarker.querySelector("svg")).toBeNull();
    expect(pageFourMarker.querySelector(".reader-slider-bookmark-dot")).toBeTruthy();
    expect(screen.getByRole("button", { name: "しおり付きの10ページへ移動" })).toBeTruthy();

    fireEvent.click(pageFourMarker);

    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(4));
    expect(pageFourMarker.getAttribute("aria-current")).toBe("page");
  });

  it("hides bookmarks beyond the last page of a revised document", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 12;
    backend.listBookmarks.mockResolvedValue([
      { pageNumber: 4, createdAt: "2026-06-23T00:00:00Z" },
      { pageNumber: 30, createdAt: "2026-06-23T00:01:00Z" },
    ]);
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    expect(await screen.findByRole("button", { name: "しおり付きの4ページへ移動" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "しおり付きの30ページへ移動" })).toBeNull();
  });

  it("resets the reader scroll position after button, page input, and TOC navigation", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 12;
    resolveDocument(pdfDocument);
    loader.loadPdfOutline.mockResolvedValue([{ title: "第2章", pageNumber: 9, children: [] }]);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    const stage = globalThis.document.querySelector(".pdf-stage") as HTMLDivElement;
    stage.scrollTop = 180;
    stage.scrollLeft = 90;
    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));
    expect(stage.scrollTop).toBe(0);
    expect(stage.scrollLeft).toBe(0);

    stage.scrollTop = 180;
    stage.scrollLeft = 90;
    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    const input = screen.getByLabelText<HTMLInputElement>("ページ番号");
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(7));
    expect(stage.scrollTop).toBe(0);
    expect(stage.scrollLeft).toBe(0);

    stage.scrollTop = 180;
    stage.scrollLeft = 90;
    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    fireEvent.click(await screen.findByRole("button", { name: /第2章/ }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(9));
    expect(stage.scrollTop).toBe(0);
    expect(stage.scrollLeft).toBe(0);
  });

  it("turns pages with arrow keys and ignores them inside editable elements", async () => {
    const pdfDocument = makeDocument();
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.keyDown(globalThis.window, { key: "ArrowRight" });
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(2));

    fireEvent.keyDown(globalThis.window, { key: "ArrowRight" });
    expect(pdfDocument.getPage).toHaveBeenLastCalledWith(2);

    fireEvent.keyDown(globalThis.window, { key: "ArrowLeft" });
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(1));

    fireEvent.keyDown(globalThis.window, { key: "ArrowLeft" });
    expect(pdfDocument.getPage).toHaveBeenLastCalledWith(1);

    const input = globalThis.document.createElement("input");
    globalThis.document.body.append(input);
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(pdfDocument.getPage).toHaveBeenLastCalledWith(1);
    input.remove();

    fireEvent.keyDown(globalThis.window, { key: "ArrowRight", metaKey: true });
    expect(pdfDocument.getPage).toHaveBeenLastCalledWith(1);
  });

  it("zooms manually on a ctrl+wheel pinch gesture and ignores plain scrolls", async () => {
    const page = makePage();
    resolveDocument(makeDocument(page));
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await screen.findByText("200%");

    const stage = globalThis.document.querySelector(".pdf-stage") as HTMLDivElement;
    const plainEvent = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => {
      stage.dispatchEvent(plainEvent);
    });
    expect(plainEvent.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "全体を表示" }).getAttribute("aria-pressed")).toBe(
      "true",
    );

    const pinchEvent = new WheelEvent("wheel", {
      deltaY: -20,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      stage.dispatchEvent(pinchEvent);
    });
    expect(pinchEvent.defaultPrevented).toBe(true);
    await screen.findByText("244%");
    expect(screen.getByRole("button", { name: "全体を表示" }).getAttribute("aria-pressed")).toBe(
      "false",
    );

    const zoomOutEvent = new WheelEvent("wheel", {
      deltaY: 400,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      stage.dispatchEvent(zoomOutEvent);
    });
    await screen.findByText("40%");
  });

  it("fits the whole page when height is the limiting dimension", async () => {
    const page = makePage({
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        width: 200 * scale,
        height: 400 * scale,
      })),
    });
    resolveDocument(makeDocument(page));
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));

    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    await screen.findByText("75%");
    expect(page.getViewport).toHaveBeenLastCalledWith({ scale: 0.75 });
    const canvas = globalThis.document.querySelector(".pdf-canvas") as HTMLCanvasElement;
    expect(canvas.style.width).toBe("150px");
    expect(canvas.style.height).toBe("300px");
    expect(screen.getByRole("button", { name: "全体を表示" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("restores and clamps the saved reading position", async () => {
    const pdfDocument = makeDocument();
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} initialPage={9} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("2 / 2");
  });

  it.each([
    [new Error("broken PDF"), "broken PDF"],
    ["unknown", "PDFを開けませんでした。"],
  ])("reports document loading failures", async (reason, message) => {
    loader.createPdfLoadingTask.mockRejectedValue(reason);
    render(<PdfReader book={makeBook("/book/broken")} onPageChange={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
  });

  it("reports a load timeout and destroys an initialized loading task", async () => {
    vi.useFakeTimers();
    const task = { promise: new Promise(() => {}), destroy: vi.fn(async () => {}) };
    loader.createPdfLoadingTask.mockResolvedValue(task);
    render(<PdfReader book={makeBook("/book/slow")} onPageChange={vi.fn()} />);
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("alert").textContent).toContain("タイムアウト");
    expect(task.destroy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  // oxlint-disable-next-line vitest/expect-expect -- unmount 後の resolve で例外や state 更新が起きないことを確認する。
  it("does not update state after an unfinished load is unmounted", async () => {
    let resolveTask!: (task: unknown) => void;
    loader.createPdfLoadingTask.mockReturnValue(
      new Promise((resolve) => {
        resolveTask = resolve;
      }),
    );
    const { unmount } = render(
      <PdfReader book={makeBook("/book/pending")} onPageChange={vi.fn()} />,
    );
    unmount();

    resolveTask({ promise: Promise.resolve(makeDocument()), destroy: vi.fn() });
    await act(async () => {});
  });

  // oxlint-disable-next-line vitest/expect-expect -- unmount 後の reject で例外や state 更新が起きないことを確認する。
  it("ignores a loading failure after unmount", async () => {
    let rejectTask!: (reason: unknown) => void;
    loader.createPdfLoadingTask.mockReturnValue(
      new Promise((_, reject) => {
        rejectTask = reject;
      }),
    );
    const { unmount } = render(
      <PdfReader book={makeBook("/book/pending")} onPageChange={vi.fn()} />,
    );
    unmount();

    rejectTask(new Error("late failure"));
    await act(async () => {});
  });

  it("renders at unit device scale", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 0 });
    const page = makePage();
    resolveDocument(makeDocument(page));
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 200, height: 100 } }]));

    await waitFor(() =>
      expect(page.render).toHaveBeenCalledWith(
        expect.objectContaining({
          transform: undefined,
        }),
      ),
    );
  });

  it("falls back to unit scale when the viewport ratio is zero", async () => {
    const page = makePage({
      getViewport: vi
        .fn()
        .mockReturnValueOnce({ width: Number.POSITIVE_INFINITY, height: 100 })
        .mockReturnValueOnce({ width: 200, height: 100 }),
    });
    resolveDocument(makeDocument(page));
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 200, height: 100 } }]));

    await waitFor(() =>
      expect(page.render).toHaveBeenCalledWith(
        expect.objectContaining({
          viewport: { width: 200, height: 100 },
        }),
      ),
    );
  });

  it("reports canvas and non-Error rendering failures", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    resolveDocument();
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Canvasを初期化できませんでした。",
    );
  });

  it("uses the generic rendering error for non-Error rejections", async () => {
    resolveDocument({
      numPages: 2,
      getPage: vi.fn(async () => {
        // oxlint-disable-next-line eslint/no-throw-literal, typescript/only-throw-error -- Error 以外の reject 値の扱いを検証する。
        throw "bad render";
      }),
    });
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "ページを描画できませんでした。",
    );
  });

  it("ignores PDF.js render cancellation errors", async () => {
    const cancellation = new Error("cancelled");
    cancellation.name = "RenderingCancelledException";
    resolveDocument({
      numPages: 1,
      getPage: vi.fn(async () => {
        throw cancellation;
      }),
    });
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await act(async () => {});

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops rendering work after unmount", async () => {
    let resolvePage!: (page: ReturnType<typeof makePage>) => void;
    const document = {
      numPages: 1,
      getPage: vi.fn(
        () =>
          new Promise<ReturnType<typeof makePage>>((resolve) => {
            resolvePage = resolve;
          }),
      ),
    };
    resolveDocument(document);
    const { unmount } = render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(document.getPage).toHaveBeenCalled());
    unmount();
    resolvePage(makePage());
    await act(async () => {});
  });

  it("renders two pages side by side in spread mode", async () => {
    const pageOne = makePage({
      getTextContent: vi.fn(async () => ({
        items: [{ str: "First", hasEOL: false }],
      })),
    });
    const pageTwo = makePage({
      getTextContent: vi.fn(async () => ({
        items: [{ str: "Second", hasEOL: false }],
      })),
    });
    const pdfDocument = {
      numPages: 4,
      getPage: vi.fn(async (...args: unknown[]) => (args[0] === 1 ? pageOne : pageTwo)),
    };
    resolveDocument(pdfDocument);
    const onPageChange = vi.fn();
    render(<PdfReader book={makeBook()} onPageChange={onPageChange} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "両開き" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));

    const canvases = globalThis.document.querySelectorAll(".pdf-canvas");
    expect(canvases.length).toBe(2);
    expect(canvases[0]!.getAttribute("aria-label")).toBe("1ページ");
    expect(canvases[1]!.getAttribute("aria-label")).toBe("2ページ");
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("1–2");
    await waitFor(() => expect(onPageChange).toHaveBeenCalledWith(1, 4));
  });

  it("commits both spread pages together after rendering them in parallel during zoom", async () => {
    const pageOne = makePage();
    const pageTwo = makePage();
    const pdfDocument = {
      numPages: 4,
      getPage: vi.fn(async (number: number) => (number === 1 ? pageOne : pageTwo)),
    };
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pageOne.render).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "両開き" }));
    await waitFor(() => expect(pageTwo.render).toHaveBeenCalledTimes(1));
    await screen.findByText("200%");

    let resolveLeft!: () => void;
    let resolveRight!: () => void;
    pageOne.render.mockImplementationOnce(() => ({
      promise: new Promise<void>((resolve) => {
        resolveLeft = resolve;
      }),
      cancel: vi.fn(),
    }));
    pageTwo.render.mockImplementationOnce(() => ({
      promise: new Promise<void>((resolve) => {
        resolveRight = resolve;
      }),
      cancel: vi.fn(),
    }));

    const [leftCanvas, rightCanvas] = Array.from(
      globalThis.document.querySelectorAll<HTMLCanvasElement>(".pdf-canvas"),
    );
    expect(leftCanvas!.style.width).toBe("400px");
    expect(rightCanvas!.style.width).toBe("400px");

    fireEvent.click(screen.getByRole("button", { name: "拡大" }));
    await waitFor(() => expect(pageOne.render).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(pageTwo.render).toHaveBeenCalledTimes(2));
    expect(leftCanvas!.style.width).toBe("400px");
    expect(rightCanvas!.style.width).toBe("400px");

    await act(async () => resolveLeft());
    expect(leftCanvas!.style.width).toBe("400px");
    expect(rightCanvas!.style.width).toBe("400px");

    await act(async () => resolveRight());
    await waitFor(() => expect(leftCanvas!.style.width).toBe("420px"));
    expect(rightCanvas!.style.width).toBe("420px");
  });

  it("advances by two pages with the next button and arrow keys in spread mode", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 6;
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "両開き" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));

    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(3));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(4));

    fireEvent.keyDown(globalThis.window, { key: "ArrowRight" });
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(5));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(6));

    expect(screen.getByRole("button", { name: "次のページ" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "前のページ" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(4));
  });

  it("renders a single canvas in spread mode when on the last page", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 1;
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "両開き" }));

    const canvases = globalThis.document.querySelectorAll(".pdf-canvas");
    expect(canvases.length).toBe(1);
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("1 / 1");
  });

  it("toggles back from spread to single page view", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 4;
    resolveDocument(pdfDocument);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "両開き" }));
    await waitFor(() => expect(globalThis.document.querySelectorAll(".pdf-canvas").length).toBe(2));

    fireEvent.click(screen.getByRole("button", { name: "片開き" }));
    await waitFor(() => expect(globalThis.document.querySelectorAll(".pdf-canvas").length).toBe(1));
  });

  it("renders the text layer over each rendered page and cancels on unmount", async () => {
    const pageOne = makePage({
      getTextContent: vi.fn(async () => ({
        items: [{ str: "Left", hasEOL: false }],
      })),
    });
    const pageTwo = makePage({
      getTextContent: vi.fn(async () => ({
        items: [{ str: "Right", hasEOL: false }],
      })),
    });
    const pdfDocument = {
      numPages: 4,
      getPage: vi.fn(async (...args: unknown[]) => (args[0] === 1 ? pageOne : pageTwo)),
    };
    resolveDocument(pdfDocument);
    const textLayerOne = { render: vi.fn(async () => {}), cancel: vi.fn() };
    const textLayerTwo = { render: vi.fn(async () => {}), cancel: vi.fn() };
    loader.createPdfTextLayer
      .mockResolvedValueOnce(textLayerOne)
      .mockResolvedValueOnce(textLayerTwo);
    const { unmount } = render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    fireEvent.click(screen.getByRole("button", { name: "両開き" }));

    await waitFor(() => expect(loader.createPdfTextLayer).toHaveBeenCalledTimes(2));
    const containers = globalThis.document.querySelectorAll<HTMLElement>(".text-layer[data-page]");
    expect(containers.length).toBe(2);
    expect(containers[0]!.dataset.page).toBe("1");
    expect(containers[1]!.dataset.page).toBe("2");
    expect((containers[0] as HTMLElement).style.getPropertyValue("--total-scale-factor")).not.toBe(
      "",
    );
    expect(textLayerOne.render).toHaveBeenCalled();
    expect(textLayerTwo.render).toHaveBeenCalled();

    unmount();
    expect(textLayerOne.cancel).toHaveBeenCalled();
    expect(textLayerTwo.cancel).toHaveBeenCalled();
  });

  it("opens an empty TOC panel when the PDF has no outline", async () => {
    resolveDocument();
    loader.loadPdfOutline.mockResolvedValue([]);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(loader.loadPdfOutline).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "目次を閉じる" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    await screen.findByText("目次データが見つかりませんでした。");
    expect(screen.getByRole("button", { name: "目次を閉じる" })).toBeTruthy();
  });

  it("hides the floating controls while reading and brings them back on demand", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 6;
    resolveDocument(pdfDocument);
    const onBack = vi.fn();
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} onBack={onBack} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    const reader = screen.getByRole("region", { name: "PDFリーダー" });
    const stage = globalThis.document.querySelector(".pdf-stage") as HTMLDivElement;
    expect(reader.className).toContain("is-chrome-visible");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(reader.className).not.toContain("is-chrome-visible"));
    expect(globalThis.document.querySelector(".reader-status")?.textContent).toBe("2 / 6");

    fireEvent.click(stage);
    expect(reader.className).toContain("is-chrome-visible");
    fireEvent.click(stage);
    expect(reader.className).not.toContain("is-chrome-visible");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(reader.className).toContain("is-chrome-visible");

    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    expect(screen.getByRole("complementary", { name: "目次" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "目次" })).toBeNull();
    expect(reader.className).toContain("is-chrome-visible");

    fireEvent.click(screen.getByRole("button", { name: "しおりを開く" }));
    fireEvent.click(stage);
    expect(screen.queryByRole("complementary", { name: "しおり" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "本の中を検索" }));
    fireEvent.click(screen.getByRole("button", { name: "パネルを閉じる" }));
    expect(screen.queryByRole("complementary", { name: "本文検索" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "本棚" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("hides the window controls with the toolbars and restores them on close", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 6;
    resolveDocument(pdfDocument);
    const { unmount } = render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));
    expect(backend.setWindowControlsVisible).toHaveBeenLastCalledWith(true);

    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(backend.setWindowControlsVisible).toHaveBeenLastCalledWith(false));

    const topbar = globalThis.document.querySelector(".reader-topbar") as HTMLElement;
    fireEvent.mouseEnter(topbar);
    expect(backend.setWindowControlsVisible).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(topbar);
    await waitFor(() => expect(backend.setWindowControlsVisible).toHaveBeenLastCalledWith(false));

    unmount();
    expect(backend.setWindowControlsVisible).toHaveBeenLastCalledWith(true);
  });

  it("persists page bookmarks, navigates from the bookmark panel, and removes them", async () => {
    const pdfDocument = makeDocument();
    resolveDocument(pdfDocument);
    backend.listBookmarks.mockResolvedValue([
      {
        pageNumber: 2,
        createdAt: "2026-06-23T00:00:00Z",
      },
    ]);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 500, height: 300 } }]));
    await waitFor(() => expect(backend.listBookmarks).toHaveBeenCalledWith("book-1"));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "しおりを開く" }));
    expect(await screen.findByText("2ページ")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "しおりの2ページへ移動" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));

    fireEvent.click(screen.getAllByRole("button", { name: "2ページのしおりを削除" })[0]!);
    await waitFor(() => expect(backend.removeBookmark).toHaveBeenCalledWith("book-1", 2));
    expect(screen.queryByText("2ページ")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "前のページ" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(1));
    fireEvent.click(screen.getByRole("button", { name: "1ページをしおりに保存" }));
    await waitFor(() => expect(backend.addBookmark).toHaveBeenCalledWith("book-1", 1, 2));
    expect(await screen.findByText("1ページ")).toBeTruthy();
  });

  it("lists highlights, draws them on their page, jumps to them, and removes them", async () => {
    const pdfDocument = makeDocument();
    resolveDocument(pdfDocument);
    backend.listHighlights.mockResolvedValue([
      {
        id: 7,
        pageNumber: 2,
        color: "green",
        text: "依存の向きは一方向に保つ",
        rects: [{ x: 0.1, y: 0.2, width: 0.5, height: 0.03 }],
        createdAt: "2026-11-25T00:00:00Z",
      },
    ]);
    const { container } = render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 500, height: 300 } }]));
    await waitFor(() => expect(backend.listHighlights).toHaveBeenCalledWith("book-1"));
    await waitFor(() => expect(container.querySelector(".pdf-page[data-page='1']")).toBeTruthy());
    expect(container.querySelector(".highlight-mark")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "ハイライトを開く" }));
    expect(await screen.findByText("依存の向きは一方向に保つ")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "2ページのハイライトへ移動" }));
    await waitFor(() => expect(container.querySelector(".pdf-page[data-page='2']")).toBeTruthy());
    const mark = container.querySelector<HTMLElement>(".highlight-mark.is-green");
    expect(mark?.style.left).toBe("10%");
    expect(mark?.style.width).toBe("50%");

    fireEvent.click(screen.getByRole("button", { name: "2ページのハイライトを削除" }));
    await waitFor(() => expect(backend.removeHighlight).toHaveBeenCalledWith("book-1", 7));
    expect(screen.queryByText("依存の向きは一方向に保つ")).toBeNull();
    expect(container.querySelector(".highlight-mark")).toBeNull();
    expect(
      screen.getByText("ページの文章を選択して色を選ぶと、ハイライトを引けます。"),
    ).toBeTruthy();
  });

  it("highlights a text selection in the chosen color and removes it from the page", async () => {
    resolveDocument();
    const { container } = render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 500, height: 300 } }]));
    await waitFor(() => expect(container.querySelector(".pdf-page[data-page='1']")).toBeTruthy());
    await waitFor(() => expect(loader.createPdfTextLayer).toHaveBeenCalled());

    const page = container.querySelector<HTMLElement>(".pdf-page[data-page='1']")!;
    page.getBoundingClientRect = () => new DOMRect(0, 0, 200, 100);
    const span = globalThis.document.createElement("span");
    span.textContent = "Alpha Beta";
    page.querySelector(".text-layer")!.append(span);
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => [new DOMRect(20, 10, 100, 10)],
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(20, 10, 100, 10),
    });
    try {
      window.getSelection()!.selectAllChildren(span);
      fireEvent.mouseUp(container.querySelector(".pdf-stage")!);

      fireEvent.click(await screen.findByRole("button", { name: "黄色でハイライト" }));
      await waitFor(() =>
        expect(backend.addHighlight).toHaveBeenCalledWith("book-1", {
          pageNumber: 1,
          pageCount: 2,
          color: "yellow",
          text: "Alpha Beta",
          rects: [{ x: 0.1, y: 0.1, width: 0.5, height: 0.1 }],
        }),
      );
      await waitFor(() =>
        expect(container.querySelector(".highlight-mark.is-yellow")).toBeTruthy(),
      );
      expect(screen.queryByRole("toolbar", { name: "選択した文章をハイライト" })).toBeNull();
      expect(window.getSelection()?.isCollapsed).toBe(true);

      fireEvent.click(container.querySelector(".pdf-stage")!, { clientX: 60, clientY: 15 });
      const actions = await screen.findByRole("toolbar", { name: "ハイライト" });
      expect(screen.getByRole("button", { name: "黄色に変更" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      fireEvent.click(screen.getByRole("button", { name: "紫に変更" }));
      await waitFor(() =>
        expect(backend.changeHighlightColor).toHaveBeenCalledWith("book-1", 41, "purple"),
      );
      await waitFor(() =>
        expect(container.querySelector(".highlight-mark.is-purple")).toBeTruthy(),
      );
      expect(container.querySelector(".highlight-mark.is-yellow")).toBeNull();
      expect(screen.getByRole("button", { name: "紫に変更" }).getAttribute("aria-pressed")).toBe(
        "true",
      );
      expect(actions.textContent).toBe("");

      fireEvent.click(screen.getByRole("button", { name: "ハイライトを削除" }));
      await waitFor(() => expect(backend.removeHighlight).toHaveBeenCalledWith("book-1", 41));
      expect(container.querySelector(".highlight-mark")).toBeNull();
    } finally {
      Reflect.deleteProperty(Range.prototype, "getClientRects");
      Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
    }
  });

  it("renders nested outline items, jumps on click, and highlights the active section", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 50;
    resolveDocument(pdfDocument);
    loader.loadPdfOutline.mockResolvedValue([
      {
        title: "第1章 はじめに",
        pageNumber: 1,
        children: [
          { title: "1.1 背景", pageNumber: 3, children: [] },
          { title: "1.2 目的", pageNumber: 7, children: [] },
        ],
      },
      { title: "第2章 設計", pageNumber: 12, children: [] },
      { title: "巻末資料", pageNumber: null, children: [] },
    ]);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(loader.loadPdfOutline).toHaveBeenCalled());
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    const introItem = await screen.findByRole("button", { name: /第1章 はじめに/ });
    expect(introItem.className).toContain("is-active");
    expect(screen.getByRole("button", { name: /巻末資料/ })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: /1\.2 目的/ }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(7));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /1\.2 目的/ }).className).toContain("is-active"),
    );

    fireEvent.click(screen.getByRole("button", { name: /第2章 設計/ }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(12));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /第2章 設計/ }).className).toContain("is-active"),
    );
  });

  it("clamps outline destinations to the document length", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 4;
    resolveDocument(pdfDocument);
    loader.loadPdfOutline.mockResolvedValue([
      { title: "巨大なセクション", pageNumber: 999, children: [] },
    ]);
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(loader.loadPdfOutline).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    fireEvent.click(await screen.findByRole("button", { name: /巨大なセクション/ }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(4));
  });

  it("searches the indexed book, highlights excerpts, and jumps to a result page", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 6;
    resolveDocument(pdfDocument);
    backend.searchBook.mockResolvedValue([
      {
        pageNumber: 4,
        excerpt: "A bounded context builder keeps evidence visible.",
        matchCount: 2,
      },
      {
        pageNumber: 6,
        excerpt: "Another context builder appears here.",
        matchCount: 1,
      },
    ]);
    render(<PdfReader book={makeBook("/book/1", 6)} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 500, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    let input = await screen.findByRole("searchbox", { name: "本の中を検索" });
    await waitFor(() => expect(globalThis.document.activeElement).toBe(input));

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(screen.queryByRole("searchbox", { name: "本の中を検索" })).toBeNull();

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    input = await screen.findByRole("searchbox", { name: "本の中を検索" });
    await waitFor(() => expect(globalThis.document.activeElement).toBe(input));
    fireEvent.change(input, { target: { value: "context builder" } });
    fireEvent.submit(input.closest("form")!);

    await waitFor(() =>
      expect(backend.searchBook).toHaveBeenCalledWith("book-1", "context builder"),
    );
    expect(await screen.findByText("2ページで見つかりました")).toBeTruthy();
    expect(globalThis.document.querySelectorAll(".reader-search-excerpt mark")).toHaveLength(4);
    expect(screen.getByText("一致 2")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "4ページへ移動" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(4));
    expect(screen.getByRole("button", { name: "4ページへ移動" }).className).toContain("is-active");
  });

  it("keeps reading available when search fails", async () => {
    const pdfDocument = makeDocument();
    resolveDocument(pdfDocument);
    backend.searchBook.mockRejectedValue(new Error("search unavailable"));
    render(<PdfReader book={makeBook("/book/1", 0)} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 500, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "本の中を検索" }));
    const input = await screen.findByRole("searchbox", { name: "本の中を検索" });
    fireEvent.change(input, { target: { value: "evidence" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "search unavailable");

    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));
  });

  it("does not publish scale or text after an in-flight render is unmounted", async () => {
    let resolveRender!: () => void;
    const page = makePage({
      render: vi.fn(() => ({
        promise: new Promise<void>((resolve) => {
          resolveRender = resolve;
        }),
        cancel: vi.fn(),
      })),
    });
    const document = makeDocument(page);
    resolveDocument(document);
    const onPageChange = vi.fn();
    const { unmount } = render(<PdfReader book={makeBook()} onPageChange={onPageChange} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 200, height: 100 } }]));
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    onPageChange.mockClear();
    unmount();
    resolveRender();
    await act(async () => {});

    expect(onPageChange).not.toHaveBeenCalled();
  });

  it("keeps the page layout, binding, and zoom in the view menu", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 6;
    resolveDocument(pdfDocument);
    window.localStorage.clear();
    render(<PdfReader book={makeBook()} onPageChange={vi.fn()} />);
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    expect(screen.queryByRole("dialog", { name: "表示" })).toBeNull();
    const toggle = screen.getByRole("button", { name: "表示" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "表示" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "片開き" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("左から右へ読みます。")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "右綴じ" }));
    expect(screen.getByRole("button", { name: "右綴じ" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("右から左へ読みます。")).toBeTruthy();
    expect(backend.saveBindingDirection).toHaveBeenLastCalledWith("book-1", "rtl");
    fireEvent.click(screen.getByRole("button", { name: "両開き" }));
    await waitFor(() =>
      expect(globalThis.document.querySelector(".pdf-spread")?.className).toBe(
        "pdf-spread is-spread is-rtl",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "左綴じ" }));
    expect(backend.saveBindingDirection).toHaveBeenLastCalledWith("book-1", "ltr");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "表示" })).toBeNull();
    fireEvent.click(toggle);
    fireEvent.click(globalThis.document.querySelector(".pdf-stage")!);
    expect(screen.queryByRole("dialog", { name: "表示" })).toBeNull();
    expect(screen.getByRole("region", { name: "PDFリーダー" }).className).toContain(
      "is-chrome-visible",
    );
  });

  it("opens with the binding the library kept", async () => {
    resolveDocument(makeDocument());
    window.localStorage.clear();
    render(<PdfReader book={{ ...makeBook(), bindingDirection: "rtl" }} onPageChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "表示" }));
    expect(screen.getByRole("button", { name: "右綴じ" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(backend.saveBindingDirection).not.toHaveBeenCalled();
  });
});
