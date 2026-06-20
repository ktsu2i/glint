import { OpenPDF, StartMockChat } from "../../../wailsjs/go/main/App";
import { EventsOff, EventsOn } from "../../../wailsjs/runtime/runtime";

export type BookFile = {
  name: string;
  url: string;
  size: number;
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

export async function openPDF(): Promise<BookFile> {
  return (await OpenPDF()) as BookFile;
}

export async function startMockChat(request: ChatRequest): Promise<void> {
  await StartMockChat(request);
}

export function onAnswerDelta(callback: (delta: AnswerDelta) => void): () => void {
  EventsOn("chat:delta", callback);
  return () => EventsOff("chat:delta");
}
