// Book types that more than one feature works with. The calls that return
// them live in the api.ts of the feature that makes them.

export type BookFormat = "pdf" | "epub";

/** Which side a PDF is bound on: a right-bound book reads its spreads right to left. */
export type BindingDirection = "ltr" | "rtl";

type CoverStatus = "pending" | "ready" | "failed";

type EpubSpineItem = {
  index: number;
  id: string;
  href: string;
  mediaType: string;
  title: string;
};

export type BookFile = {
  id: string;
  title: string;
  name: string;
  url: string;
  format?: BookFormat;
  size: number;
  initialPage: number;
  /** The place in the initialPage section where an EPUB was left, as an EPUB CFI. */
  initialCfi?: string;
  bindingDirection?: BindingDirection;
  indexedPageCount: number;
  nextSegment: number;
  coverStatus: CoverStatus;
  spineItems?: EpubSpineItem[];
};

export type BookSummary = {
  id: string;
  title: string;
  fileName: string;
  format?: BookFormat;
  size: number;
  pageCount: number;
  lastPage: number;
  importedAt: string;
  lastOpenedAt: string;
  coverUrl: string;
  coverStatus: CoverStatus;
  available: boolean;
};

export type BookSearchResult = {
  pageNumber: number;
  location: string;
  headingPath: string;
  excerpt: string;
  matchCount: number;
};
