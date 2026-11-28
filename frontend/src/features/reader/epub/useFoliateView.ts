import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { FoliateShowAnnotationDetail, View } from "foliate-js/view.js";
import type { BookHighlight, ReaderSettings } from "../api";
import { epubHighlightFills, flattenToc, guardEpubContent, type EpubTocLine } from "./epubContent";
import { createFoliateView } from "./foliate";
import type { ReaderLocation } from "./useEpubAnnotations";
import { loadReaderSettings } from "./useEpubSettings";

export type FoliateHandlers = {
  handleKeyDown: (event: KeyboardEvent) => void;
  handleWheel: (event: WheelEvent) => void;
  handleClick: (event: MouseEvent) => void;
  handleSelection: (doc: Document, index: number) => void;
  handleAnnotation: (detail: FoliateShowAnnotationDetail) => void;
  clearSelection: () => void;
};

type FoliateViewOptions = {
  stageRef: RefObject<HTMLDivElement | null>;
  url: string;
  initialCfi: string;
  initialSection: number;
  handlersRef: RefObject<FoliateHandlers | null>;
  highlightsRef: RefObject<BookHighlight[]>;
  onSettingsLoaded: (settings: ReaderSettings) => void;
  onRelocate: (location: ReaderLocation, pageRange: Range | null) => void;
};

export function useFoliateView({
  stageRef,
  url,
  initialCfi,
  initialSection,
  handlersRef,
  highlightsRef,
  onSettingsLoaded,
  onRelocate,
}: FoliateViewOptions) {
  const { t } = useTranslation();
  const [view, setView] = useState<View | null>(null);
  const [toc, setToc] = useState<EpubTocLine[]>([]);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [error, setError] = useState("");
  const latest = useRef({ t, onSettingsLoaded, onRelocate });
  useEffect(() => {
    latest.current = { t, onSettingsLoaded, onRelocate };
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    let active = true;
    let opened: View | null = null;
    let fraction = 0;

    const open = async () => {
      const [{ view: foliate, drawHighlight }, settings] = await Promise.all([
        createFoliateView(),
        loadReaderSettings(),
      ]);
      if (!active) {
        return;
      }
      latest.current.onSettingsLoaded(settings);
      opened = foliate;
      foliate.className = "epub-view";
      foliate.style.setProperty("--overlayer-highlight-opacity", "0.32");
      foliate.addEventListener("relocate", ({ detail }) => {
        // The first report of a section can come before its pages are counted.
        fraction = Number.isFinite(detail.fraction) ? detail.fraction : fraction;
        const next: ReaderLocation = {
          cfi: detail.cfi,
          fraction,
          section: (detail.section?.current ?? 0) + 1,
          sectionCount: detail.section?.total ?? 0,
          tocHref: detail.tocItem?.href ?? "",
          tocLabel: (detail.tocItem?.label ?? "").trim(),
        };
        setLocation(next);
        latest.current.onRelocate(next, detail.range ?? null);
      });
      foliate.addEventListener("load", ({ detail: { doc, index } }) => {
        doc.addEventListener("keydown", (event) => handlersRef.current?.handleKeyDown(event));
        doc.addEventListener("wheel", (event) => handlersRef.current?.handleWheel(event), {
          passive: true,
        });
        doc.addEventListener("click", (event) => handlersRef.current?.handleClick(event));
        doc.addEventListener("mouseup", () => handlersRef.current?.handleSelection(doc, index));
        doc.addEventListener("selectionchange", () => {
          const selection = doc.getSelection();
          if (!selection || selection.isCollapsed) {
            handlersRef.current?.clearSelection();
          }
        });
      });
      foliate.addEventListener("create-overlay", ({ detail: { index } }) => {
        for (const highlight of highlightsRef.current) {
          if (highlight.pageNumber === index + 1 && highlight.cfi) {
            void foliate.addAnnotation({ value: highlight.cfi });
          }
        }
      });
      foliate.addEventListener("draw-annotation", ({ detail: { draw, annotation } }) => {
        const highlight = highlightsRef.current.find((entry) => entry.cfi === annotation.value);
        draw(drawHighlight, { color: epubHighlightFills[highlight?.color ?? "yellow"] });
      });
      foliate.addEventListener("show-annotation", ({ detail }) =>
        handlersRef.current?.handleAnnotation(detail),
      );
      foliate.addEventListener("external-link", (event) => event.preventDefault());
      stage.append(foliate);

      await foliate.open(url);
      if (!active) {
        return;
      }
      if (foliate.book?.transformTarget) {
        guardEpubContent(foliate.book.transformTarget);
      }
      const renderer = foliate.renderer;
      if (renderer) {
        renderer.setAttribute("flow", "paginated");
        renderer.setAttribute("margin", "56px");
        renderer.setAttribute("gap", "6%");
        renderer.setAttribute("max-inline-size", "720px");
        renderer.setAttribute("max-column-count", settings.epubLayout === "spread" ? "2" : "1");
      }
      setToc(flattenToc(foliate.book?.toc));
      setView(foliate);

      if (initialCfi) {
        await foliate.init({ lastLocation: initialCfi });
      } else if (initialSection > 1) {
        await foliate.goTo(initialSection - 1);
      } else {
        await foliate.init({ showTextStart: true });
      }
    };

    open().catch((reason: unknown) => {
      if (active) {
        console.warn("Opening the EPUB failed", reason);
        setError(latest.current.t("error.openEpub"));
      }
    });

    return () => {
      active = false;
      opened?.close();
      opened?.remove();
    };
  }, [handlersRef, highlightsRef, initialCfi, initialSection, stageRef, url]);

  return { view, toc, location, error };
}
