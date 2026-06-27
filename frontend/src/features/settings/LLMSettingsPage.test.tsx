import { fireEvent, render as renderBase, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  testProviderConnection: vi.fn(),
  upsertProviderSettings: vi.fn(),
  setActiveModel: vi.fn(),
  deleteProviderSettings: vi.fn(),
  listProviderModels: vi.fn(),
  addCustomModel: vi.fn(),
  removeCustomModel: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  getLLMConfig: backend.getLLMConfig,
  testProviderConnection: backend.testProviderConnection,
  upsertProviderSettings: backend.upsertProviderSettings,
  setActiveModel: backend.setActiveModel,
  deleteProviderSettings: backend.deleteProviderSettings,
  listProviderModels: backend.listProviderModels,
  addCustomModel: backend.addCustomModel,
  removeCustomModel: backend.removeCustomModel,
}));

import { LLMSettingsPage } from "./LLMSettingsPage";
import { I18nProvider } from "../../shared/i18n/i18n";

function render(ui: ReactNode) {
  return renderBase(ui, { wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider> });
}

const openRouterDescriptor = {
  id: "openrouter",
  displayName: "OpenRouter",
  authKind: "bearer" as const,
  defaultBaseUrl: "https://openrouter.ai/api/v1/chat/completions",
  optionSchema: [{
    key: "zdr",
    label: "Zero Data Retention",
    type: "bool" as const,
    required: false,
    default: true,
    helpText: "データを保持しないendpointだけにroutingを制限します。",
  }],
  capabilities: { streaming: true, tools: false, images: false },
};

