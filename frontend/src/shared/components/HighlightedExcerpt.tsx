import { Fragment, type ReactNode } from "react";

export function HighlightedExcerpt({ text, query }: { text: string; query: string }): ReactNode {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].toSorted(
    (left, right) => right.length - left.length,
  );
  if (terms.length === 0) {
    return text;
  }
  const expression = new RegExp(
    `(${terms.map((term) => term.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "giu",
  );
  const foldedTerms = new Set(terms.map((term) => term.toLocaleLowerCase()));
  const segments: Array<{ part: string; start: number }> = [];
  let offset = 0;
  for (const part of text.split(expression)) {
    if (part !== "") {
      segments.push({ part, start: offset });
    }
    offset += part.length;
  }
  return (
    <>
      {segments.map(({ part, start }) =>
        foldedTerms.has(part.toLocaleLowerCase()) ? (
          <mark key={start}>{part}</mark>
        ) : (
          <Fragment key={start}>{part}</Fragment>
        ),
      )}
    </>
  );
}
