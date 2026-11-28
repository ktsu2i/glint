import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { BookFile } from "../../../shared/api/books";
import { LocalizedError, translateLocalizedError } from "../../../shared/i18n/error";
import { createPdfLoadingTask } from "../../../shared/pdf/loadPdf";

const loadTimeoutMilliseconds = 60_000;

type PdfDocumentCallbacks = {
  onBookChange: (opened: boolean) => void;
  onLoaded: (document: PDFDocumentProxy, startPage: number) => void;
};

export function usePdfDocument(
  book: BookFile | null,
  initialPage: number,
  callbacks: PdfDocumentCallbacks,
) {
  const { t } = useTranslation();
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState("");
  const bookUrl = book?.url;
  const loadKey = `${bookUrl ?? ""}#${initialPage}`;
  const [shownKey, setShownKey] = useState(loadKey);
  if (shownKey !== loadKey) {
    setShownKey(loadKey);
    setDocument(null);
    setError("");
  }
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  });

  useEffect(() => {
    callbacksRef.current.onBookChange(bookUrl !== undefined);
    if (bookUrl === undefined) {
      return;
    }

    let active = true;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    let timedOut = false;
    const abortController = new AbortController();

    let timeout = 0;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = window.setTimeout(() => {
        timedOut = true;
        abortController.abort();
        void loadingTask?.destroy();
        reject(new Error("PDF load timed out"));
      }, loadTimeoutMilliseconds);
    });

    async function loadDocument(url: string) {
      try {
        const loadedDocument = await Promise.race([
          (async () => {
            loadingTask = await createPdfLoadingTask(url, abortController.signal);
            return loadingTask.promise;
          })(),
          timeoutPromise,
        ]);
        if (active) {
          setDocument(loadedDocument);
          callbacksRef.current.onLoaded(
            loadedDocument,
            Math.min(loadedDocument.numPages, Math.max(1, initialPage)),
          );
        }
      } catch (reason: unknown) {
        if (active) {
          setError(
            timedOut
              ? t("error.pdfTimeout")
              : reason instanceof LocalizedError
                ? translateLocalizedError(reason, (key, values) => t(key, values ?? {}))
                : reason instanceof Error
                  ? reason.message
                  : t("error.openPdf"),
          );
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadDocument(bookUrl);

    return () => {
      active = false;
      window.clearTimeout(timeout);
      abortController.abort();
      void loadingTask?.destroy();
    };
  }, [bookUrl, initialPage, t]);

  return { document, error, setError };
}
