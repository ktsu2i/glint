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

  type FoliateViewEventMap = {
    relocate: FoliateRelocateDetail;
    load: FoliateLoadDetail;
    link: FoliateLinkDetail;
    "external-link": FoliateLinkDetail;
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
