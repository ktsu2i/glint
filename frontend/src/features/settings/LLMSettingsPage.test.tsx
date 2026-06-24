import { fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  upsertProviderSettings: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  getLLMConfig: backend.getLLMConfig,
  upsertProviderSettings: backend.upsertProviderSettings,
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
  backend.upsertProviderSettings.mockResolvedValue(configuredConfig({ model: "provider/next" }));
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
      activate: true,
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
      activate: true,
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
      activate: true,
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
});
