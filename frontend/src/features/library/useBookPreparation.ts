import { useCallback, useEffect, useRef } from "react";
import type { BookFile } from "../../shared/api/books";
import { markBookCoverFailed, pendingIndexBooks, saveBookCover } from "./api";
import { generateCoverThumbnail } from "./generateCover";
import { indexBookPages, isAbortError, type IndexableBook } from "./indexer";

export function useCoverGeneration(onSettled: () => Promise<void>) {
  const generating = useRef(new Set<string>());

  return useCallback(
    async (book: BookFile) => {
      if (book.coverStatus !== "pending" || generating.current.has(book.id)) {
        return;
      }
      generating.current.add(book.id);
      try {
        const cover = await generateCoverThumbnail(book.url);
        await saveBookCover(book.id, cover);
      } catch {
        try {
          await markBookCoverFailed(book.id);
        } catch {}
      } finally {
        generating.current.delete(book.id);
        await onSettled();
      }
    },
    [onSettled],
  );
}

type IndexedResult = Awaited<ReturnType<typeof indexBookPages>>;

export function useBookIndexing(onIndexed: (bookId: string, result: IndexedResult) => void) {
  const aborters = useRef<Map<string, AbortController>>(new Map());

  const ensureIndexed = useCallback(
    async (target: IndexableBook) => {
      if (!target.url || !target.id) {
        return;
      }
      if (target.format === "epub") {
        return;
      }
      if (aborters.current.has(target.id)) {
        return;
      }
      const controller = new AbortController();
      aborters.current.set(target.id, controller);
      try {
        const result = await indexBookPages(
          { id: target.id, url: target.url, nextSegment: target.nextSegment },
          { signal: controller.signal },
        );
        onIndexed(target.id, result);
      } catch (reason: unknown) {
        if (isAbortError(reason)) {
          return;
        }
        console.warn("Book indexing failed", reason);
      } finally {
        aborters.current.delete(target.id);
      }
    },
    [onIndexed],
  );

  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current) {
      return;
    }
    resumed.current = true;
    const resume = async () => {
      let targets;
      try {
        targets = await pendingIndexBooks();
      } catch (reason: unknown) {
        console.warn("Listing books to index failed", reason);
        return;
      }
      for (const target of targets) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 裏で1冊ずつ順番に index する。
        await ensureIndexed(target);
      }
    };
    void resume();
  }, [ensureIndexed]);

  useEffect(() => {
    const running = aborters.current;
    return () => {
      running.forEach((controller) => controller.abort());
      running.clear();
    };
  }, []);

  return ensureIndexed;
}
