export function normalizePageText(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  return items
    .map((item) => `${item.str ?? ""}${item.hasEOL === true ? "\n" : " "}`)
    .join("")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/[ \t]{2,}/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}
