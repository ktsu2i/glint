import { beforeEach, describe, expect, it, vi } from "vitest";

const bindings = vi.hoisted(() => ({
  getAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
  getLanguageSettings: vi.fn(),
  saveLanguageSettings: vi.fn(),
}));

vi.mock("../../../bindings/github.com/ktsu2i/glint/internal/app/settingsservice", () => ({
  GetAppearanceSettings: bindings.getAppearanceSettings,
  SaveAppearanceSettings: bindings.saveAppearanceSettings,
  GetLanguageSettings: bindings.getLanguageSettings,
  SaveLanguageSettings: bindings.saveLanguageSettings,
}));

import {
  getAppearanceSettings,
  getLanguageSettings,
  saveAppearanceSettings,
  saveLanguageSettings,
} from "./settings";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("settings api", () => {
  it("delegates appearance settings through a typed theme contract", async () => {
    bindings.getAppearanceSettings.mockResolvedValue({ theme: "dark" });
    bindings.saveAppearanceSettings.mockResolvedValue({ theme: "system" });

    await expect(getAppearanceSettings()).resolves.toEqual({ theme: "dark" });
    await expect(saveAppearanceSettings("system")).resolves.toEqual({ theme: "system" });
    expect(bindings.saveAppearanceSettings).toHaveBeenCalledWith({ theme: "system" });
  });

  it("delegates language settings through a typed language contract", async () => {
    bindings.getLanguageSettings.mockResolvedValue({ language: "ja" });
    bindings.saveLanguageSettings.mockResolvedValue({ language: "en" });

    await expect(getLanguageSettings()).resolves.toEqual({ language: "ja" });
    await expect(saveLanguageSettings("en")).resolves.toEqual({ language: "en" });
    expect(bindings.saveLanguageSettings).toHaveBeenCalledWith({ language: "en" });
  });
});
