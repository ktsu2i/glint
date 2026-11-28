import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { createUtterance, type useReadAloud } from "../common/speech";
import type { ReadableText } from "./usePdfPageRender";

export function usePdfReadAloud({
  readAloud: { supported, voices, active, setActive },
  document,
  pageNumber,
  readableText,
  setPageNumber,
}: {
  readAloud: ReturnType<typeof useReadAloud>;
  document: PDFDocumentProxy | null;
  pageNumber: number;
  readableText: ReadableText;
  setPageNumber: Dispatch<SetStateAction<number>>;
}) {
  const { i18n } = useTranslation();
  const activeRef = useRef(false);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!supported || !active || !document) {
      return;
    }
    if (readableText.pageNumber !== pageNumber || readableText.text.trim() === "") {
      return;
    }
    const utterance = createUtterance(readableText.text, i18n.language, voices);
    const numPages = document.numPages;
    utterance.addEventListener("end", () => {
      if (!activeRef.current) {
        return;
      }
      if (pageNumber >= numPages) {
        setActive(false);
        return;
      }
      setPageNumber((current) => Math.min(numPages, current + 1));
    });
    utterance.addEventListener("error", () => {
      setActive(false);
    });
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    return () => {
      window.speechSynthesis.cancel();
    };
  }, [
    active,
    document,
    i18n.language,
    pageNumber,
    readableText,
    setActive,
    setPageNumber,
    supported,
    voices,
  ]);
}
