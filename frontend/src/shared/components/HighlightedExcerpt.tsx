import { Fragment, type ReactNode } from "react";

export function HighlightedExcerpt({ text, query }: { text: string; query: string }): ReactNode {
  const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (terms.length === 0) {
    return text;
  }
  const expression = new RegExp(
    `(${terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "giu",
  );
  const foldedTerms = new Set(terms.map((term) => term.toLocaleLowerCase()));
  return (
    <>
      {text.split(expression).map((part, index) =>
        foldedTerms.has(part.toLocaleLowerCase())
          ? <mark key={`${index}-${part}`}>{part}</mark>
          : <Fragment key={`${index}-${part}`}>{part}</Fragment>,
      )}
    </>
  );
}
