import { useCallback, useEffect, useRef, useState } from "react";

export const minScale = 0.4;
export const maxScale = 3;

export type ZoomMode = { kind: "fit-page" } | { kind: "manual"; value: number };

type StageOptions = {
  /** Scrolls back to the start whenever it changes to a value other than null. */
  scrollResetKey: number | null;
  onClick: (event: MouseEvent) => void;
  onMouseUp: () => void;
  onScroll: () => void;
};

/**
 * The scrolling area that holds the pages: its size, and the zoom. Pinching
 * zooms in and out. The handlers are read when the events arrive, so they
 * can change on every render.
 */
export function usePdfStage({ scrollResetKey, ...handlers }: StageOptions) {
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [zoomMode, setZoomMode] = useState<ZoomMode>({ kind: "fit-page" });
  const [effectiveScale, setEffectiveScale] = useState(1);
  const stageNodeRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const effectiveScaleRef = useRef(1);
  const handlersRef = useRef(handlers);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    effectiveScaleRef.current = effectiveScale;
  }, [effectiveScale]);

  const stageRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    cleanupRef.current?.();
    cleanupRef.current = null;
    stageNodeRef.current = node;
    if (!node) {
      setStageSize({ width: 0, height: 0 });
      return;
    }
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setStageSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      }
    });
    observer.observe(node);
    observerRef.current = observer;

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }
      event.preventDefault();
      setZoomMode((current) => {
        const base = current.kind === "manual" ? current.value : effectiveScaleRef.current;
        const factor = Math.exp(-event.deltaY * 0.01);
        const next = Math.min(maxScale, Math.max(minScale, base * factor));
        return { kind: "manual", value: next };
      });
    };
    // Clicking the page toggles the floating controls; Escape does the same from the keyboard.
    const handleClick = (event: MouseEvent) => handlersRef.current.onClick(event);
    // Releasing a text selection offers the highlight colors.
    const handleMouseUp = () => handlersRef.current.onMouseUp();
    // Floating controls are placed for one scroll position, so scrolling dismisses them.
    const handleScroll = () => handlersRef.current.onScroll();
    node.addEventListener("wheel", handleWheel, { passive: false });
    node.addEventListener("click", handleClick);
    node.addEventListener("mouseup", handleMouseUp);
    node.addEventListener("scroll", handleScroll);
    cleanupRef.current = () => {
      node.removeEventListener("wheel", handleWheel);
      node.removeEventListener("click", handleClick);
      node.removeEventListener("mouseup", handleMouseUp);
      node.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
      cleanupRef.current?.();
    },
    [],
  );

  useEffect(() => {
    const node = stageNodeRef.current;
    if (scrollResetKey === null || !node) {
      return;
    }
    node.scrollTop = 0;
    node.scrollLeft = 0;
  }, [scrollResetKey]);

  const adjustZoom = useCallback(
    (delta: number) => {
      setZoomMode((current) => {
        const base = current.kind === "manual" ? current.value : effectiveScale;
        const next = Math.min(maxScale, Math.max(minScale, base + delta));
        return { kind: "manual", value: next };
      });
    },
    [effectiveScale],
  );

  return {
    stageRef,
    stageNodeRef,
    stageSize,
    zoomMode,
    setZoomMode,
    effectiveScale,
    setEffectiveScale,
    adjustZoom,
  };
}
