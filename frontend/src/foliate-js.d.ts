// The parts of foliate-js (https://github.com/johnfactotum/foliate-js) that
// Glint uses. The library ships plain JavaScript without types.
declare module "foliate-js/view.js" {
  export type FoliateTocItem = {
    label?: string;
    href?: string;
    subitems?: FoliateTocItem[] | null;
  };

  export type FoliateSection = {
    linear?: string;
  };

  export type FoliateBook = {
    dir?: string;
    sections: FoliateSection[];
    toc?: FoliateTocItem[] | null;
    /** Fires "load" before a resource loads and "data" before it is turned into a URL. */
    transformTarget?: EventTarget;
  };

  export type FoliateRelocateDetail = {
    fraction: number;
    section?: { current: number; total: number };
    tocItem?: FoliateTocItem | null;
    cfi: string;
  };

  export type FoliateLoadDetail = {
    doc: Document;
    index: number;
  };

  export type FoliateLinkDetail = {
    a: Element;
    href: string;
  };

  export type FoliateSearchResult =
    | "done"
    | { progress: number }
    | { cfi: string; excerpt: unknown };

  export type FoliatePaginator = HTMLElement & {
    setStyles(styles: string): void;
  };

  export type FoliateAnnotation = { value: string };

  export type FoliateDrawAnnotationDetail = {
    annotation: FoliateAnnotation;
    draw: (
      draw: (rects: DOMRectList, options: { color: string }) => SVGElement,
      options: { color: string },
    ) => void;
  };

  export type FoliateShowAnnotationDetail = {
    value: string;
    index: number;
    range: Range;
  };

  type FoliateViewEventMap = {
    relocate: FoliateRelocateDetail;
    load: FoliateLoadDetail;
    link: FoliateLinkDetail;
    "external-link": FoliateLinkDetail;
    "create-overlay": { index: number };
    "draw-annotation": FoliateDrawAnnotationDetail;
    "show-annotation": FoliateShowAnnotationDetail;
  };

  export class View extends HTMLElement {
    book?: FoliateBook;
    renderer?: FoliatePaginator;
    open(book: string | Blob): Promise<void>;
    close(): void;
    init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    goTo(target: string | number): Promise<unknown>;
    goToFraction(fraction: number): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    search(options: { query: string; index?: number }): AsyncGenerator<FoliateSearchResult>;
    clearSearch(): void;
    getCFI(index: number, range: Range): string;
    getTOCItemOf(target: string): Promise<FoliateTocItem | undefined>;
    addAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
    deleteAnnotation(annotation: FoliateAnnotation): Promise<unknown>;
    addEventListener<K extends keyof FoliateViewEventMap>(
      type: K,
      listener: (event: CustomEvent<FoliateViewEventMap[K]>) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void;
  }
}

declare module "foliate-js/overlayer.js" {
  export const Overlayer: {
    highlight(rects: DOMRectList, options: { color: string }): SVGElement;
  };
}

declare module "foliate-js/epubcfi.js" {
  /** Orders two CFIs by their position in the book. */
  export function compare(a: string, b: string): number;
}
