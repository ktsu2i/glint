import type { View } from "foliate-js/view.js";

// Finds the section that holds a fraction of the whole book, the same way foliate-js does when
// going to that fraction: sections start at `fractions[i]` and empty ones are skipped.
export function sectionIndexAt(fractions: number[], fraction: number): number | null {
  const count = fractions.length - 1;
  if (count <= 0) {
    return null;
  }
  if (fraction >= 1) {
    return count - 1;
  }
  let index = Math.max(0, fractions.findIndex((start) => start > fraction) - 1);
  while (index < count - 1 && (fractions[index + 1] ?? 0) <= (fractions[index] ?? 0)) {
    index += 1;
  }
  return index;
}

// The table of contents label for a fraction of the book, without loading the section.
export function tocLabelAt(view: View | null, fraction: number): string {
  if (!view) {
    return "";
  }
  const index = sectionIndexAt(view.getSectionFractions(), fraction);
  if (index === null) {
    return "";
  }
  return view.getProgressOf(index).tocItem?.label?.trim() ?? "";
}
