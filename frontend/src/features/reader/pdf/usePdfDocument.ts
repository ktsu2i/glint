import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { BookFile } from "../../../shared/api/books";
import { LocalizedError, translateLocalizedError } from "../../../shared/i18n/error";
import { createPdfLoadingTask } from "../../../shared/pdf/loadPdf";

const loadTimeoutMilliseconds = 60_000;

type PdfDocumentCallbacks = {
  /** Runs when another book is given, before it starts loading. */
  onBookChange: (book: BookFile | null) => void;
  onLoaded: (document: PDFDocumentProxy) => void;
};

/**
 * Loads the PDF of the book, and gives up after a minute. A new book, or a
 * new page to open it at, loads it again.
 */
export function usePdfDocument(
  book: BookFile | null,
  initialPage: number,
  callbacks: PdfDocumentCallbacks,
) {
  const { t } = useTranslation();
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    callbacksRef.current.onBookChange(book);
    setDocument(null);
    setError("");
    if (!book) {
      return;
    }

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let timedOut = false;
    const abortController = new AbortController();
    const bookUrl = book.url;

    let timeout = 0;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => {
        timedOut = true;
        abortController.abort();
        void loadingTask?.destroy();
        reject(new Error("PDF load timed out"));
      }, loadTimeoutMilliseconds);
    });

    async function loadDocument() {
      try {
        const loadedDocument = await Promise.race([
          (async () => {
            loadingTask = await createPdfLoadingTask(bookUrl, abortController.signal);
            return loadingTask.promise;
          })(),
          timeoutPromise,
        ]);
        if (active) {
          setDocument(loadedDocument);
          callbacksRef.current.onLoaded(loadedDocument);
        }
      } catch (reason: unknown) {
        if (active) {
          setError(
            timedOut
              ? t("error.pdfTimeout")
              : reason instanceof LocalizedError
                ? translateLocalizedError(reason, t)
                : reason instanceof Error
                  ? reason.message
                  : t("error.openPdf"),
          );
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadDocument();

    return () => {
      active = false;
      window.clearTimeout(timeout);
      abortController.abort();
      void loadingTask?.destroy();
    };
    // oxlint-disable-next-line react/exhaustive-deps -- book の id / url が変わった時だけ再読み込みする。
  }, [book?.id, book?.url, initialPage, t]);

  return { document, error, setError };
}
