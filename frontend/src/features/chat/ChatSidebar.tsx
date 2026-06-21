import { FormEvent, useEffect, useRef, useState } from "react";
import { Switch } from "@base-ui/react/switch";
import {
  ArrowUp,
  BookOpenText,
  ChatCircleDots,
  Paperclip,
  TextAa,
} from "@phosphor-icons/react";
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

type SelectionContext = {
  text: string;
  pageNumber: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type ChatSidebarProps = {
  context: ReadingContext;
  selection?: SelectionContext | null;
};

type ContextSource = "selection" | "page";

export function ChatSidebar({ context, selection = null }: ChatSidebarProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "PDFを開くと、表示中のページを文脈として添付できます。現在はmock providerで応答を確認できます。",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [source, setSource] = useState<ContextSource>("page");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const activeRequest = useRef("");
  const messageEndRef = useRef<HTMLDivElement>(null);

  const hasSelection = !!selection && selection.text.length > 0;

  useEffect(() => {
    if (hasSelection) {
      setSource("selection");
    } else {
      setSource("page");
    }
  }, [hasSelection]);

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

    const activeSource = hasSelection && source === "selection" ? "selection" : "page";
    const rawContextText = activeSource === "selection" ? selection!.text : context.text;
    const contextPageNumber = activeSource === "selection" ? selection!.pageNumber : context.pageNumber;

    try {
      await startMockChat({
        requestId,
        question: normalizedQuestion,
        contextText: includeContext ? trimChatContext(rawContextText) : "",
        bookName: context.bookName,
        pageNumber: contextPageNumber,
      });
    } catch (reason) {
      activeRequest.current = "";
      setSending(false);
      setError(reason instanceof Error ? reason.message : "質問を送信できませんでした。");
    }
  }

  const hasPageContext = context.pageNumber > 0 && context.text.length > 0;
  const activeSource: ContextSource = hasSelection && source === "selection" ? "selection" : "page";
  const hasContext = activeSource === "selection" ? hasSelection : hasPageContext;
  const previewText = activeSource === "selection" ? selection!.text : context.text;
  const headlinePage = activeSource === "selection" ? selection!.pageNumber : context.pageNumber;
  const headline = hasContext
    ? activeSource === "selection"
      ? `選択範囲（Page ${headlinePage}）`
      : `Page ${headlinePage}`
    : "PDF未選択";
  const composerLabel = !includeContext || !hasContext
    ? "文脈なし"
    : activeSource === "selection"
      ? `Page ${headlinePage} の選択範囲を添付`
      : `Page ${headlinePage} を添付`;

  return (
    <aside className="chat-sidebar" aria-label="AI chat">
      <header className="chat-header">
        <div className="assistant-heading">
          <span className="assistant-icon" aria-hidden="true">
            <ChatCircleDots size={17} weight="regular" />
          </span>
          <div>
            <h2>Assistant</h2>
            <p>読書中の疑問を整理する</p>
          </div>
        </div>
        <span className="provider-status"><span /> Mock</span>
      </header>

      <section className="context-panel" aria-label="送信する読書文脈">
        <div className="context-heading">
          <div className="context-source">
            {activeSource === "selection" ? (
              <TextAa size={15} weight="regular" />
            ) : (
              <BookOpenText size={15} weight="regular" />
            )}
            <div>
              <span className="context-label">Reading context</span>
              <strong>{headline}</strong>
            </div>
          </div>
          <label className="context-toggle">
            <Switch.Root
              className="context-switch"
              checked={includeContext && hasContext}
              disabled={!hasContext || sending}
              onCheckedChange={setIncludeContext}
              aria-label="この文脈を質問に含める"
            >
              <Switch.Thumb className="context-switch-thumb" />
            </Switch.Root>
            <span>{includeContext && hasContext ? "添付する" : "添付しない"}</span>
          </label>
        </div>
        {hasSelection && hasPageContext && (
          <div className="context-source-tabs" role="tablist" aria-label="添付する文脈の選び方">
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === "selection"}
              className={activeSource === "selection" ? "is-active" : ""}
              onClick={() => setSource("selection")}
            >
              選択範囲
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === "page"}
              className={activeSource === "page" ? "is-active" : ""}
              onClick={() => setSource("page")}
            >
              ページ全体
            </button>
          </div>
        )}
        <p className={hasContext ? "context-preview" : "context-preview context-placeholder"}>
          {hasContext
            ? contextPreview(previewText)
            : "PDFを開くと、current page textのpreviewがここに表示されます。"}
        </p>
        {hasContext && (
          <p className="context-meta"><Paperclip size={11} /> 最大6,000文字</p>
        )}
      </section>

      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`message message-${message.role}`}>
            <div className="message-meta">
              <span className="message-author">{message.role === "assistant" ? "Glint" : "You"}</span>
              {message.role === "assistant" && <span className="message-rule" />}
            </div>
            <p>{message.content || <span className="typing-indicator"><i /><i /><i /></span>}</p>
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
          <span>{composerLabel}</span>
          <button type="submit" disabled={!question.trim() || sending}>
            <span>{sending ? "応答中" : "送信"}</span>
            <ArrowUp size={14} weight="bold" />
          </button>
        </div>
      </form>
    </aside>
  );
}
