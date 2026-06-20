import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ createPdfLoadingTask: vi.fn() }));

vi.mock("./loadPdf", () => ({ createPdfLoadingTask: loader.createPdfLoadingTask }));
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
    expect(globalThis.document.querySelector(".page-count")?.textContent).toContain("/ 2");
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
