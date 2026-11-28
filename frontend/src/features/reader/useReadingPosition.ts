import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BookFile } from "../../shared/api/books";
import { saveReadingPosition } from "./api";

export function useReadingPosition(book: BookFile | null) {
  const { t } = useTranslation();
  const lastSaved = useRef("");

  const save = useCallback(
    (pageNumber: number, pageCount: number, cfi = "") => {
      if (!book || pageNumber < 1 || pageCount < 1) {
        return;
      }
      const positionKey = `${book.id}:${pageNumber}:${pageCount}:${cfi}`;
      if (lastSaved.current === positionKey) {
        return;
      }
      lastSaved.current = positionKey;
      void saveReadingPosition(book.id, pageNumber, pageCount, cfi).catch((reason) => {
        console.warn(reason instanceof Error ? reason.message : t("error.savePosition"));
      });
    },
    [book, t],
  );

  const reset = useCallback(() => {
    lastSaved.current = "";
  }, []);

  return { save, reset };
}
