import { fireEvent, render as renderBase, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  testProviderConnection: vi.fn(),
  upsertProviderSettings: vi.fn(),
  deleteProviderSettings: vi.fn(),
}));

// These APIs remain available to the composer, but Settings must never call
// them after F15's provider/model responsibility split.
const modelAPI = vi.hoisted(() => ({
  setActiveModel: vi.fn(),
  listProviderModels: vi.fn(),
  addCustomModel: vi.fn(),
  removeCustomModel: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  getLLMConfig: backend.getLLMConfig,
  testProviderConnection: backend.testProviderConnection,
  upsertProviderSettings: backend.upsertProviderSettings,
  deleteProviderSettings: backend.deleteProviderSettings,
  setActiveModel: modelAPI.setActiveModel,
  listProviderModels: modelAPI.listProviderModels,
  addCustomModel: modelAPI.addCustomModel,
  removeCustomModel: modelAPI.removeCustomModel,
}));

import { LLMSettingsPage } from "./LLMSettingsPage";
import { I18nProvider } from "../../shared/i18n/i18n";

function render(ui: ReactNode) {
  return renderBase(ui, {
    wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider>,
  });
}

const openRouterDescriptor = {
  id: "openrouter",
  displayName: "OpenRouter",
  authKind: "bearer" as const,
  defaultBaseUrl: "https://openrouter.ai/api/v1/chat/completions",
  optionSchema: [],
  capabilities: { streaming: true, tools: false, images: false },
};

const openAIDescriptor = {
  id: "openai",
  displayName: "OpenAI",
  authKind: "bearer" as const,
  optionSchema: [],
  capabilities: { streaming: true, tools: false, images: false },
};

const anthropicDescriptor = {
  id: "anthropic",
  displayName: "Anthropic",
  authKind: "x-api-key" as const,
  optionSchema: [],
  capabilities: { streaming: true, tools: false, images: false },
};

const googleDescriptor = {
  id: "google",
  displayName: "Google",
  authKind: "x-api-key" as const,
  optionSchema: [],
  capabilities: { streaming: true, tools: false, images: false },
};

const ollamaDescriptor = {
  id: "ollama",
  displayName: "Ollama",
  authKind: "none" as const,
  defaultBaseUrl: "http://localhost:11434/v1",
  optionSchema: [],
  capabilities: { streaming: true, tools: false, images: false },
};

const customDescriptor = {
  id: "openai_compatible",
  displayName: "OpenAI-compatible",
  authKind: "bearer" as const,
  optionSchema: [
    { key: "base_url", label: "Base URL", type: "url" as const, required: true },
    {
      key: "requires_api_key",
      label: "API keyが必要",
      type: "bool" as const,
      required: false,
      default: true,
    },
    { key: "headers", label: "Custom headers", type: "headers" as const, required: false },
  ],
  capabilities: { streaming: true, tools: false, images: false },
};

