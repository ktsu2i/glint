import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getLLMSettings: vi.fn(),
  saveLLMSettings: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  getLLMSettings: backend.getLLMSettings,
  saveLLMSettings: backend.saveLLMSettings,
}));

import { LLMSettingsPage } from "./LLMSettingsPage";

const configuredSettings = {
  provider: "openrouter" as const,
  model: "provider/original",
  zdr: true,
  hasApiKey: true,
  configured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  backend.getLLMSettings.mockResolvedValue(configuredSettings);
  backend.saveLLMSettings.mockResolvedValue({
    ...configuredSettings,
    model: "provider/next",
  });
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

    await waitFor(() => expect(backend.saveLLMSettings).toHaveBeenCalledWith({
      model: "provider/next",
      apiKey: "",
      zdr: true,
      clearApiKey: false,
    }));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      expect.stringContaining("設定を保存しました。"),
    );
  });

  it("stores a new API key, toggles its visibility, and updates privacy settings", async () => {
    backend.getLLMSettings.mockResolvedValue({
      ...configuredSettings,
      hasApiKey: false,
      configured: false,
    });
    render(<LLMSettingsPage onBack={vi.fn()} />);

    const keyInput = await screen.findByLabelText("API key");
    fireEvent.change(keyInput, { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "API keyを表示" }));
    expect(keyInput).toHaveProperty("type", "text");
    fireEvent.click(screen.getByRole("switch", { name: "Zero Data Retentionを必須にする" }));
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(backend.saveLLMSettings).toHaveBeenCalledWith({
      model: "provider/original",
      apiKey: "new-secret",
      zdr: false,
      clearApiKey: false,
    }));
  });

  it("can remove a stored API key and return to the previous screen", async () => {
    backend.saveLLMSettings.mockResolvedValue({
      ...configuredSettings,
      hasApiKey: false,
      configured: false,
    });
    const onBack = vi.fn();
    render(<LLMSettingsPage onBack={onBack} />);

    fireEvent.click(await screen.findByRole("button", { name: "保存済みAPI keyを削除" }));
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));
    await waitFor(() => expect(backend.saveLLMSettings).toHaveBeenCalledWith({
      model: "provider/original",
      apiKey: "",
      zdr: true,
      clearApiKey: true,
    }));

    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("offers a retry when settings cannot be loaded", async () => {
    backend.getLLMSettings.mockRejectedValueOnce(new Error("credential unavailable"));
    render(<LLMSettingsPage onBack={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("credential unavailable"),
    );
    backend.getLLMSettings.mockResolvedValue(configuredSettings);
    fireEvent.click(screen.getByRole("button", { name: "再読み込み" }));
    expect(await screen.findByDisplayValue("provider/original")).toBeTruthy();
  });
});
