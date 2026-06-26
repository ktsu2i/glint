import { fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  testProviderConnection: vi.fn(),
  upsertProviderSettings: vi.fn(),
  setActiveProvider: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  getLLMConfig: backend.getLLMConfig,
  testProviderConnection: backend.testProviderConnection,
  upsertProviderSettings: backend.upsertProviderSettings,
  setActiveProvider: backend.setActiveProvider,
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

function configuredConfig(overrides: { hasApiKey?: boolean; configured?: boolean; model?: string; zdr?: boolean } = {}) {
  const hasApiKey = overrides.hasApiKey ?? true;
  const configured = overrides.configured ?? hasApiKey;
  return {
    activeProviderId: "openrouter",
    providers: [{
      providerId: "openrouter",
      model: overrides.model ?? "provider/original",
      options: { zdr: overrides.zdr ?? true },
      hasApiKey,
      configured,
      isActive: true,
    }],
    catalog: [openRouterDescriptor],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.getLLMConfig.mockResolvedValue(configuredConfig());
  backend.testProviderConnection.mockResolvedValue({ providerId: "openrouter", ok: true });
  backend.upsertProviderSettings.mockResolvedValue(configuredConfig({ model: "provider/next" }));
  backend.setActiveProvider.mockResolvedValue(configuredConfig());
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

  it("loads persisted settings and updates the model without reading the credential", async () => {
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
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("設定を保存しました。"),
    );
  });

  it("stores a new API key, toggles its visibility, and updates privacy settings", async () => {
    backend.getLLMConfig.mockResolvedValue(configuredConfig({ hasApiKey: false, configured: false }));
    render(<LLMSettingsPage onBack={vi.fn()} />);

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

  it("can remove a stored API key and return to the previous screen", async () => {
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

  it("tests the saved provider connection and shows success", async () => {
    render(<LLMSettingsPage onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "接続をテスト" }));

    await waitFor(() => expect(backend.testProviderConnection).toHaveBeenCalledWith("openrouter"));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("OpenRouterへの接続に成功しました。"),
    );
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
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    await waitFor(() => expect(backend.getLLMConfig).toHaveBeenCalled());
    // The OpenRouter pill is rendered in the picker but must NOT be marked as the
    // editing target on first mount — choosing the catalog's first entry as the
    // editing target was the old behavior we are removing in F7.
    const openRouterPill = await screen.findByRole("radio", { name: "OpenRouter" });
    expect(openRouterPill.getAttribute("aria-checked")).toBe("false");
    // Save and Activate stay disabled because nothing is selected for editing.
    expect(screen.getByRole("button", { name: "設定を保存" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "現在のmodelとして使う" })).toHaveProperty("disabled", true);
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
    });
    backend.setActiveProvider.mockResolvedValue(configuredConfig());
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const activateButton = await screen.findByRole("button", { name: "現在のmodelとして使う" });
    fireEvent.click(activateButton);

    await waitFor(() => expect(backend.setActiveProvider).toHaveBeenCalledWith("openrouter"));
    // upsertProviderSettings must NOT be triggered by the activate action; it stays
    // separated from saving credentials/model.
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
      catalog: [{
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
      }],
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
});
