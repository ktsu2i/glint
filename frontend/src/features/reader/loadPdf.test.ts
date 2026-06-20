import { afterEach, describe, expect, it, vi } from "vitest";
import { createPdfLoadingTask } from "./loadPdf";

function createOnePagePdf(): Uint8Array {
  const encoder = new TextEncoder();
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let content = "%PDF-1.4\n";
  const offsets = objects.map((object) => {
    const offset = encoder.encode(content).byteLength;
    content += object;
    return offset;
  });
  const xrefOffset = encoder.encode(content).byteLength;
  content += "xref\n0 5\n0000000000 65535 f \n";
  content += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  content += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(content);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createPdfLoadingTask", () => {
  it("fetches and parses a valid PDF", async () => {
    vi.stubGlobal("DOMMatrix", class DOMMatrix {});
    vi.stubGlobal("ImageData", class ImageData {});
    vi.stubGlobal("Path2D", class Path2D {});
    const pdf = createOnePagePdf();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(pdf.buffer as ArrayBuffer)));

    const task = await createPdfLoadingTask("/book/token", new AbortController().signal);
    const document = await task.promise;

    expect(document.numPages).toBe(1);
    await task.destroy();
  });

  it("rejects a frontend HTML fallback before PDF.js parsing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>fallback</html>")));

    await expect(
      createPdfLoadingTask("/book/token", new AbortController().signal),
    ).rejects.toThrow("取得したデータがPDFではありません");
  });

  it("reports an unsuccessful HTTP response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 503 })));

    await expect(
      createPdfLoadingTask("/book/missing", new AbortController().signal),
    ).rejects.toThrow("HTTP 503");
  });

  it("resolves asset URLs without a document global", async () => {
    vi.stubGlobal("document", undefined);
    const pdf = createOnePagePdf();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(pdf.buffer as ArrayBuffer)));

    const task = await createPdfLoadingTask("/book/token", new AbortController().signal);
    await task.destroy();
  });
});
