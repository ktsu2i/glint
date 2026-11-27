import { useRef, useState } from "react";

/**
 * The page number field of the bottom bar. It follows the page until it is
 * edited, and a number typed into it is kept within the document.
 */
export function usePageInput(
  pageNumber: number,
  numPages: number,
  setPageNumber: (pageNumber: number) => void,
) {
  const [value, setValue] = useState("1");
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function commit() {
    if (numPages < 1) {
      setValue(String(pageNumber));
      return;
    }
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < 1) {
      setValue(String(pageNumber));
      return;
    }
    const next = Math.min(numPages, parsed);
    setPageNumber(next);
    setValue(String(next));
  }

  function start() {
    if (numPages < 1) {
      return;
    }
    setValue(String(pageNumber));
    setEditing(true);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }

  /** Applies the typed page and closes the field. */
  function finish() {
    commit();
    setEditing(false);
  }

  /** Closes the field without moving. */
  function cancel() {
    setValue(String(pageNumber));
    setEditing(false);
  }

  // Until it is edited, the field shows the page.
  return {
    value: editing ? value : String(pageNumber),
    setValue,
    editing,
    inputRef,
    start,
    finish,
    cancel,
  };
}
