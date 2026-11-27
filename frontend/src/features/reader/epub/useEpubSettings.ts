import { useCallback, useEffect, useState } from "react";
import type { View } from "foliate-js/view.js";
import {
  getReaderSettings,
  saveReaderSettings,
  type EpubLayout,
  type ReaderSettings,
} from "../api";
import {
  EPUB_MAX_FONT_SCALE,
  EPUB_MIN_FONT_SCALE,
  defaultReaderSettings,
  epubStyles,
} from "./epubContent";
import { useDocumentTheme } from "./epubDom";

/** The text size and layout every EPUB shares. */
export async function loadReaderSettings(): Promise<ReaderSettings> {
  try {
    return await getReaderSettings();
  } catch (reason) {
    console.warn("Loading the reader settings failed", reason);
    return defaultReaderSettings;
  }
}

function persistReaderSettings(settings: ReaderSettings) {
  saveReaderSettings(settings).catch((reason: unknown) => {
    console.warn("Saving the reader settings failed", reason);
  });
}

/**
 * The text size and layout of the view, styled for the app theme. Changes
 * are saved for every EPUB.
 */
export function useEpubSettings(view: View | null) {
  const theme = useDocumentTheme();
  const [fontScale, setFontScale] = useState(defaultReaderSettings.epubFontScale);
  const [layout, setLayout] = useState<EpubLayout>(defaultReaderSettings.epubLayout);

  useEffect(() => {
    view?.renderer?.setStyles(epubStyles(fontScale, theme));
  }, [view, fontScale, theme]);

  // A spread shows two pages when the window is wide enough; a single page never does.
  useEffect(() => {
    view?.renderer?.setAttribute("max-column-count", layout === "spread" ? "2" : "1");
  }, [view, layout]);

  /** Takes the settings loaded when the book opened. */
  const apply = useCallback((settings: ReaderSettings) => {
    setFontScale(settings.epubFontScale);
    setLayout(settings.epubLayout);
  }, []);

  function changeLayout(next: EpubLayout) {
    setLayout(next);
    persistReaderSettings({ epubFontScale: fontScale, epubLayout: next });
  }

  function changeFontScale(next: number) {
    const clamped = Math.min(EPUB_MAX_FONT_SCALE, Math.max(EPUB_MIN_FONT_SCALE, next));
    setFontScale(clamped);
    persistReaderSettings({ epubFontScale: clamped, epubLayout: layout });
  }

  return { fontScale, layout, apply, changeLayout, changeFontScale };
}
