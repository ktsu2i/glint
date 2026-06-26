import {
  AddBookmark,
  ListBookmarks,
  ListBooks,
  MarkBookCoverFailed,
  OpenBook,
  OpenPDF,
  RelinkPDF,
  RemoveBook,
  RemoveBookmark,
  RenameBook,
  SaveBookPages,
  SaveBookCover,
  SaveReadingPosition,
  SearchBook,
  SearchLibrary,
} from "../../../wailsjs/go/books/Service";
import { CancelChat, StartChat } from "../../../wailsjs/go/chat/Service";
import {
  DeleteProviderSettings,
  GetAppearanceSettings,
  GetLanguageSettings,
  GetLLMConfig,
  SaveAppearanceSettings,
  SaveLanguageSettings,
  SetActiveProvider,
  TestProviderConnection,
  UpsertProviderSettings,
} from "../../../wailsjs/go/settings/Service";
import { EventsOff, EventsOn } from "../../../wailsjs/runtime/runtime";

export type BookFile = {
  id: string;
  title: string;
  name: string;
  url: string;
  size: number;
  initialPage: number;
  indexedPageCount: number;
  coverStatus: "pending" | "ready" | "failed";
};

export type BookPageInput = {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
};

export type BookSearchResult = {
  pageNumber: number;
  excerpt: string;
  matchCount: number;
};

export type BookBookmark = {
  pageNumber: number;
  createdAt: string;
};

export type BookSummary = {
  id: string;
  title: string;
  fileName: string;
  size: number;
  pageCount: number;
  lastPage: number;
  importedAt: string;
  lastOpenedAt: string;
  coverUrl: string;
  coverStatus: "pending" | "ready" | "failed";
  available: boolean;
};

export type LibrarySearchHit = {
  book: BookSummary;
  totalMatches: number;
  pages: BookSearchResult[];
};

export type ChatRequest = {
  requestId: string;
  question: string;
  contextText: string;
  bookName: string;
  pageNumber: number;
};

export type AnswerDelta = {
  requestId: string;
  content?: string;
  done: boolean;
  error?: string;
};

export type ProviderAuthKind = "bearer" | "x-api-key" | "query-key" | "none";

export type ProviderOptionType = "string" | "bool" | "url" | "headers";

export type ProviderOption = {
  key: string;
  label: string;
  type: ProviderOptionType;
  required: boolean;
  default?: unknown;
  helpText?: string;
};

export type ProviderCapabilities = {
  streaming: boolean;
  tools: boolean;
  images: boolean;
};

export type ProviderDescriptor = {
  id: string;
  displayName: string;
  authKind: ProviderAuthKind;
  defaultBaseUrl?: string;
  optionSchema: ProviderOption[];
  capabilities: ProviderCapabilities;
  notes?: string;
};

export type ProviderSettings = {
  providerId: string;
  displayLabel?: string;
  model: string;
  options?: Record<string, unknown>;
  hasApiKey: boolean;
  configured: boolean;
  isActive: boolean;
};

export type LLMConfig = {
  activeProviderId: string;
  providers: ProviderSettings[];
  catalog: ProviderDescriptor[];
  recentProviderIds: string[];
};

export type UpsertProviderRequest = {
  providerId: string;
  displayLabel?: string;
  model: string;
  options?: Record<string, unknown>;
  apiKey?: string;
  clearApiKey?: boolean;
  activate?: boolean;
};

export type TestProviderConnectionResult = {
  providerId: string;
  ok: boolean;
  error?: string;
};

export type ThemePreference = "light" | "dark" | "system";

export type AppearanceSettings = {
  theme: ThemePreference;
};

export type LanguagePreference = "en" | "ja";

export type LanguageSettings = {
  language: LanguagePreference;
};

export async function openPDF(): Promise<BookFile> {
  return (await OpenPDF()) as BookFile;
}

export async function listBooks(): Promise<BookSummary[]> {
  return (await ListBooks()) as BookSummary[];
}

export async function openBook(bookId: string): Promise<BookFile> {
  return (await OpenBook(bookId)) as BookFile;
}

export async function relinkPDF(bookId: string): Promise<BookFile> {
  return (await RelinkPDF(bookId)) as BookFile;
}

export async function removeBook(bookId: string): Promise<boolean> {
  return await RemoveBook(bookId);
}

export async function renameBook(bookId: string, name: string): Promise<BookSummary> {
  return (await RenameBook(bookId, name)) as BookSummary;
}

export async function saveReadingPosition(
  bookId: string,
  pageNumber: number,
  pageCount: number,
): Promise<void> {
  await SaveReadingPosition(bookId, pageNumber, pageCount);
}

export async function listBookmarks(bookId: string): Promise<BookBookmark[]> {
  return (await ListBookmarks(bookId)) as BookBookmark[];
}

export async function addBookmark(
  bookId: string,
  pageNumber: number,
  pageCount: number,
): Promise<BookBookmark> {
  return (await AddBookmark(bookId, pageNumber, pageCount)) as BookBookmark;
}

export async function removeBookmark(bookId: string, pageNumber: number): Promise<void> {
  await RemoveBookmark(bookId, pageNumber);
}

export async function saveBookPages(
  bookId: string,
  pages: BookPageInput[],
  pageCount: number,
): Promise<number> {
  return await SaveBookPages(bookId, pages, pageCount);
}

export async function searchBook(bookId: string, query: string): Promise<BookSearchResult[]> {
  return (await SearchBook(bookId, query)) as BookSearchResult[];
}

export async function searchLibrary(query: string): Promise<LibrarySearchHit[]> {
  return (await SearchLibrary(query)) as LibrarySearchHit[];
}

export async function saveBookCover(bookId: string, dataUrl: string): Promise<void> {
  await SaveBookCover(bookId, dataUrl);
}

export async function markBookCoverFailed(bookId: string): Promise<void> {
  await MarkBookCoverFailed(bookId);
}

export async function startChat(request: ChatRequest): Promise<void> {
  await StartChat(request);
}

export async function cancelChat(requestId: string): Promise<void> {
  await CancelChat(requestId);
}

export async function getLLMConfig(): Promise<LLMConfig> {
  return (await GetLLMConfig()) as LLMConfig;
}

export async function upsertProviderSettings(request: UpsertProviderRequest): Promise<LLMConfig> {
  return (await UpsertProviderSettings(request)) as LLMConfig;
}

export async function deleteProviderSettings(providerId: string): Promise<LLMConfig> {
  return (await DeleteProviderSettings(providerId)) as LLMConfig;
}

export async function setActiveProvider(providerId: string): Promise<LLMConfig> {
  return (await SetActiveProvider(providerId)) as LLMConfig;
}

export async function testProviderConnection(providerId: string): Promise<TestProviderConnectionResult> {
  return (await TestProviderConnection(providerId)) as TestProviderConnectionResult;
}

export async function getAppearanceSettings(): Promise<AppearanceSettings> {
  return (await GetAppearanceSettings()) as AppearanceSettings;
}

export async function saveAppearanceSettings(theme: ThemePreference): Promise<AppearanceSettings> {
  return (await SaveAppearanceSettings({ theme })) as AppearanceSettings;
}

export async function getLanguageSettings(): Promise<LanguageSettings> {
  return (await GetLanguageSettings()) as LanguageSettings;
}

export async function saveLanguageSettings(language: LanguagePreference): Promise<LanguageSettings> {
  return (await SaveLanguageSettings({ language })) as LanguageSettings;
}

export function onAnswerDelta(callback: (delta: AnswerDelta) => void): () => void {
  EventsOn("chat:delta", callback);
  return () => EventsOff("chat:delta");
}
