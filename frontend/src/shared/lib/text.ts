export const MAX_CHAT_CONTEXT_CHARACTERS = 6000;

export function normalizePageText(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  return items
    .map((item) => `${item.str ?? ""}${item.hasEOL === true ? "\n" : " "}`)
    .join("")
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/[ \t]{2,}/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

export function trimChatContext(value: string): string {
  return Array.from(value.trim()).slice(0, MAX_CHAT_CONTEXT_CHARACTERS).join("");
}

export function contextPreview(value: string, maximum = 260): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  if (characters.length <= maximum) {
    return normalized;
  }
  return `${characters.slice(0, maximum).join("")}…`;
}
