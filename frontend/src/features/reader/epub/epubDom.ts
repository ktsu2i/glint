import { useEffect, useState } from "react";
import type { FloatingAnchor } from "../common/HighlightToolbars";
import type { EpubTheme } from "./epubContent";

function currentTheme(): EpubTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function useDocumentTheme(): EpubTheme {
  const [theme, setTheme] = useState<EpubTheme>(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

// Events from a section carry elements of another window, so instanceof checks fail on them.
export function isElementLike(target: EventTarget | null): target is Element {
  return target !== null && "tagName" in target && "closest" in target;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!isElementLike(target)) {
    return false;
  }
  return (
    ("isContentEditable" in target && target.isContentEditable === true) ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function rangeAnchor(range: Range, reader: HTMLElement | null): FloatingAnchor | null {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  if (!reader || !frame) {
    return null;
  }
  const box = range.getBoundingClientRect();
  const frameBox = frame.getBoundingClientRect();
  const readerBox = reader.getBoundingClientRect();
  return {
    x: frameBox.left + box.left + box.width / 2 - readerBox.left,
    top: frameBox.top + box.top - readerBox.top,
    bottom: frameBox.top + box.bottom - readerBox.top,
    width: readerBox.width,
  };
}
