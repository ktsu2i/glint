import { FormEvent, useEffect, useRef, useState } from "react";
import {
  onAnswerDelta,
  startMockChat,
  type AnswerDelta,
} from "../../shared/api/backend";
import { contextPreview, trimChatContext } from "../../shared/lib/text";

type ReadingContext = {
  bookName: string;
  pageNumber: number;
  text: string;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatSidebarProps = {
  context: ReadingContext;
};

export function ChatSidebar({ context }: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "ページを開いたら、その内容をcontextに含めて質問できます。現在はmock providerでstreaming UIを確認できます。",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef("");
  const messageEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onAnswerDelta((delta: AnswerDelta) => {
      if (delta.requestId !== activeRequest.current) {
        return;
      }
      if (delta.error) {
        setError(delta.error);
        setSending(false);
      }
      if (delta.content) {
        setMessages((current) =>
          current.map((message) =>
            message.id === `assistant-${delta.requestId}`
              ? { ...message, content: message.content + delta.content }
              : message,
          ),
        );
      }
      if (delta.done) {
        setSending(false);
        activeRequest.current = "";
      }
    });
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || sending) {
      return;
    }

    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    setQuestion("");
    setError("");
    setSending(true);
    setMessages((current) => [
      ...current,
      { id: `user-${requestId}`, role: "user", content: normalizedQuestion },
      { id: `assistant-${requestId}`, role: "assistant", content: "" },
    ]);

    try {
      await startMockChat({
        requestId,
        question: normalizedQuestion,
        contextText: includeContext ? trimChatContext(context.text) : "",
        bookName: context.bookName,
        pageNumber: context.pageNumber,
      });
    } catch (reason) {
      activeRequest.current = "";
      setSending(false);
      setError(reason instanceof Error ? reason.message : "質問を送信できませんでした。");
    }
  }

  const hasContext = context.pageNumber > 0 && context.text.length > 0;

  return (
    <aside className="chat-sidebar" aria-label="AI chat">
      <header className="chat-header">
        <div>
          <p className="eyebrow">READING ASSISTANT</p>
          <h2>Ask Glint</h2>
        </div>
        <span className="provider-badge"><span /> MOCK</span>
      </header>

      <section className="context-card" aria-label="送信context">
        <div className="context-heading">
          <div>
            <span className="context-label">CONTEXT</span>
            <strong>{hasContext ? `Page ${context.pageNumber}` : "PDF未選択"}</strong>
          </div>
          <label className="context-switch">
            <input
              type="checkbox"
              checked={includeContext}
              disabled={!hasContext || sending}
              onChange={(event) => setIncludeContext(event.target.checked)}
            />
            <span>{includeContext && hasContext ? "含める" : "含めない"}</span>
          </label>
        </div>
        <p className={hasContext ? "context-preview" : "context-preview context-placeholder"}>
          {hasContext
            ? contextPreview(context.text)
            : "PDFを開くと、current page textのpreviewがここに表示されます。"}
        </p>
        {hasContext && (
          <p className="context-meta">最大6,000文字・送信前に明示的に確認</p>
        )}
      </section>

      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`message message-${message.role}`}>
            <span className="message-author">{message.role === "assistant" ? "GLINT" : "YOU"}</span>
            <p>{message.content || <span className="typing-indicator">● ● ●</span>}</p>
          </article>
        ))}
        <div ref={messageEndRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        {error && <p className="chat-error" role="alert">{error}</p>}
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="このページについて質問する…"
          rows={3}
          disabled={sending}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="composer-footer">
          <span>Enter で送信 · Shift+Enter で改行</span>
          <button type="submit" disabled={!question.trim() || sending}>
            {sending ? "応答中" : "送信"} <span>↗</span>
          </button>
        </div>
      </form>
    </aside>
  );
}
