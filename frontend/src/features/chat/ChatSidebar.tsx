import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ChatCircleDots,
  Stop,
  TextAa,
  X,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  cancelChat,
  getLLMConfig,
  onAnswerDelta,
  startChat,
  type AnswerDelta,
  type LLMConfig,
  type ProviderSettings,
} from "../../shared/api/backend";
import { contextPreview, trimChatContext } from "../../shared/lib/text";
import { localizeBackendError } from "../../shared/i18n/error";

type ReadingContext = {
  bookName: string;
  pageNumber: number;
};

type SelectionContext = {
  text: string;
  pageNumber: number;
};

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  responseState?: "streaming" | "complete" | "cancelled";
};

type ChatSidebarProps = {
  context: ReadingContext;
  selection?: SelectionContext | null;
  onClearSelection?: () => void;
};

export function ChatSidebar({ context, selection = null, onClearSelection }: ChatSidebarProps) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "",
    },
  ]);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [llmConfig, setLLMConfig] = useState<LLMConfig | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const activeRequest = useRef("");
  const messageEndRef = useRef<HTMLDivElement>(null);

  const hasSelection = !!selection && selection.text.length > 0;
  const activeProvider: ProviderSettings | null =
    llmConfig?.providers.find((provider) => provider.providerId === llmConfig.activeProviderId) ?? null;
  const providerConfigured = activeProvider?.configured ?? false;

  const refreshSettings = useCallback(async () => {
    try {
      setLLMConfig(await getLLMConfig());
      setSettingsError("");
    } catch (reason) {
      let message: string = t("chat.loadSettingsError");
      if (reason instanceof Error) message = reason.message;
      else if (typeof reason === "string" && reason.trim() !== "") message = reason;
      setSettingsError(message);
    }
  }, [t]);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

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
        setMessages((current) =>
          current.map((message) =>
            message.id === `assistant-${delta.requestId}`
              ? { ...message, responseState: "complete" }
              : message,
          ),
        );
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
    setMessages((current) =>
      current.map((message) =>
        message.id === `assistant-${requestId}`
          ? { ...message, responseState: "cancelled" }
          : message,
      ),
    );
    try {
      await cancelChat(requestId);
    } catch (reason) {
      setError(reason instanceof Error ? localizeBackendError(reason.message, t) : t("chat.cancelError"));
    }
  }, [t]);

  useEffect(() => {
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || !activeRequest.current) {
        return;
      }
      event.preventDefault();
      void handleCancel();
    }

    window.addEventListener("keydown", cancelOnEscape);
    return () => window.removeEventListener("keydown", cancelOnEscape);
  }, [handleCancel]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || sending) {
      return;
    }
    if (!providerConfigured) {
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
      {
        id: `assistant-${requestId}`,
        role: "assistant",
        content: "",
        responseState: "streaming",
      },
    ]);

    const contextPageNumber = hasSelection ? selection!.pageNumber : context.pageNumber;
    const contextText = hasSelection ? trimChatContext(selection!.text) : "";

    if (hasSelection) {
      onClearSelection?.();
    }

    try {
      await startChat({
        requestId,
        question: normalizedQuestion,
        contextText,
        bookName: context.bookName,
        pageNumber: contextPageNumber,
      });
    } catch (reason) {
      activeRequest.current = "";
      setSending(false);
      setError(reason instanceof Error ? localizeBackendError(reason.message, t) : t("chat.sendError"));
    }
  }

  const composerLabel = hasSelection
    ? t("chat.attachSelection", { page: selection!.pageNumber })
    : t("chat.noContext");

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

      <div className="message-list" aria-live="polite">
        {messages.map((message) => (
          <article key={message.id} className={`message message-${message.role}`}>
            <div className="message-meta">
              <span className="message-author">{message.role === "assistant" ? "Glint" : t("chat.you")}</span>
              {message.role === "assistant" && <span className="message-rule" />}
            </div>
            {message.id === "welcome" ? (
              <p className="message-body">{t("chat.welcome")}</p>
            ) : (
              <>
                {message.content && (message.role === "assistant" ? (
                  <div className="message-body message-markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>{message.content}</Markdown>
                  </div>
                ) : (
                  <p className="message-body">{message.content}</p>
                ))}
                {!message.content && message.responseState === "streaming" && (
                  <p className="message-body"><span className="typing-indicator"><i /><i /><i /></span></p>
                )}
                {message.responseState === "cancelled" && (
                  <div className="message-cancelled" role="status">
                    <Stop size={11} weight="fill" aria-hidden="true" />
                    <span>{t("chat.responseCancelled")}</span>
                  </div>
                )}
              </>
            )}
          </article>
        ))}
        <div ref={messageEndRef} />
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        {hasSelection && (
          <div className="context-chip" aria-label={t("chat.contextChipAria", { page: selection!.pageNumber })}>
            <div className="context-chip-meta">
              <TextAa size={11} weight="regular" />
              <span>{t("chat.selectionHeadline", { page: selection!.pageNumber })}</span>
            </div>
            {onClearSelection && (
              <button
                type="button"
                className="context-chip-remove"
                aria-label={t("chat.removeContext")}
                onClick={onClearSelection}
                disabled={sending}
              >
                <X size={10} weight="bold" />
              </button>
            )}
            <p className="context-chip-preview">{contextPreview(selection!.text, 160)}</p>
          </div>
        )}
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
          <span>{providerConfigured ? composerLabel : t("chat.openRouterRequired")}</span>
          {sending ? (
            <button type="button" className="chat-cancel" onClick={() => void handleCancel()}>
              <span>{t("chat.cancel")}</span>
              <Stop size={12} weight="fill" />
            </button>
          ) : (
            <button type="submit" disabled={!question.trim() || !providerConfigured}>
              <span>{t("chat.send")}</span>
              <ArrowUp size={14} weight="bold" />
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
