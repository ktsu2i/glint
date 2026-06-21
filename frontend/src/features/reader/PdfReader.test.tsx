import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({
  createPdfLoadingTask: vi.fn(),
  createPdfTextLayer: vi.fn(),
  loadPdfOutline: vi.fn(),
}));

vi.mock("./loadPdf", () => ({
  createPdfLoadingTask: loader.createPdfLoadingTask,
  createPdfTextLayer: loader.createPdfTextLayer,
  loadPdfOutline: loader.loadPdfOutline,
}));
vi.mock("../../shared/components/ToolButton", () => ({
  ToolButton: ({
    label,
    className = "",
    disabled = false,
    onClick,
    children,
  }: {
    label: string;
    className?: string;
    disabled?: boolean;
    onClick?: () => void;
    children: React.ReactNode;
  }) => (
    <button aria-label={label} className={className} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));

import { PdfReader } from "./PdfReader";
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
    getPage: vi.fn(async () => page),
  };
}

function makeBook(url = "/book/1"): BookFile {
  return {
    id: "book-1",
    title: "Guide",
    name: "Guide.pdf",
    url,
    size: 10,
    initialPage: 1,
    coverStatus: "pending",
  };
}

function resolveDocument(document = makeDocument()) {
  const task = { promise: Promise.resolve(document), destroy: vi.fn(async () => undefined) };
  loader.createPdfLoadingTask.mockResolvedValue(task);
  return { task, document };
}

beforeEach(() => {
  vi.clearAllMocks();
  resize.callbacks = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });
  loader.createPdfTextLayer.mockImplementation(async () => ({
    render: vi.fn(async () => undefined),
    cancel: vi.fn(),
  }));
  loader.loadPdfOutline.mockResolvedValue([]);
});

