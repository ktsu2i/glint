import { fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  listProviderModels: vi.fn(),
  addCustomModel: vi.fn(),
  removeCustomModel: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  listProviderModels: backend.listProviderModels,
  addCustomModel: backend.addCustomModel,
  removeCustomModel: backend.removeCustomModel,
}));

import { ModelSelector } from "./ModelSelector";
import { I18nProvider } from "../../shared/i18n/i18n";
import type { LLMConfig } from "../../shared/api/backend";

function render(ui: ReactNode) {
  return renderBase(ui, {
    wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider>,
  });
}

function makeConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    activeProviderId: "openai",
    activeModelRef: { providerId: "openai", modelId: "gpt-5" },
    recentProviderIds: ["openai"],
    recentModels: [{ providerId: "openai", modelId: "gpt-5" }],
    providers: [
      {
        providerId: "openai",
        model: "gpt-5",
        models: [],
        hasApiKey: true,
        configured: true,
        isActive: true,
      },
      {
        providerId: "anthropic",
        model: "claude-opus-4-7",
        models: [],
        hasApiKey: true,
        configured: true,
        isActive: false,
      },
      {
        providerId: "openai_compatible:local",
        displayLabel: "Local",
        model: "local-7b",
        models: ["local-7b"],
        hasApiKey: false,
        configured: true,
        isActive: false,
      },
      {
        providerId: "ollama",
        model: "",
        models: [],
        hasApiKey: false,
        configured: false,
        isActive: false,
      },
    ],
    catalog: [
      {
        id: "openai",
        displayName: "OpenAI",
        authKind: "bearer",
        optionSchema: [],
        capabilities: { streaming: true, tools: false, images: false },
      },
      {
        id: "anthropic",
        displayName: "Anthropic",
        authKind: "x-api-key",
        optionSchema: [],
        capabilities: { streaming: true, tools: false, images: false },
      },
      {
        id: "ollama",
        displayName: "Ollama",
        authKind: "none",
        optionSchema: [],
        capabilities: { streaming: true, tools: false, images: false },
      },
      {
        id: "openai_compatible",
        displayName: "OpenAI-compatible",
        authKind: "bearer",
        optionSchema: [],
        capabilities: { streaming: true, tools: false, images: false },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.listProviderModels.mockImplementation(async (providerId: string) => {
    if (providerId === "openai") {
      return { providerId, models: [{ id: "gpt-5", source: "builtin" }], source: "builtin" };
    }
    if (providerId === "anthropic") {
      return {
        providerId,
        models: [{ id: "claude-opus-4-7", source: "builtin" }],
        source: "builtin",
      };
    }
    return { providerId, models: [], source: "builtin" };
  });
  backend.addCustomModel.mockImplementation(async (providerId: string) =>
    makeConfig({
      providers: makeConfig().providers.map((provider) =>
        provider.providerId === providerId
          ? { ...provider, models: [...(provider.models ?? []), "custom-new"] }
          : provider,
      ),
    }),
  );
  backend.removeCustomModel.mockImplementation(async () => makeConfig());
});

