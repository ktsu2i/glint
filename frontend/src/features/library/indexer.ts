import { createPdfLoadingTask, extractPdfPage } from "../reader/loadPdf";
import { saveBookPages, type BookPageInput } from "../../shared/api/backend";

const pageIndexBatchSize = 16;

export type IndexableBook = {
  id: string;
  url: string;
  indexedPageCount: number;
  format?: "pdf" | "epub";
};

export type IndexProgressCallback = (current: number, total: number) => void;

export type IndexBookOptions = {
  signal: AbortSignal;
  onProgress?: IndexProgressCallback;
};

export async function indexBookPages(
  book: IndexableBook,
  { signal, onProgress }: IndexBookOptions,
): Promise<{ pageCount: number; persistedCount: number }> {
  if (signal.aborted) {
    throw new AbortError();
  }
  const loadingTask = await createPdfLoadingTask(book.url, signal);
  let document;
  try {
    document = await loadingTask.promise;
  } catch (reason) {
    if (signal.aborted) {
      throw new AbortError();
    }
    throw reason;
  }
  try {
    const pageCount = document.numPages;
    const startingCount = Math.min(pageCount, Math.max(0, book.indexedPageCount));
    onProgress?.(startingCount, pageCount);
    const firstMissingPage = startingCount + 1;
    if (firstMissingPage > pageCount) {
      return { pageCount, persistedCount: startingCount };
    }

    let persistedCount = startingCount;
    let batch: BookPageInput[] = [];
    for (let number = firstMissingPage; number <= pageCount; number += 1) {
      if (signal.aborted) {
        throw new AbortError();
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- page 順に逐次抽出し、batch 単位で保存する。
      const page = await extractPdfPage(document, number);
      batch.push(page);
      if (batch.length === pageIndexBatchSize || number === pageCount) {
        if (signal.aborted) {
          throw new AbortError();
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- batch は順番に保存する必要がある。
        persistedCount = await saveBookPages(book.id, batch, pageCount);
        onProgress?.(persistedCount, pageCount);
        batch = [];
      }
    }
    return { pageCount, persistedCount };
  } finally {
    try {
      await loadingTask.destroy();
    } catch {}
  }
}

export class AbortError extends Error {
  constructor() {
    super("Book indexing aborted");
    this.name = "AbortError";
  }
}

export function isAbortError(reason: unknown): boolean {
  return reason instanceof AbortError || (reason instanceof Error && reason.name === "AbortError");
}
