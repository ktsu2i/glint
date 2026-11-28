import { createPdfLoadingTask, extractPdfPage, loadPdfOutline } from "../../shared/pdf/loadPdf";
import type { OutlineNode } from "../../shared/pdf/loadPdf";
import { saveBookSegments, type BookSegmentInput } from "./api";

const pageIndexBatchSize = 16;

export type IndexableBook = {
  id: string;
  url: string;
  nextSegment: number;
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
    const firstMissingPage = Math.max(1, book.nextSegment);
    const startingCount = Math.min(pageCount, firstMissingPage - 1);
    onProgress?.(startingCount, pageCount);
    if (firstMissingPage > pageCount) {
      return { pageCount, persistedCount: pageCount };
    }

    const outline = await loadPdfOutline(document).catch((): OutlineNode[] => []);
    let persistedCount = startingCount;
    let batch: BookSegmentInput[] = [];
    for (let number = firstMissingPage; number <= pageCount; number += 1) {
      if (signal.aborted) {
        throw new AbortError();
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- page 順に逐次抽出し、batch 単位で保存する。
      const page = await extractPdfPage(document, number);
      batch.push({
        ordinal: number,
        location: `page:${number}`,
        headingPath: headingPathForPage(outline, number),
        text: page.text,
      });
      if (batch.length === pageIndexBatchSize || number === pageCount) {
        if (signal.aborted) {
          throw new AbortError();
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- batch は順番に保存する必要がある。
        persistedCount = await saveBookSegments(book.id, batch, pageCount);
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

export function headingPathForPage(outline: OutlineNode[], pageNumber: number): string {
  const titles: string[] = [];
  let level = outline;
  while (level.length > 0) {
    let match: OutlineNode | undefined;
    for (const node of level) {
      if (node.pageNumber === null || node.pageNumber > pageNumber) {
        continue;
      }
      if (!match || match.pageNumber === null || node.pageNumber >= match.pageNumber) {
        match = node;
      }
    }
    if (!match) {
      break;
    }
    const title = match.title.trim();
    if (title) {
      titles.push(title);
    }
    level = match.children;
  }
  return titles.join(" > ");
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
