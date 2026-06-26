import { fireEvent, render as renderBase, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  testProviderConnection: vi.fn(),
  upsertProviderSettings: vi.fn(),
  setActiveProvider: vi.fn(),
  deleteProviderSettings: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  getLLMConfig: backend.getLLMConfig,
  testProviderConnection: backend.testProviderConnection,
  upsertProviderSettings: backend.upsertProviderSettings,
  setActiveProvider: backend.setActiveProvider,
  deleteProviderSettings: backend.deleteProviderSettings,
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
  return {
    activeProviderId: configured ? "openrouter" : "",
    providers: [{
      providerId: "openrouter",
      model: overrides.model ?? "provider/original",
      options: { zdr: overrides.zdr ?? true },
      hasApiKey,
      configured,
      isActive: configured,
    }],
    catalog: [openRouterDescriptor],
    recentProviderIds: configured ? ["openrouter"] : [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.getLLMConfig.mockResolvedValue(configuredConfig());
  backend.testProviderConnection.mockResolvedValue({ providerId: "openrouter", ok: true });
  backend.upsertProviderSettings.mockResolvedValue(configuredConfig({ model: "provider/next" }));
  backend.setActiveProvider.mockResolvedValue(configuredConfig());
  backend.deleteProviderSettings.mockResolvedValue(configuredConfig());
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

  it("auto-opens the active provider's Manage panel and saves a model edit", async () => {
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const modelInput = await screen.findByLabelText("Model ID");
    const keyInput = screen.getByLabelText("API key");
    expect(modelInput).toHaveProperty("value", "provider/original");
    expect(keyInput).toHaveProperty("value", "");
    expect(keyInput).toHaveProperty("placeholder", "••••••••••••••••");
    expect(screen.getByText("保存済みです。実際の値は読み戻さず、マスク表示しています。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "API keyを表示" })).toHaveProperty("disabled", true);
    expect(screen.getByText("OS credential storeに保存済み")).toBeTruthy();

    fireEvent.change(modelInput, { target: { value: " provider/next " } });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
      providerId: "openrouter",
      model: "provider/next",
      options: { zdr: true },
      apiKey: "",
      clearApiKey: false,
      activate: false,
    }));
    expect((await screen.findAllByText(/設定を保存しました。/))[0]).toBeTruthy();
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
      model: "provider/original",
      options: { zdr: false },
      apiKey: "new-secret",
      clearApiKey: false,
      activate: false,
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
      model: "provider/original",
      options: { zdr: true },
      apiKey: "",
      clearApiKey: true,
      activate: false,
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
    expect(await screen.findByDisplayValue("provider/original")).toBeTruthy();
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
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalled());
    // OpenRouter row is rendered but is NOT expanded — no Save button, no Model
    // ID field, and the row's Manage button is collapsed.
    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const openRouterRow = within(list).getAllByRole("listitem")[0]!;
    expect(openRouterRow.textContent).toContain("OpenRouter");
    expect(openRouterRow.getAttribute("class")).not.toContain("is-expanded");
    expect(within(openRouterRow).getByRole("button", { name: /^詳細/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("Model ID")).toBeNull();
    expect(screen.queryByRole("button", { name: "設定を保存" })).toBeNull();
    expect(screen.queryByRole("button", { name: "現在のmodelとして使う" })).toBeNull();
  });

  it("activates a configured provider through a dedicated action without touching save", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [{
        providerId: "openrouter",
        model: "provider/original",
        options: { zdr: true },
        hasApiKey: true,
        configured: true,
        isActive: false,
      }],
      catalog: [openRouterDescriptor],
      recentProviderIds: [],
    });
    backend.setActiveProvider.mockResolvedValue(configuredConfig());
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const activateButton = await screen.findByRole("button", { name: "現在のmodelとして使う" });
    fireEvent.click(activateButton);

    await waitFor(() => expect(backend.setActiveProvider).toHaveBeenCalledWith("openrouter"));
    expect(backend.upsertProviderSettings).not.toHaveBeenCalled();
  });

  it("allows an OpenAI-compatible endpoint that does not require an API key", async () => {
    const customConfig = {
      activeProviderId: "openai_compatible:local",
      providers: [{
        providerId: "openai_compatible:local",
        displayLabel: "Local",
        model: "local-model",
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
    };
    backend.getLLMConfig.mockResolvedValue(customConfig);
    backend.upsertProviderSettings.mockResolvedValue(customConfig);
    render(<LLMSettingsPage onBack={vi.fn()} />);

    expect(await screen.findByDisplayValue("local-model")).toBeTruthy();
    expect(screen.queryByLabelText("API key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
      providerId: "openai_compatible:local",
      displayLabel: "Local",
      model: "local-model",
      options: {
        base_url: "http://localhost:8080/v1",
        requires_api_key: false,
        headers: {},
      },
      apiKey: "",
      clearApiKey: false,
      activate: false,
    }));
  });

  // --- F9-specific behavior --------------------------------------------------

  it("sorts configured providers first, with custom providers at the end of the configured group", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "openai",
      providers: [
        {
          providerId: "openai",
          model: "gpt-5",
          options: { organization: "", base_url: "" },
          hasApiKey: true,
          configured: true,
          isActive: true,
        },
        {
          providerId: "openai_compatible:groq",
          displayLabel: "Groq",
          model: "llama-3.3-70b",
          options: { base_url: "https://api.groq.com/openai/v1", requires_api_key: true, headers: {} },
          hasApiKey: true,
          configured: true,
          isActive: false,
        },
      ],
      catalog: [openAIDescriptor, openRouterDescriptor, customDescriptor],
      recentProviderIds: ["openai"],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const rows = within(list).getAllByRole("listitem");
    const names = rows.map((row) => row.querySelector(".provider-row-name")!.textContent);
    expect(names).toEqual(["OpenAI", "Groq", "OpenRouter"]);
  });

  it("hides the ZDR control unless the OpenRouter Manage panel is open", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "openai",
      providers: [{
        providerId: "openai",
        model: "gpt-5",
        options: { organization: "", base_url: "" },
        hasApiKey: true,
        configured: true,
        isActive: true,
      }],
      catalog: [openAIDescriptor, openRouterDescriptor],
      recentProviderIds: ["openai"],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    await screen.findByDisplayValue("gpt-5");
    // ZDR is OpenRouter-only; while the OpenAI Manage panel is open, the ZDR
    // switch must not be visible.
    expect(screen.queryByRole("switch", { name: "Zero Data Retentionを必須にする" })).toBeNull();

    // Open the OpenRouter Manage panel; the ZDR switch should then appear.
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
    });
    backend.upsertProviderSettings.mockResolvedValue({
      activeProviderId: "",
      providers: [{
        providerId: "openrouter",
        model: "",
        options: { zdr: true },
        hasApiKey: true,
        configured: false,
        isActive: false,
      }],
      catalog: [openRouterDescriptor],
      recentProviderIds: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const inlineInput = within(list).getByLabelText("OpenRouterのAPI key");
    fireEvent.change(inlineInput, { target: { value: "sk-or-fresh" } });
    fireEvent.click(within(list).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(backend.upsertProviderSettings).toHaveBeenCalledWith({
      providerId: "openrouter",
      model: "",
      options: { zdr: true },
      apiKey: "sk-or-fresh",
      clearApiKey: false,
      activate: false,
    }));
  });

  it("opens a modal to add a compatible provider and stages a new row", async () => {
    backend.getLLMConfig.mockResolvedValue({
      activeProviderId: "",
      providers: [],
      catalog: [openRouterDescriptor, customDescriptor],
      recentProviderIds: [],
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: /互換providerを追加|OpenAI互換providerを追加/ }));
    const dialog = await screen.findByRole("dialog", { name: "OpenAI互換endpointを追加" });
    fireEvent.change(within(dialog).getByLabelText("Slug"), { target: { value: "groq" } });
    fireEvent.change(within(dialog).getByLabelText("表示名"), { target: { value: "Groq" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "次へ" }));

    // The staged custom row appears in the list and is expanded for editing.
    const list = await screen.findByRole("list", { name: "Model provider一覧" });
    const customRow = within(list).getAllByRole("listitem").find((row) =>
      row.querySelector(".provider-row-name")?.textContent === "Groq",
    );
    expect(customRow).toBeTruthy();
    expect(customRow!.getAttribute("class")).toContain("is-expanded");
  });
});
