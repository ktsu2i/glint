import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { previewWidth, usePdfPagePreview, type PreviewCache } from "./usePdfPagePreview";

type PdfPagePreviewProps = {
  document: PDFDocumentProxy | null;
  cache: PreviewCache;
  pageNumber: number;
  label: string;
};

export function PdfPagePreview({ document, cache, pageNumber, label }: PdfPagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const image = usePdfPagePreview(document, cache, pageNumber);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !image) {
      return;
    }
    canvas.width = image.width;
    canvas.height = image.height;
    context.drawImage(image, 0, 0);
  }, [image]);

  return (
    <>
      <div className="reader-slider-preview" style={{ width: previewWidth }}>
        {image ? (
          <canvas
            ref={canvasRef}
            style={{ width: previewWidth, height: (previewWidth * image.height) / image.width }}
          />
        ) : (
          <div className="reader-slider-preview-placeholder" />
        )}
      </div>
      <span className="reader-slider-hover-label">{label}</span>
    </>
  );
}
