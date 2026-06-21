import {
  ListBooks,
  MarkBookCoverFailed,
  OpenBook,
  OpenPDF,
  RelinkPDF,
  RemoveBook,
  RenameBook,
  SaveBookCover,
  SaveReadingPosition,
} from "../../../wailsjs/go/books/Service";
import { CancelChat, StartChat } from "../../../wailsjs/go/chat/Service";
import {
  GetLLMSettings,
  SaveLLMSettings,
} from "../../../wailsjs/go/settings/Service";
import { EventsOff, EventsOn } from "../../../wailsjs/runtime/runtime";

export type BookFile = {
  id: string;
  title: string;
  name: string;
  url: string;
  size: number;
  initialPage: number;
  coverStatus: "pending" | "ready" | "failed";
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

export type LLMSettings = {
  provider: "openrouter";
  model: string;
  zdr: boolean;
  hasApiKey: boolean;
  configured: boolean;
};

export type SaveLLMSettingsRequest = {
  model: string;
  apiKey: string;
  zdr: boolean;
  clearApiKey: boolean;
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

export async function getLLMSettings(): Promise<LLMSettings> {
  return (await GetLLMSettings()) as LLMSettings;
}

export async function saveLLMSettings(request: SaveLLMSettingsRequest): Promise<LLMSettings> {
  return (await SaveLLMSettings(request)) as LLMSettings;
}

export function onAnswerDelta(callback: (delta: AnswerDelta) => void): () => void {
  EventsOn("chat:delta", callback);
  return () => EventsOff("chat:delta");
}