describe("PdfReader", () => {
  it("renders the empty state and resets page context", () => {
    const onPageContextChange = vi.fn();
    const { unmount } = render(
      <PdfReader book={null} onPageContextChange={onPageContextChange} />,
    );

    expect(screen.getByText("本とコードのあいだを読む。")).toBeTruthy();
    expect(onPageContextChange).toHaveBeenCalledWith(0, "", 0);
    unmount();
  });

  it("loads, renders, navigates, extracts text, and adjusts zoom", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    const page = makePage();
    const { task, document } = resolveDocument(makeDocument(page));
    const onPageContextChange = vi.fn();
    const { unmount } = render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={onPageContextChange}
      />,
    );

    expect(screen.getByText("PDFを読み込んでいます…")).toBeTruthy();
    await waitFor(() => expect(loader.createPdfLoadingTask).toHaveBeenCalledWith(
      "/book/1",
      expect.any(AbortSignal),
    ));

    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(onPageContextChange).toHaveBeenCalledWith(1, "Alpha\nBeta", 2));
    expect(page.render).toHaveBeenCalledWith(expect.objectContaining({
      transform: [2, 0, 0, 2, 0, 0],
    }));
    expect(screen.getByText("200%")).toBeTruthy();

    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 1000, height: 300 } }]));
    await screen.findByText("300%");
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 20, height: 300 } }]));
    await screen.findByText("10%");

    fireEvent.click(screen.getByRole("button", { name: "拡大" }));
    await screen.findByText("40%");
    expect(screen.getByRole("button", { name: "全体を表示" }).className).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "縮小" }));
    await screen.findByText("40%");
    fireEvent.click(screen.getByRole("button", { name: "全体を表示" }));
    expect(screen.getByRole("button", { name: "全体を表示" }).className).toBe("is-active");

    fireEvent.click(screen.getByRole("button", { name: "次のページ" }));
    await waitFor(() => expect(document.getPage).toHaveBeenCalledWith(2));
    expect(screen.getByRole("button", { name: "次のページ" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "前のページ" }));
    await waitFor(() => expect(document.getPage).toHaveBeenLastCalledWith(1));

    unmount();
    expect(page.renderTask.cancel).toHaveBeenCalled();
    expect(task.destroy).toHaveBeenCalled();
  });

  it("jumps to a page typed in the toolbar input and clamps invalid values", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 12;
    resolveDocument(pdfDocument);
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    let input = screen.getByLabelText("ページ番号") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(7));
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("7 ");

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    input = screen.getByLabelText("ページ番号") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(12));
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("12 ");

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    input = screen.getByLabelText("ページ番号") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(pdfDocument.getPage).toHaveBeenLastCalledWith(12);
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("12 ");

    fireEvent.click(screen.getByRole("button", { name: "ページ番号を指定" }));
    input = screen.getByLabelText("ページ番号") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("12 ");
  });

  it("resets the reader scroll position after button, page input, and TOC navigation", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 12;
    resolveDocument(pdfDocument);
    loader.loadPdfOutline.mockResolvedValue([
      { title: "第2章", pageNumber: 9, children: [] },
    ]);
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
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
    const input = screen.getByLabelText("ページ番号") as HTMLInputElement;
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
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
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
    globalThis.document.body.appendChild(input);
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
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await screen.findByText("200%");

    const stage = globalThis.document.querySelector(".pdf-stage") as HTMLDivElement;
    const plainEvent = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    act(() => { stage.dispatchEvent(plainEvent); });
    expect(plainEvent.defaultPrevented).toBe(false);
    expect(screen.getByRole("button", { name: "全体を表示" }).className).toBe("is-active");

    const pinchEvent = new WheelEvent("wheel", {
      deltaY: -20,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => { stage.dispatchEvent(pinchEvent); });
    expect(pinchEvent.defaultPrevented).toBe(true);
    await screen.findByText("244%");
    expect(screen.getByRole("button", { name: "全体を表示" }).className).toBe("");

    const zoomOutEvent = new WheelEvent("wheel", {
      deltaY: 400,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => { stage.dispatchEvent(zoomOutEvent); });
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
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );

    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    await screen.findByText("75%");
    expect(page.getViewport).toHaveBeenLastCalledWith({ scale: 0.75 });
    const canvas = globalThis.document.querySelector(".pdf-canvas") as HTMLCanvasElement;
    expect(canvas.style.width).toBe("150px");
    expect(canvas.style.height).toBe("300px");
    expect(screen.getByRole("button", { name: "全体を表示" }).className).toBe("is-active");
  });

  it("restores and clamps the saved reading position", async () => {
    const pdfDocument = makeDocument();
    resolveDocument(pdfDocument);
    render(
      <PdfReader
        book={makeBook()}
        initialPage={9}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("2 / 2");
  });

  it.each([
    [new Error("broken PDF"), "broken PDF"],
    ["unknown", "PDFを開けませんでした。"],
  ])("reports document loading failures", async (reason, message) => {
    loader.createPdfLoadingTask.mockRejectedValue(reason);
    render(
      <PdfReader
        book={makeBook("/book/broken")}
        onPageContextChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", message);
  });

  it("reports a load timeout and destroys an initialized loading task", async () => {
    vi.useFakeTimers();
    const task = { promise: new Promise(() => {}), destroy: vi.fn(async () => undefined) };
    loader.createPdfLoadingTask.mockResolvedValue(task);
    render(
      <PdfReader
        book={makeBook("/book/slow")}
        onPageContextChange={vi.fn()}
      />,
    );
    await act(async () => Promise.resolve());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(screen.getByRole("alert").textContent).toContain("タイムアウト");
    expect(task.destroy).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not update state after an unfinished load is unmounted", async () => {
    let resolveTask!: (task: unknown) => void;
    loader.createPdfLoadingTask.mockReturnValue(new Promise((resolve) => {
      resolveTask = resolve;
    }));
    const { unmount } = render(
      <PdfReader
        book={makeBook("/book/pending")}
        onPageContextChange={vi.fn()}
      />,
    );
    unmount();

    resolveTask({ promise: Promise.resolve(makeDocument()), destroy: vi.fn() });
    await act(async () => Promise.resolve());
  });

  it("ignores a loading failure after unmount", async () => {
    let rejectTask!: (reason: unknown) => void;
    loader.createPdfLoadingTask.mockReturnValue(new Promise((_, reject) => {
      rejectTask = reject;
    }));
    const { unmount } = render(
      <PdfReader
        book={makeBook("/book/pending")}
        onPageContextChange={vi.fn()}
      />,
    );
    unmount();

    rejectTask(new Error("late failure"));
    await act(async () => Promise.resolve());
  });

  it("renders at unit device scale", async () => {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 0 });
    const page = makePage();
    resolveDocument(makeDocument(page));
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 200, height: 100 } }]));

    await waitFor(() => expect(page.render).toHaveBeenCalledWith(expect.objectContaining({
      transform: undefined,
    })));
  });

  it("falls back to unit scale when the viewport ratio is zero", async () => {
    const page = makePage({
      getViewport: vi.fn()
        .mockReturnValueOnce({ width: Number.POSITIVE_INFINITY, height: 100 })
        .mockReturnValueOnce({ width: 200, height: 100 }),
    });
    resolveDocument(makeDocument(page));
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 200, height: 100 } }]));

    await waitFor(() => expect(page.render).toHaveBeenCalledWith(expect.objectContaining({
      viewport: { width: 200, height: 100 },
    })));
  });

  it("reports canvas and non-Error rendering failures", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    resolveDocument();
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Canvasを初期化できませんでした。",
    );
  });

  it("uses the generic rendering error for non-Error rejections", async () => {
    resolveDocument({ numPages: 2, getPage: vi.fn(async () => Promise.reject("bad render")) });
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "ページを描画できませんでした。",
    );
  });

  it("ignores PDF.js render cancellation errors", async () => {
    const cancellation = new Error("cancelled");
    cancellation.name = "RenderingCancelledException";
    resolveDocument({ numPages: 1, getPage: vi.fn(async () => Promise.reject(cancellation)) });
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await act(async () => Promise.resolve());

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("stops rendering work after unmount", async () => {
    let resolvePage!: (page: ReturnType<typeof makePage>) => void;
    const document = {
      numPages: 1,
      getPage: vi.fn(() => new Promise<ReturnType<typeof makePage>>((resolve) => {
        resolvePage = resolve;
      })),
    };
    resolveDocument(document);
    const { unmount } = render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(document.getPage).toHaveBeenCalled());
    unmount();
    resolvePage(makePage());
    await act(async () => Promise.resolve());
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
    const onPageContextChange = vi.fn();
    render(
      <PdfReader book={makeBook()} onPageContextChange={onPageContextChange} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "見開き表示に切り替え" }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(2));

    const canvases = globalThis.document.querySelectorAll(".pdf-canvas");
    expect(canvases.length).toBe(2);
    expect(canvases[0].getAttribute("aria-label")).toBe("1ページ");
    expect(canvases[1].getAttribute("aria-label")).toBe("2ページ");
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("1–2");
    await waitFor(() => expect(onPageContextChange).toHaveBeenCalledWith(1, "First\n\nSecond", 4));
  });

  it("advances by two pages with the next button and arrow keys in spread mode", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 6;
    resolveDocument(pdfDocument);
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "見開き表示に切り替え" }));
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
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "見開き表示に切り替え" }));

    const canvases = globalThis.document.querySelectorAll(".pdf-canvas");
    expect(canvases.length).toBe(1);
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("1 / 1");
  });

  it("toggles back from spread to single page view", async () => {
    const pdfDocument = makeDocument();
    pdfDocument.numPages = 4;
    resolveDocument(pdfDocument);
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByRole("button", { name: "見開き表示に切り替え" }));
    await waitFor(
      () => expect(globalThis.document.querySelectorAll(".pdf-canvas").length).toBe(2),
    );

    fireEvent.click(screen.getByRole("button", { name: "1ページ表示に切り替え" }));
    await waitFor(
      () => expect(globalThis.document.querySelectorAll(".pdf-canvas").length).toBe(1),
    );
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
    const textLayerOne = { render: vi.fn(async () => undefined), cancel: vi.fn() };
    const textLayerTwo = { render: vi.fn(async () => undefined), cancel: vi.fn() };
    loader.createPdfTextLayer
      .mockResolvedValueOnce(textLayerOne)
      .mockResolvedValueOnce(textLayerTwo);
    const { unmount } = render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 800, height: 300 } }]));
    fireEvent.click(screen.getByRole("button", { name: "見開き表示に切り替え" }));

    await waitFor(() => expect(loader.createPdfTextLayer).toHaveBeenCalledTimes(2));
    const containers = globalThis.document.querySelectorAll(".text-layer[data-page]");
    expect(containers.length).toBe(2);
    expect(containers[0].getAttribute("data-page")).toBe("1");
    expect(containers[1].getAttribute("data-page")).toBe("2");
    expect((containers[0] as HTMLElement).style.getPropertyValue("--total-scale-factor")).not.toBe("");
    expect(textLayerOne.render).toHaveBeenCalled();
    expect(textLayerTwo.render).toHaveBeenCalled();

    unmount();
    expect(textLayerOne.cancel).toHaveBeenCalled();
    expect(textLayerTwo.cancel).toHaveBeenCalled();
  });

  it("emits selection details when the user selects text inside a page layer", async () => {
    resolveDocument();
    const onSelectionChange = vi.fn();
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(loader.createPdfTextLayer).toHaveBeenCalled());

    const layer = globalThis.document.querySelector(".text-layer[data-page]") as HTMLElement;
    const span = globalThis.document.createElement("span");
    span.textContent = "selected text";
    layer.appendChild(span);
    const textNode = span.firstChild as Text;

    vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: false,
      toString: () => "  selected text  ",
    } as unknown as Selection);
    act(() => {
      globalThis.document.dispatchEvent(new Event("selectionchange"));
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ text: "selected text", pageNumber: 1 });

    vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: textNode,
      focusNode: textNode,
      isCollapsed: true,
      toString: () => "",
    } as unknown as Selection);
    act(() => {
      globalThis.document.dispatchEvent(new Event("selectionchange"));
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
  });

  it("ignores selections that fall outside a text layer", async () => {
    resolveDocument();
    const onSelectionChange = vi.fn();
    render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={vi.fn()}
        onSelectionChange={onSelectionChange}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(loader.createPdfTextLayer).toHaveBeenCalled());

    const outside = globalThis.document.createElement("p");
    outside.textContent = "elsewhere";
    globalThis.document.body.appendChild(outside);
    const outsideText = outside.firstChild as Text;

    vi.spyOn(window, "getSelection").mockReturnValue({
      anchorNode: outsideText,
      focusNode: outsideText,
      isCollapsed: false,
      toString: () => "elsewhere",
    } as unknown as Selection);
    onSelectionChange.mockClear();
    act(() => {
      globalThis.document.dispatchEvent(new Event("selectionchange"));
    });
    expect(onSelectionChange).toHaveBeenLastCalledWith(null);
    outside.remove();
  });

  it("opens an empty TOC panel when the PDF has no outline", async () => {
    resolveDocument();
    loader.loadPdfOutline.mockResolvedValue([]);
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(loader.loadPdfOutline).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: "目次を閉じる" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    await screen.findByText("目次データが見つかりませんでした。");
    expect(screen.getByRole("button", { name: "目次を閉じる" })).toBeTruthy();
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
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
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
    render(
      <PdfReader book={makeBook()} onPageContextChange={vi.fn()} />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 400, height: 300 } }]));
    await waitFor(() => expect(loader.loadPdfOutline).toHaveBeenCalled());

    fireEvent.click(screen.getByRole("button", { name: "目次を開く" }));
    fireEvent.click(await screen.findByRole("button", { name: /巨大なセクション/ }));
    await waitFor(() => expect(pdfDocument.getPage).toHaveBeenLastCalledWith(4));
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
    const onPageContextChange = vi.fn();
    const { unmount } = render(
      <PdfReader
        book={makeBook()}
        onPageContextChange={onPageContextChange}
      />,
    );
    act(() => resize.callbacks.at(-1)?.([{ contentRect: { width: 200, height: 100 } }]));
    await waitFor(() => expect(page.render).toHaveBeenCalled());
    onPageContextChange.mockClear();
    unmount();
    resolveRender();
    await act(async () => Promise.resolve());

    expect(onPageContextChange).not.toHaveBeenCalled();
  });
});