describe("ModelSelector", () => {
  it("renders the active model with provider/model tooltip and a popover that lists configured options", async () => {
    const onSelect = vi.fn();
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={onSelect}
        onOpenSettings={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: /gpt-5/ });
    expect(button.getAttribute("title")).toBe("openai / gpt-5");
    fireEvent.click(button);

    const popover = screen.getByRole("dialog");
    expect(popover).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("option", { name: /gpt-5/ })).toBeTruthy());
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /claude-opus-4-7/ })).toBeTruthy(),
    );
    expect(screen.getByRole("option", { name: /local-7b/ })).toBeTruthy();
    // ollama has no configured model => filtered out
    expect(screen.queryByText(/Ollama/)).toBeNull();
  });

  it("filters by query then selects with Enter, calling onSelect with the (providerId, modelId) pair", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={onSelect}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    const search = screen.getByRole("textbox", { name: "modelを検索" });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /claude-opus-4-7/ })).toBeTruthy(),
    );
    fireEvent.change(search, { target: { value: "claude" } });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /claude-opus-4-7/ })).toBeTruthy();
    });
    expect(screen.queryByRole("option", { name: /gpt-5/ })).toBeNull();

    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("anthropic", "claude-opus-4-7"));
  });

  it("walks options with ArrowDown / ArrowUp and selects with Enter", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={onSelect}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    const search = screen.getByRole("textbox", { name: "modelを検索" });
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));

    // The first focused entry is the recent (openai, gpt-5). ArrowDown moves to the
    // next entry across sections.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    const [calledWith] = onSelect.mock.calls;
    expect(calledWith![0]).not.toBe("openai");
  });

  it("closes on Escape and restores focus to the trigger button", async () => {
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /gpt-5/ });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    const search = screen.getByRole("textbox", { name: "modelを検索" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("invokes onOpenSettings from the popover footer", async () => {
    const onOpenSettings = vi.fn();
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Model connectionsを開く" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("renders a 'choose a model' setup CTA when nothing is configured", () => {
    const onOpenSettings = vi.fn();
    render(
      <ModelSelector
        config={makeConfig({
          providers: [],
          activeProviderId: "",
          recentProviderIds: [],
          recentModels: [],
        })}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    const cta = screen.getByRole("button", { name: "modelを選択" });
    fireEvent.click(cta);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  // 初回起動の backend は recentModels を null で返しうる。ここで throw すると
  // error boundary がないため app 全体が blank になる。
  it("renders when the backend returns null recents on a fresh install", () => {
    const config = makeConfig({
      providers: [],
      activeProviderId: "",
    });
    delete config.activeModelRef;
    // 型上は非 nullable なので、backend が実際に返す null を明示的に再現する。
    (config as unknown as { recentModels: unknown }).recentModels = null;
    (config as unknown as { recentProviderIds: unknown }).recentProviderIds = null;

    expect(() =>
      render(
        <ModelSelector
          config={config}
          switching={false}
          onSelect={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByRole("button", { name: "modelを選択" })).toBeTruthy();
  });

  it("places recently-used (provider, model) pairs above the rest", async () => {
    render(
      <ModelSelector
        config={makeConfig({
          activeProviderId: "anthropic",
          activeModelRef: { providerId: "anthropic", modelId: "claude-opus-4-7" },
          recentProviderIds: ["anthropic", "openai"],
          recentModels: [
            { providerId: "anthropic", modelId: "claude-opus-4-7" },
            { providerId: "openai", modelId: "gpt-5" },
          ],
        })}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /claude-opus-4-7/ }));
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    const options = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    expect(options[0]).toContain("claude-opus-4-7");
    expect(options[1]).toContain("gpt-5");
    expect(options[2]).toContain("local-7b");
  });

  // F14: listing source / fetched_at の表示
  it("shows the listing source badge and a relative fetched-at when listing has metadata", async () => {
    backend.listProviderModels.mockImplementation(async (providerId: string) => {
      if (providerId === "openai") {
        return {
          providerId,
          models: [{ id: "gpt-5", source: "api" }],
          source: "api",
          fetchedAt: new Date(Date.now() - 30_000).toISOString(),
        };
      }
      return { providerId, models: [], source: "builtin" };
    });
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    await waitFor(() => expect(screen.getByText("API取得")).toBeTruthy());
    // The English / Japanese "30 seconds ago" varies, but the badge must show something next to it.
    const badge = screen.getByText("API取得");
    expect(badge.dataset.source).toBe("api");
  });

  // F14: Refresh button で listProviderModels が force: true で呼ばれる
  it("re-fetches the provider listing with force when the Refresh button is pressed", async () => {
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /gpt-5/ })).toBeTruthy());
    backend.listProviderModels.mockClear();

    const refresh = screen.getByRole("button", { name: /OpenAIのmodel一覧を再取得/ });
    fireEvent.click(refresh);

    await waitFor(() =>
      expect(backend.listProviderModels).toHaveBeenCalledWith("openai", { force: true }),
    );
  });

  // F14: + Add custom model で addCustomModel が呼ばれる
  it("adds a manual model id for a custom provider via the popover input", async () => {
    const onConfigChange = vi.fn();
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /local-7b/ })).toBeTruthy());

    const input = screen.getByLabelText("Localにmodel idを追加");
    fireEvent.change(input, { target: { value: "extra-7b" } });
    const addButton = screen.getByRole("button", { name: "modelを追加" });
    fireEvent.click(addButton);

    await waitFor(() =>
      expect(backend.addCustomModel).toHaveBeenCalledWith("openai_compatible:local", "extra-7b"),
    );
    await waitFor(() => expect(onConfigChange).toHaveBeenCalled());
  });

  // F14: custom model row の Remove で removeCustomModel が呼ばれる
  it("removes a custom model id via the trailing remove button", async () => {
    const onConfigChange = vi.fn();
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
        onConfigChange={onConfigChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /local-7b/ })).toBeTruthy());

    const remove = screen.getByRole("button", { name: "local-7bを削除" });
    fireEvent.click(remove);
    await waitFor(() =>
      expect(backend.removeCustomModel).toHaveBeenCalledWith("openai_compatible:local", "local-7b"),
    );
    await waitFor(() => expect(onConfigChange).toHaveBeenCalled());
  });

  // F14: keyboard 操作 - Tab で Refresh / Add / Remove 等が focusable
  it("keeps Refresh, Add, and Remove buttons reachable via keyboard focus", async () => {
    render(
      <ModelSelector
        config={makeConfig()}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    await waitFor(() => expect(screen.getByRole("option", { name: /local-7b/ })).toBeTruthy());

    // Confirm each action button is a real <button> with a focusable target (not aria-hidden / disabled by default).
    const refresh = screen.getByRole("button", { name: /OpenAIのmodel一覧を再取得/ });
    const addButton = screen.getByRole("button", { name: "modelを追加" });
    const remove = screen.getByRole("button", { name: "local-7bを削除" });

    refresh.focus();
    expect(document.activeElement).toBe(refresh);
    // disabled until the input has text
    expect(addButton.hasAttribute("disabled")).toBe(true);
    remove.focus();
    expect(document.activeElement).toBe(remove);
  });
});
