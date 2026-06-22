import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Switch } from "@base-ui/react/switch";
import {
  ArrowUp,
  BookOpenText,
  ChatCircleDots,
  Paperclip,
  Stop,
  TextAa,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  cancelChat,
  getLLMSettings,
  onAnswerDelta,
  startChat,
  type AnswerDelta,
  type LLMSettings,
} from "../../shared/api/backend";
import { contextPreview, trimChatContext } from "../../shared/lib/text";
import { localizeBackendError } from "../../shared/i18n/error";

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
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [includeContext, setIncludeContext] = useState(true);
  const [source, setSource] = useState<ContextSource>("page");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [llmSettings, setLLMSettings] = useState<LLMSettings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const activeRequest = useRef("");
  const messageEndRef = useRef<HTMLDivElement>(null);

  const hasSelection = !!selection && selection.text.length > 0;

  const refreshSettings = useCallback(async () => {
    try {
      setLLMSettings(await getLLMSettings());
      setSettingsError("");
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : t("chat.loadSettingsError"));
    }
  }, [t]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

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
        setError(localizeBackendError(delta.error, t));
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
  }, [t]);

  const handleCancel = useCallback(async () => {
    const requestId = activeRequest.current;
    if (!requestId) {
      return;
    }
    activeRequest.current = "";
    setSending(false);
    try {
      await cancelChat(requestId);
    } catch (reason) {
      setError(reason instanceof Error ? localizeBackendError(reason.message, t) : t("chat.cancelError"));
    }
  }, [t]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || sending) {
      return;
    }
    if (!llmSettings?.configured) {
      setError(t("chat.configureError"));
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
      await startChat({
        requestId,
        question: normalizedQuestion,
        contextText: includeContext ? trimChatContext(rawContextText) : "",
        bookName: context.bookName,
        pageNumber: contextPageNumber,
      });
    } catch (reason) {
      activeRequest.current = "";
      setSending(false);
      setError(reason instanceof Error ? localizeBackendError(reason.message, t) : t("chat.sendError"));
    }
  }

  const hasPageContext = context.pageNumber > 0 && context.text.length > 0;
  const activeSource: ContextSource = hasSelection && source === "selection" ? "selection" : "page";
  const hasContext = activeSource === "selection" ? hasSelection : hasPageContext;
  const previewText = activeSource === "selection" ? selection!.text : context.text;
  const headlinePage = activeSource === "selection" ? selection!.pageNumber : context.pageNumber;
  const headline = hasContext
    ? activeSource === "selection"
      ? t("chat.selectionHeadline", { page: headlinePage })
      : `Page ${headlinePage}`
    : t("chat.noPdf");
  const composerLabel = !includeContext || !hasContext
    ? t("chat.noContext")
    : activeSource === "selection"
      ? t("chat.attachSelection", { page: headlinePage })
      : t("chat.attachPage", { page: headlinePage });

  return (
    <aside className="chat-sidebar" aria-label={t("chat.aria")}>
      <header className="chat-header">
        <div className="assistant-heading">
          <span className="assistant-icon" aria-hidden="true">
            <ChatCircleDots size={17} weight="regular" />
          </span>
          <div>
            <h2>{t("chat.assistant")}</h2>
            <p>{t("chat.subtitle")}</p>
          </div>
        </div>
      </header>

      <div className="chat-settings-feedback" aria-live="polite">
        {settingsError && <p className="chat-settings-error" role="alert">{settingsError}</p>}
      </div>

      <section className="context-panel" aria-label={t("chat.contextAria")}>
        <div className="context-heading">
          <div className="context-source">
            {activeSource === "selection" ? (
              <TextAa size={15} weight="regular" />
            ) : (
              <BookOpenText size={15} weight="regular" />
            )}
            <div>
              <span className="context-label">{t("chat.readingContext")}</span>
              <strong>{headline}</strong>
            </div>
          </div>
          <label className="context-toggle">
            <Switch.Root
              className="context-switch"
              checked={includeContext && hasContext}
              disabled={!hasContext || sending}
              onCheckedChange={setIncludeContext}
              aria-label={t("chat.includeContext")}
            >
              <Switch.Thumb className="context-switch-thumb" />
            </Switch.Root>
            <span>{includeContext && hasContext ? t("chat.attach") : t("chat.doNotAttach")}</span>
          </label>
        </div>
        {hasSelection && hasPageContext && (
          <div className="context-source-tabs" role="tablist" aria-label={t("chat.contextChoice")}>
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === "selection"}
              className={activeSource === "selection" ? "is-active" : ""}
              onClick={() => setSource("selection")}
            >
              {t("chat.selection")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSource === "page"}
              className={activeSource === "page" ? "is-active" : ""}
              onClick={() => setSource("page")}
            >
              {t("chat.wholePage")}
            </button>
          </div>
        )}
        <p className={hasContext ? "context-preview" : "context-preview context-placeholder"}>
          {hasContext
            ? contextPreview(previewText)
            : t("chat.contextPlaceholder")}
        </p>
        {hasContext && (
          <p className="context-meta"><Paperclip size={11} /> {t("chat.maxCharacters")}</p>
        )}
      </section>

      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`message message-${message.role}`}>
            <div className="message-meta">
              <span className="message-author">{message.role === "assistant" ? "Glint" : t("chat.you")}</span>
              {message.role === "assistant" && <span className="message-rule" />}
            </div>
            {message.id === "welcome" ? (
              <p className="message-body">{t("chat.welcome")}</p>
            ) : message.content ? (
              message.role === "assistant" ? (
                <div className="message-body message-markdown">
                  <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                </div>
              ) : (
                <p className="message-body">{message.content}</p>
              )
            ) : (
              <p className="message-body"><span className="typing-indicator"><i /><i /><i /></span></p>
            )}
          </article>
        ))}
        <div ref={messageEndRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        {error && <p className="chat-error" role="alert">{error}</p>}
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder={t("chat.placeholder")}
          rows={3}
          disabled={sending}
          onKeyDown={(event) => {
            if (
              event.key === "Enter"
              && event.metaKey
              && !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="composer-footer">
          <span>{llmSettings?.configured ? composerLabel : t("chat.openRouterRequired")}</span>
          {sending ? (
            <button type="button" className="chat-cancel" onClick={() => void handleCancel()}>
              <span>{t("chat.cancel")}</span>
              <Stop size={12} weight="fill" />
            </button>
          ) : (
            <button type="submit" disabled={!question.trim() || !llmSettings?.configured}>
              <span>{t("chat.send")}</span>
              <ArrowUp size={14} weight="bold" />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
