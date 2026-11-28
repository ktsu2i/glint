import { beforeEach, describe, expect, it, vi } from "vitest";

const loader = vi.hoisted(() => ({ createPdfLoadingTask: vi.fn() }));
vi.mock("../../shared/pdf/loadPdf", () => ({ createPdfLoadingTask: loader.createPdfLoadingTask }));

import { generateCoverThumbnail } from "./generateCover";

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
});

describe("generateCoverThumbnail", () => {
  it("renders the first page at a bounded width and returns PNG data", async () => {
    const renderTask = { promise: Promise.resolve(), cancel: vi.fn() };
    const page = {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        width: 640 * scale,
        height: 900 * scale,
      })),
      render: vi.fn(() => renderTask),
    };
    const destroy = vi.fn(async () => {});
    loader.createPdfLoadingTask.mockResolvedValue({
      promise: Promise.resolve({ getPage: vi.fn(async () => page) }),
      destroy,
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,cover",
    );

    await expect(generateCoverThumbnail("/book/1")).resolves.toBe("data:image/png;base64,cover");
    expect(page.getViewport).toHaveBeenNthCalledWith(1, { scale: 1 });
    expect(page.getViewport).toHaveBeenNthCalledWith(2, { scale: 1 });
    expect(page.render).toHaveBeenCalled();
    expect(renderTask.cancel).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });

  it("destroys the loading task when the page cannot be rendered", async () => {
    const destroy = vi.fn(async () => {});
    loader.createPdfLoadingTask.mockResolvedValue({
      promise: Promise.resolve({
        getPage: vi.fn(async () => ({
          getViewport: vi.fn(() => ({ width: 0, height: 0 })),
        })),
      }),
      destroy,
    });

    await expect(generateCoverThumbnail("/book/broken")).rejects.toThrow("表紙サイズ");
    expect(destroy).toHaveBeenCalled();
  });
});