const openAIDescriptor = {
  id: "openai",
  displayName: "OpenAI",
  authKind: "bearer" as const,
  optionSchema: [
    { key: "organization", label: "Organization", type: "string" as const, required: false },
    { key: "base_url", label: "Base URL", type: "url" as const, required: false },
  ],
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

function configuredConfig(overrides: { hasApiKey?: boolean; configured?: boolean; model?: string; zdr?: boolean } = {}) {
  const hasApiKey = overrides.hasApiKey ?? true;
  const configured = overrides.configured ?? hasApiKey;
  const model = overrides.model ?? "provider/original";
  return {
    activeProviderId: configured ? "openrouter" : "",
    activeModelRef: configured ? { providerId: "openrouter", modelId: model } : undefined,
    providers: [{
      providerId: "openrouter",
      model,
      models: [],
      options: { zdr: overrides.zdr ?? true },
      hasApiKey,
      configured,
      isActive: configured,
    }],
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
  backend.setActiveModel.mockResolvedValue(configuredConfig());
  backend.deleteProviderSettings.mockResolvedValue(configuredConfig());
  backend.listProviderModels.mockResolvedValue({
    providerId: "openrouter",
    models: [
      { id: "provider/original", source: "builtin" },
      { id: "anthropic/claude-sonnet-4-6", source: "builtin" },
    ],
    source: "builtin",
  });
  backend.addCustomModel.mockImplementation(async (providerId: string, modelId: string) => ({
    ...configuredConfig(),
    providers: [{
      providerId,
      displayLabel: "Local",
      model: "",
      models: [modelId],
      options: { base_url: "http://localhost:8080/v1", requires_api_key: false, headers: {} },
      hasApiKey: false,
      configured: true,
      isActive: false,
    }],
    catalog: [customDescriptor],
  }));
  backend.removeCustomModel.mockResolvedValue(configuredConfig());
});

describe("LLMSettingsPage", () => {
  it("selects and saves the appearance independently from LLM settings", async () => {
    const onThemeChange = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <LLMSettingsPage onBack={vi.fn()} theme="system" onThemeChange={onThemeChange} />,
    );

    expect((await screen.findByRole("button", { name: /システム/ })).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /ダーク/ }));
    await waitFor(() => expect(onThemeChange).toHaveBeenCalledWith("dark"));

    rerender(<LLMSettingsPage onBack={vi.fn()} theme="dark" onThemeChange={onThemeChange} />);
    expect(screen.getByRole("button", { name: /ダーク/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("auto-opens the active provider's Manage panel and shows the available models from the listing API", async () => {
    render(<LLMSettingsPage onBack={vi.fn()} />);

    // F10: model id input is gone; models come from the listing API.
    // F14: listProviderModels now takes (providerId, force) where force defaults
    // to false on the panel-open lazy fetch.
    await waitFor(() => expect(backend.listProviderModels).toHaveBeenCalledWith("openrouter", { force: false }));
    await screen.findByText("provider/original");
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(screen.getByLabelText("API key")).toBeTruthy();
  });

  it("stores a new API key inside the Manage panel and updates privacy settings", async () => {
    backend.getLLMConfig.mockResolvedValue(configuredConfig({ hasApiKey: false, configured: false }));
    render(<LLMSettingsPage onBack={vi.fn()} />);

    // No Manage panel is open by default when nothing is configured. Click
    // Manage to expand the row.
    const manageButton = await screen.findByRole("button", { name: /^詳細/ });
    fireEvent.click(manageButton);
    const keyInput = await screen.findByLabelText("API key");
    fireEvent.change(keyInput, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "API keyを表示" }));
    expect(keyInput).toHaveProperty("type", "text");
    fireEvent.click(screen.getByRole("switch", { name: "Zero Data Retentionを必須にする" }));
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
      providerId: "openrouter",
      options: { zdr: false },
      apiKey: "new-secret",
      clearApiKey: false,
    }));
  });

  it("can remove a stored API key from inside the Manage panel and return to the previous screen", async () => {
    backend.upsertProviderSettings.mockResolvedValue(configuredConfig({ hasApiKey: false, configured: false }));
    const onBack = vi.fn();
    render(<LLMSettingsPage onBack={onBack} />);

    fireEvent.click(await screen.findByRole("button", { name: "保存済みAPI keyを削除" }));
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
    await waitFor(() => expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
      providerId: "openrouter",
      options: { zdr: true },
      apiKey: "",
      clearApiKey: true,
    }));

    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(onBack).toHaveBeenCalledOnce();
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

  it("tests the saved provider connection from inside the Manage panel and shows success", async () => {
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "接続をテスト" }));

    await waitFor(() => expect(backend.testProviderConnection).toHaveBeenCalledWith("openrouter"));
    expect(
      (await screen.findAllByText(/OpenRouterへの接続に成功しました。/))[0],
    ).toBeTruthy();
  });

  it("localizes provider-specific connection errors", async () => {
    backend.testProviderConnection.mockResolvedValue({
      providerId: "openrouter",
      ok: false,
      error: "OpenAI API keyを確認してください。",
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "接続をテスト" }));

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
    expect(within(openRouterRow).getByRole("button", { name: /^詳細/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(screen.queryByRole("button", { name: "設定を保存" })).toBeNull();
  });

  it("activates a (provider, model) pair from the Available models list", async () => {
    render(<LLMSettingsPage onBack={vi.fn()} />);

    // Listing API populates the panel; pick a different model id and activate it.
    await waitFor(() => expect(backend.listProviderModels).toHaveBeenCalledWith("openrouter", { force: false }));
    const alternateButtons = await screen.findAllByRole("button", { name: /このmodelを使う/ });
    fireEvent.click(alternateButtons[0]);

    await waitFor(() => expect(backend.setActiveModel).toHaveBeenCalled());
    const [providerId, modelId] = backend.setActiveModel.mock.calls[0];
    expect(providerId).toBe("openrouter");
    expect(modelId).toBe("anthropic/claude-sonnet-4-6");
  });

  it("allows an OpenAI-compatible endpoint that does not require an API key", async () => {
    const customConfig = {
      activeProviderId: "openai_compatible:local",
      activeModelRef: { providerId: "openai_compatible:local", modelId: "local-model" },
      providers: [{
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
      }],
      catalog: [customDescriptor],
      recentProviderIds: ["openai_compatible:local"],
      recentModels: [{ providerId: "openai_compatible:local", modelId: "local-model" }],
    };
    backend.getLLMConfig.mockResolvedValue(customConfig);
    backend.upsertProviderSettings.mockResolvedValue(customConfig);
    render(<LLMSettingsPage onBack={vi.fn()} />);

    // Custom providers show their manually-registered models.
    expect(await screen.findByText("local-model")).toBeTruthy();
    expect(screen.queryByLabelText("API key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
      providerId: "openai_compatible:local",
      displayLabel: "Local",
      options: {
        base_url: "http://localhost:8080/v1",
        requires_api_key: false,
        headers: {},
      },
      apiKey: "",
      clearApiKey: false,
    }));
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
          options: { organization: "", base_url: "" },
          hasApiKey: true,
          configured: true,
          isActive: true,
        },
        {
          providerId: "openai_compatible:groq",
          displayLabel: "Groq",
          model: "llama-3.3-70b",
          models: ["llama-3.3-70b"],
          options: { base_url: "https://api.groq.com/openai/v1", requires_api_key: true, headers: {} },
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

  it("hides the ZDR control unless the OpenRouter Manage panel is open", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "openai",
      activeModelRef: { providerId: "openai", modelId: "gpt-5" },
      providers: [{
        providerId: "openai",
        model: "gpt-5",
        models: [],
        options: { organization: "", base_url: "" },
        hasApiKey: true,
        configured: true,
        isActive: true,
      }],
      catalog: [openAIDescriptor, openRouterDescriptor],
      recentProviderIds: ["openai"],
      recentModels: [{ providerId: "openai", modelId: "gpt-5" }],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    await screen.findByText("OpenAI");
    expect(screen.queryByRole("switch", { name: "Zero Data Retentionを必須にする" })).toBeNull();

    const list = screen.getByRole("list", { name: "Model provider一覧" });
    const openRouterRow = within(list).getAllByRole("listitem").find((row) =>
      row.querySelector(".provider-row-name")?.textContent === "OpenRouter",
    )!;
    fireEvent.click(within(openRouterRow).getByRole("button", { name: /^詳細/ }));
    expect(await screen.findByRole("switch", { name: "Zero Data Retentionを必須にする" })).toBeTruthy();
  });

  it("saves an API key inline from the row without entering the Manage panel", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [openRouterDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    backend.upsertProviderSettings.mockResolvedValue({
      activeProviderId: "",
      providers: [{
        providerId: "openrouter",
        model: "",
        models: [],
        options: { zdr: true },
        hasApiKey: true,
        configured: false,
        isActive: false,
      }],
      catalog: [openRouterDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const inlineInput = within(list).getByLabelText("OpenRouterのAPI key");
    fireEvent.change(inlineInput, { target: { value: "sk-or-fresh" } });
    fireEvent.click(within(list).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
      providerId: "openrouter",
      options: { zdr: true },
      apiKey: "sk-or-fresh",
      clearApiKey: false,
    }));
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

    fireEvent.click(await screen.findByRole("button", { name: /互換providerを追加|OpenAI互換providerを追加/ }));
    const dialog = await screen.findByRole("dialog", { name: "OpenAI互換endpointを追加" });
    fireEvent.change(within(dialog).getByLabelText("Slug"), { target: { value: "groq" } });
    fireEvent.change(within(dialog).getByLabelText("表示名"), { target: { value: "Groq" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "次へ" }));

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const customRow = within(list).getAllByRole("listitem").find((row) =>
      row.querySelector(".provider-row-name")?.textContent === "Groq",
    );
    expect(customRow).toBeTruthy();
    expect(customRow!.getAttribute("class")).toContain("is-expanded");
  });

  it("shows an env override badge when the backend reports credentialSource=env", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "openai",
      activeModelRef: { providerId: "openai", modelId: "gpt-5" },
      providers: [{
        providerId: "openai",
        model: "gpt-5",
        models: [],
        options: {},
        hasApiKey: true,
        configured: true,
        isActive: true,
        credentialSource: "env",
      }],
      catalog: [openAIDescriptor],
      recentProviderIds: ["openai"],
      recentModels: [{ providerId: "openai", modelId: "gpt-5" }],
    });
    backend.listProviderModels.mockResolvedValue({
      providerId: "openai",
      models: [{ id: "gpt-5", source: "builtin" }],
      source: "builtin",
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    // The summary row shows a small env badge so the user notices that the
    // active key is coming from outside the keyring.
    const badge = await screen.findByText("env上書き中");
    expect(badge).toBeTruthy();
    expect(badge.getAttribute("title")).toContain("GLINT_OPENAI_API_KEY");

    // The Manage panel surfaces the same env var name in a longer notice so
    // users editing credentials understand the override is active.
    const note = screen.getByText(/API keyを GLINT_OPENAI_API_KEY から/);
    expect(note).toBeTruthy();
  });

  it("adds a manual model to a custom provider via the AddCustomModel API", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      activeModelRef: undefined,
      providers: [{
        providerId: "openai_compatible:local",
        displayLabel: "Local",
        model: "",
        models: [],
        options: { base_url: "http://localhost:8080/v1", requires_api_key: false, headers: {} },
        hasApiKey: false,
        configured: false,
        isActive: false,
      }],
      catalog: [customDescriptor],
      recentProviderIds: [],
      recentModels: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const manageButton = await screen.findByRole("button", { name: /^詳細/ });
    fireEvent.click(manageButton);
    const modelInput = await screen.findByPlaceholderText("model id (例: llama-3.3-70b)");
    fireEvent.change(modelInput, { target: { value: " local-model " } });
    fireEvent.click(screen.getByRole("button", { name: "modelを追加" }));

    await waitFor(() => expect(backend.addCustomModel).toHaveBeenCalledWith(
      "openai_compatible:local",
      "local-model",
    ));
    expect(await screen.findByText("local-model")).toBeTruthy();
  });
});
