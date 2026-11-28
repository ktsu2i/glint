import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { View } from "foliate-js/view.js";
import type { ReaderPanel } from "../common/ReaderTopBar";

type Place = { cfi: string; pageNumber: number };

/**
 * Names each highlight and bookmark after the table of contents entry it
 * falls under, looked up while their list is open. Until then, or without
 * an entry, a place is named by its section.
 */
export function usePlaceLabels(
  view: View | null,
  openPanel: ReaderPanel | null,
  highlights: Place[],
  bookmarks: Place[],
) {
  const { t } = useTranslation();
  const [labels, setLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    if ((openPanel !== "highlights" && openPanel !== "bookmarks") || !view) {
      return;
    }
    let active = true;
    const places = openPanel === "highlights" ? highlights : bookmarks;
    const missing = [...new Set(places.map((place) => place.cfi))].filter(
      (cfi) => !(cfi in labels),
    );
    const label = async () => {
      const found: Record<string, string> = {};
      for (const cfi of missing) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- 1件ずつ section を読み込むので順番に行う。
        const item = await view.getTOCItemOf(cfi).catch(() => null);
        found[cfi] = (item?.label ?? "").trim();
      }
      if (active && missing.length > 0) {
        setLabels((current) => ({ ...current, ...found }));
      }
    };
    void label();
    return () => {
      active = false;
    };
  }, [openPanel, view, highlights, bookmarks, labels]);

  return (place: Place) =>
    labels[place.cfi] || t("reader.sectionNumber", { number: place.pageNumber });
}