function configuredConfig(
  overrides: { hasApiKey?: boolean; configured?: boolean; model?: string } = {},
) {
  const hasApiKey = overrides.hasApiKey ?? true;
  const configured = overrides.configured ?? hasApiKey;
  const model = overrides.model ?? "provider/original";
  return {
    activeProviderId: configured ? "openrouter" : "",
    activeModelRef: configured ? { providerId: "openrouter", modelId: model } : undefined,
    providers: [
      {
        providerId: "openrouter",
        model,
        models: [],
        options: {},
        hasApiKey,
        configured,
        isActive: configured,
      },
    ],
    catalog: [openRouterDescriptor],
    recentProviderIds: configured ? ["openrouter"] : [],
    recentModels: configured ? [{ providerId: "openrouter", modelId: model }] : [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.getLLMConfig.mockResolvedValue(configuredConfig());
  backend.testProviderConnection.mockResolvedValue({ providerId: "openrouter", ok: true });
  backend.upsertProviderSettings.mockResolvedValue(configuredConfig({ model: "provider/next" }));
  backend.deleteProviderSettings.mockResolvedValue(configuredConfig());
});

describe("LLMSettingsPage", () => {
  it("selects and saves the appearance independently from LLM settings", async () => {
    const onThemeChange = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <LLMSettingsPage onBack={vi.fn()} theme="system" onThemeChange={onThemeChange} />,
    );

    expect(
      (await screen.findByRole("button", { name: /システム/ })).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /ダーク/ }));
    await waitFor(() => expect(onThemeChange).toHaveBeenCalledWith("dark"));

    rerender(<LLMSettingsPage onBack={vi.fn()} theme="dark" onThemeChange={onThemeChange} />);
    expect(screen.getByRole("button", { name: /ダーク/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("keeps a configured built-in provider API key-only", async () => {
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const row = within(list).getAllByRole("listitem")[0]!;
    expect(row.querySelector(".provider-row-detail")).toBeNull();
    expect(within(row).getByText(/現在のmodel|設定済み/)).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: /OpenRouter/ }));
    expect(row.querySelector(".provider-row-detail")).toBeTruthy();
    expect(within(row).getByLabelText("API key")).toBeTruthy();
    expect(within(row).getByRole("button", { name: "保存済みAPI keyを削除" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "接続をテスト" })).toBeTruthy();
    expect(within(row).getByRole("button", { name: "設定を保存" })).toBeTruthy();

    expect(screen.getByRole("heading", { name: "LLM Providers", level: 2 })).toBeTruthy();
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(modelAPI.listProviderModels).not.toHaveBeenCalled();
    expect(modelAPI.setActiveModel).not.toHaveBeenCalled();
    expect(modelAPI.addCustomModel).not.toHaveBeenCalled();
    expect(modelAPI.removeCustomModel).not.toHaveBeenCalled();
  });

  it("stores a new built-in API key from the expanded panel", async () => {
    backend.getLLMConfig.mockResolvedValue(
      configuredConfig({ hasApiKey: false, configured: false }),
    );
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    fireEvent.click(within(list).getByRole("button", { name: /OpenRouter/ }));
    const keyInput = within(list).getByLabelText("API key");
    fireEvent.change(keyInput, { target: { value: "new-secret" } });
    fireEvent.click(within(list).getByRole("button", { name: "API keyを表示" }));
    expect(keyInput).toHaveProperty("type", "text");
    fireEvent.click(within(list).getByRole("button", { name: "設定を保存" }));

    await waitFor(() =>
      expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
        providerId: "openrouter",
        options: {},
        apiKey: "new-secret",
        clearApiKey: false,
      }),
    );
  });

  it("removes a stored built-in API key from the expanded panel", async () => {
    backend.upsertProviderSettings.mockResolvedValue(
      configuredConfig({ hasApiKey: false, configured: false }),
    );
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    fireEvent.click(within(list).getByRole("button", { name: /OpenRouter/ }));
    fireEvent.click(within(list).getByRole("button", { name: "保存済みAPI keyを削除" }));
    fireEvent.click(within(list).getByRole("button", { name: "設定を保存" }));

    await waitFor(() =>
      expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
        providerId: "openrouter",
        options: {},
        apiKey: "",
        clearApiKey: true,
      }),
    );
  });

  it("offers a retry when settings cannot be loaded", async () => {
    backend.getLLMConfig.mockRejectedValueOnce(new Error("credential unavailable"));
    render(<LLMSettingsPage onBack={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("credential unavailable"),
    );
    backend.getLLMConfig.mockResolvedValue(configuredConfig());
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalledTimes(2));
  });

  it("tests a saved built-in provider from the expanded panel", async () => {
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    fireEvent.click(within(list).getByRole("button", { name: /OpenRouter/ }));
    fireEvent.click(within(list).getByRole("button", { name: "接続をテスト" }));

    await waitFor(() => expect(backend.testProviderConnection).toHaveBeenCalledWith("openrouter"));
    expect((await screen.findAllByText(/OpenRouterへの接続に成功しました。/))[0]).toBeTruthy();
  });

  it("localizes provider-specific connection errors", async () => {
    backend.testProviderConnection.mockResolvedValue({
      providerId: "openrouter",
      ok: false,
      error: "OpenAI API keyを確認してください。",
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    fireEvent.click(within(list).getByRole("button", { name: /OpenRouter/ }));
    fireEvent.click(within(list).getByRole("button", { name: "接続をテスト" }));

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "OpenAIのAPI keyを確認してください。",
    );
  });

  it("does not preselect a catalog provider when nothing is configured", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [openRouterDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalled());
    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const openRouterRow = within(list).getAllByRole("listitem")[0]!;
    expect(openRouterRow.textContent).toContain("OpenRouter");
    expect(openRouterRow.getAttribute("class")).not.toContain("is-expanded");
    expect(openRouterRow.querySelector(".provider-row-detail")).toBeNull();
    expect(within(openRouterRow).queryByLabelText("API key")).toBeNull();
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(screen.queryByRole("button", { name: "設定を保存" })).toBeNull();
  });

  it("does not render implementation option fields for any built-in provider", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [
        openRouterDescriptor,
        openAIDescriptor,
        anthropicDescriptor,
        googleDescriptor,
        ollamaDescriptor,
      ],
      recentProviderIds: [],
      recentModels: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    for (const name of ["OpenRouter", "OpenAI", "Anthropic", "Google"]) {
      const row = within(list)
        .getAllByRole("listitem")
        .find((item) => item.querySelector(".provider-row-name")?.textContent === name)!;
      fireEvent.click(within(row).getByRole("button", { name: new RegExp(name) }));
      expect(within(row).getByLabelText("API key")).toBeTruthy();
      fireEvent.click(within(row).getByRole("button", { name: new RegExp(name) }));
    }
    for (const label of [
      "Base URL",
      "Anthropic version",
      "API version",
      "Authentication mode",
      "API key送信方式",
      "Organization",
      "Organization ID",
      "Zero Data Retention",
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    const ollamaRow = within(list)
      .getAllByRole("listitem")
      .find((row) => row.querySelector(".provider-row-name")?.textContent === "Ollama")!;
    expect(within(ollamaRow).getByText("Endpoint: http://localhost:11434/v1")).toBeTruthy();
    fireEvent.click(within(ollamaRow).getByRole("button", { name: /Ollama/ }));
    expect(within(ollamaRow).queryByRole("textbox")).toBeNull();
    expect(within(ollamaRow).getByRole("button", { name: "接続をテスト" })).toBeTruthy();
  });

  it("allows an OpenAI-compatible endpoint that does not require an API key", async () => {
    const customConfig = {
      activeProviderId: "openai_compatible:local",
      activeModelRef: { providerId: "openai_compatible:local", modelId: "local-model" },
      providers: [
        {
          providerId: "openai_compatible:local",
          displayLabel: "Local",
          model: "local-model",
          models: ["local-model"],
          options: {
            base_url: "http://localhost:8080/v1",
            requires_api_key: false,
            headers: {},
          },
          hasApiKey: false,
          configured: true,
          isActive: true,
        },
      ],
      catalog: [customDescriptor],
      recentProviderIds: ["openai_compatible:local"],
      recentModels: [{ providerId: "openai_compatible:local", modelId: "local-model" }],
    };
    backend.getLLMConfig.mockResolvedValue(customConfig);
    backend.upsertProviderSettings.mockResolvedValue(customConfig);
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Local/ }));
    expect(screen.getByDisplayValue("Local")).toBeTruthy();
    expect(screen.getByDisplayValue("http://localhost:8080/v1")).toBeTruthy();
    expect(screen.queryByText("local-model")).toBeNull();
    expect(screen.queryByLabelText("API key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() =>
      expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
        providerId: "openai_compatible:local",
        displayLabel: "Local",
        options: {
          base_url: "http://localhost:8080/v1",
          requires_api_key: false,
          headers: {},
        },
        apiKey: "",
        clearApiKey: false,
      }),
    );
  });

  it("sorts configured providers first, with custom providers at the end of the configured group", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "openai",
      activeModelRef: { providerId: "openai", modelId: "gpt-5" },
      providers: [
        {
          providerId: "openai",
          model: "gpt-5",
          models: [],
          options: {},
          hasApiKey: true,
          configured: true,
          isActive: true,
        },
        {
          providerId: "openai_compatible:groq",
          displayLabel: "Groq",
          model: "llama-3.3-70b",
          models: ["llama-3.3-70b"],
          options: {
            base_url: "https://api.groq.com/openai/v1",
            requires_api_key: true,
            headers: {},
          },
          hasApiKey: true,
          configured: true,
          isActive: false,
        },
      ],
      catalog: [openAIDescriptor, openRouterDescriptor, customDescriptor],
      recentProviderIds: ["openai"],
      recentModels: [{ providerId: "openai", modelId: "gpt-5" }],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const rows = Array.from(list.querySelectorAll(":scope > .provider-row"));
    const names = rows.map((row) => row.querySelector(".provider-row-name")!.textContent);
    expect(names).toEqual(["OpenAI", "Groq", "OpenRouter"]);
  });

  it("persists and tests Ollama using its built-in local endpoint", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [ollamaDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    const ollamaConfig = {
      activeProviderId: "",
      providers: [
        {
          providerId: "ollama",
          model: "llama3",
          models: [],
          options: {},
          hasApiKey: false,
          configured: true,
          isActive: false,
        },
      ],
      catalog: [ollamaDescriptor],
      recentProviderIds: [],
      recentModels: [],
    };
    backend.upsertProviderSettings.mockResolvedValue(ollamaConfig);
    backend.testProviderConnection.mockResolvedValue({ providerId: "ollama", ok: true });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Ollama/ }));
    fireEvent.click(screen.getByRole("button", { name: "接続をテスト" }));
    await waitFor(() =>
      expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
        providerId: "ollama",
        options: {},
        apiKey: "",
        clearApiKey: false,
      }),
    );
    await waitFor(() => expect(backend.testProviderConnection).toHaveBeenCalledWith("ollama"));
    expect(await screen.findByText("Ollamaへの接続に成功しました。")).toBeTruthy();
  });

  it("saves an API key from the expanded provider row", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [openRouterDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    backend.upsertProviderSettings.mockResolvedValue({
      activeProviderId: "",
      providers: [
        {
          providerId: "openrouter",
          model: "",
          models: [],
          options: {},
          hasApiKey: true,
          configured: false,
          isActive: false,
        },
      ],
      catalog: [openRouterDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    fireEvent.click(within(list).getByRole("button", { name: /OpenRouter/ }));
    fireEvent.change(within(list).getByLabelText("API key"), { target: { value: "sk-or-fresh" } });
    fireEvent.click(within(list).getByRole("button", { name: "設定を保存" }));

    await waitFor(() =>
      expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
        providerId: "openrouter",
        options: {},
        apiKey: "sk-or-fresh",
        clearApiKey: false,
      }),
    );
  });

  it("opens a modal to add a compatible provider and stages a new row", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [openRouterDescriptor, customDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: /互換providerを追加|OpenAI互換providerを追加/ }),
    );
    const dialog = await screen.findByRole("dialog", { name: "OpenAI互換endpointを追加" });
    fireEvent.change(within(dialog).getByLabelText("Slug"), { target: { value: "groq" } });
    fireEvent.change(within(dialog).getByLabelText("表示名"), { target: { value: "Groq" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "次へ" }));

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const customRow = within(list)
      .getAllByRole("listitem")
      .find((row) => row.querySelector(".provider-row-name")?.textContent === "Groq");
    expect(customRow).toBeTruthy();
    expect(customRow!.getAttribute("class")).toContain("is-expanded");
  });

  it("shows an env override badge when the backend reports credentialSource=env", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "openai",
      activeModelRef: { providerId: "openai", modelId: "gpt-5" },
      providers: [
        {
          providerId: "openai",
          model: "gpt-5",
          models: [],
          options: {},
          hasApiKey: true,
          configured: true,
          isActive: true,
          credentialSource: "env",
        },
      ],
      catalog: [openAIDescriptor],
      recentProviderIds: ["openai"],
      recentModels: [{ providerId: "openai", modelId: "gpt-5" }],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    // The summary row shows a small env badge so the user notices that the
    // active key is coming from outside the keyring.
    const badge = await screen.findByText("env上書き中");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("title")).toContain("GLINT_OPENAI_API_KEY");

    // Expanding the row reveals an env note explaining the override and a
    // working test-connection button.
    const list = screen.getByRole("list", { name: "Model provider一覧" });
    const openAIRow = within(list)
      .getAllByRole("listitem")
      .find((row) => row.querySelector(".provider-row-name")?.textContent === "OpenAI")!;
    fireEvent.click(within(openAIRow).getByRole("button", { name: /OpenAI/ }));
    expect(screen.getByText(/GLINT_OPENAI_API_KEY/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "接続をテスト" })).toBeTruthy();
  });

  it("keeps custom provider removal in the expanded panel", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      activeModelRef: undefined,
      providers: [
        {
          providerId: "openai_compatible:local",
          displayLabel: "Local",
          model: "",
          models: [],
          options: { base_url: "http://localhost:8080/v1", requires_api_key: false, headers: {} },
          hasApiKey: false,
          configured: false,
          isActive: false,
        },
      ],
      catalog: [customDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    backend.deleteProviderSettings.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [customDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /Local/ }));
    const removeButton = await screen.findByRole("button", { name: "providerを削除" });
    expect(removeButton.closest(".provider-row-detail-actions")).toBeTruthy();
    fireEvent.click(removeButton);

    await waitFor(() =>
      expect(backend.deleteProviderSettings).toHaveBeenCalledWith("openai_compatible:local"),
    );
  });
});
