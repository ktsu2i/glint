import { useCallback, useEffect, useMemo, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { loadPdfOutline, type OutlineNode } from "../../../shared/pdf/loadPdf";

type FlatOutlineEntry = { path: string; pageNumber: number | null };

function flattenOutline(nodes: OutlineNode[], parentPath = ""): FlatOutlineEntry[] {
  const result: FlatOutlineEntry[] = [];
  nodes.forEach((node, index) => {
    const path = parentPath ? `${parentPath}.${index}` : String(index);
    result.push({ path, pageNumber: node.pageNumber });
    if (node.children.length > 0) {
      result.push(...flattenOutline(node.children, path));
    }
  });
  return result;
}

export function usePdfOutline(document: PDFDocumentProxy | null, pageNumber: number) {
  const [outline, setOutline] = useState<OutlineNode[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!document) {
      return;
    }
    let active = true;
    const load = async () => {
      let nodes: OutlineNode[] = [];
      try {
        nodes = await loadPdfOutline(document);
      } catch {}
      if (active) {
        setOutline(nodes);
        setLoaded(true);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [document]);

  const flatOutline = useMemo(() => flattenOutline(outline), [outline]);
  const activeKey = useMemo(() => {
    let last: string | null = null;
    for (const entry of flatOutline) {
      if (entry.pageNumber !== null && entry.pageNumber <= pageNumber) {
        last = entry.path;
      }
    }
    return last;
  }, [flatOutline, pageNumber]);

  const reset = useCallback(() => {
    setOutline([]);
    setLoaded(false);
  }, []);

  return { outline, loaded, activeKey, reset };
}
