import { useTranslation } from "react-i18next";
import type { OutlineNode } from "../../../shared/pdf/loadPdf";

type OutlineListProps = {
  nodes: OutlineNode[];
  parentPath: string;
  depth: number;
  activeKey: string | null;
  onSelect: (pageNumber: number) => void;
};

export function OutlineList({ nodes, parentPath, depth, activeKey, onSelect }: OutlineListProps) {
  const { t } = useTranslation();
  return (
    <ul className="reader-toc-list" role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node, index) => {
        const path = parentPath ? `${parentPath}.${index}` : String(index);
        const isActive = path === activeKey;
        const hasPage = node.pageNumber !== null;
        return (
          <li
            key={path}
            role="treeitem"
            aria-expanded={node.children.length > 0 ? true : undefined}
          >
            <button
              type="button"
              className={`reader-toc-item${isActive ? " is-active" : ""}`}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              disabled={!hasPage}
              onClick={() => {
                if (node.pageNumber !== null) onSelect(node.pageNumber);
              }}
            >
              <span className="reader-toc-title">{node.title || t("reader.untitled")}</span>
              {hasPage && <span className="reader-toc-page">{node.pageNumber}</span>}
            </button>
            {node.children.length > 0 && (
              <OutlineList
                nodes={node.children}
                parentPath={path}
                depth={depth + 1}
                activeKey={activeKey}
                onSelect={onSelect}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}
