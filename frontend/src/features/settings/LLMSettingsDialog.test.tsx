import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  saveLLMSettings: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  saveLLMSettings: backend.saveLLMSettings,
}));

import { LLMSettingsDialog } from "./LLMSettingsDialog";

const configuredSettings = {
  provider: "openrouter" as const,
  model: "provider/original",
  zdr: true,
  hasApiKey: true,
  configured: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  backend.saveLLMSettings.mockResolvedValue(configuredSettings);
});

describe("LLMSettingsDialog", () => {
  it("edits model settings while preserving an existing credential", async () => {
    const onSaved = vi.fn();
    render(
      <LLMSettingsDialog settings={configuredSettings} onSaved={onSaved} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "LLM接続設定を開く" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    const modelInput = screen.getByLabelText("Model");
    const keyInput = screen.getByLabelText(/API key/);
    expect(modelInput).toHaveProperty("value", "provider/original");
    expect(keyInput).toHaveProperty("placeholder", "変更する場合のみ入力");

    fireEvent.change(modelInput, { target: { value: "provider/next" } });
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(backend.saveLLMSettings).toHaveBeenCalledWith({
      model: "provider/next",
      apiKey: "",
      zdr: true,
      clearApiKey: false,
    }));
    expect(onSaved).toHaveBeenCalledWith(configuredSettings);
  });

  it("can replace the API key and disable ZDR explicitly", async () => {
    render(
      <LLMSettingsDialog
        settings={{ ...configuredSettings, hasApiKey: false, configured: false }}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "LLM接続設定を開く" }));
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("switch", { name: "Zero Data Retentionを必須にする" }));
    fireEvent.click(screen.getByRole("button", { name: "設定を保存" }));

    await waitFor(() => expect(backend.saveLLMSettings).toHaveBeenCalledWith({
      model: "provider/original",
      apiKey: "new-secret",
      zdr: false,
      clearApiKey: false,
    }));
  });
});
