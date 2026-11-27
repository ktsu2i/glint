import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  getAppearanceSettings: vi.fn(),
  saveAppearanceSettings: vi.fn(),
  getLanguageSettings: vi.fn(),
  saveLanguageSettings: vi.fn(),
}));
const settingsEvents = vi.hoisted(() => ({
  appearance: [] as Array<(theme: string) => void>,
}));

vi.mock("../../shared/api/settings", () => backend);
vi.mock("../../shared/api/events", () => ({
  onAppearanceChanged: (callback: (theme: string) => void) => {
    settingsEvents.appearance.push(callback);
    return () => {};
  },
  onLanguageChanged: () => () => {},
}));

import { SettingsWindowApp } from "./SettingsWindow";

beforeEach(() => {
  vi.clearAllMocks();
  settingsEvents.appearance = [];
  delete document.documentElement.dataset.theme;
  backend.getAppearanceSettings.mockResolvedValue({ theme: "dark" });
  backend.saveAppearanceSettings.mockImplementation(async (theme: string) => ({ theme }));
  backend.getLanguageSettings.mockResolvedValue({ language: "ja" });
  backend.saveLanguageSettings.mockImplementation(async (language: string) => ({ language }));
});

describe("SettingsWindow", () => {
  it("restores, applies, and saves the theme", async () => {
    render(<SettingsWindowApp />);

    const dark = await screen.findByRole("button", { name: /ダーク/ });
    await waitFor(() => expect(dark.getAttribute("aria-pressed")).toBe("true"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("heading", { name: "表示", level: 1 })).toBeTruthy();
    expect(screen.queryByText(/API key/i)).toBeNull();

    const light = screen.getByRole("button", { name: /ライト/ });
    await waitFor(() => expect(light).toHaveProperty("disabled", false));
    fireEvent.click(light);
    await waitFor(() => expect(backend.saveAppearanceSettings).toHaveBeenCalledWith("light"));
    await waitFor(() => expect(light.getAttribute("aria-pressed")).toBe("true"));
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("rolls back the theme when saving fails", async () => {
    backend.saveAppearanceSettings.mockRejectedValue(new Error("settings unavailable"));
    render(<SettingsWindowApp />);

    const light = await screen.findByRole("button", { name: /ライト/ });
    await waitFor(() => expect(light).toHaveProperty("disabled", false));
    fireEvent.click(light);

    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "settings unavailable");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("button", { name: /ダーク/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("follows a theme saved elsewhere", async () => {
    render(<SettingsWindowApp />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));

    act(() => settingsEvents.appearance.forEach((callback) => callback("system")));
    expect(screen.getByRole("button", { name: /システム/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("switches to the language tab and saves the interface language", async () => {
    render(<SettingsWindowApp />);
    await screen.findByRole("button", { name: /ダーク/ });

    fireEvent.click(screen.getByRole("tab", { name: "言語" }));
    expect(screen.getByRole("tab", { name: "言語" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("heading", { name: "言語", level: 1 })).toBeTruthy();
    const english = screen.getByRole("button", { name: /English/ });
    await waitFor(() => expect(english).toHaveProperty("disabled", false));
    fireEvent.click(english);

    await waitFor(() => expect(backend.saveLanguageSettings).toHaveBeenCalledWith("en"));
    expect(await screen.findByRole("heading", { name: "Language", level: 1 })).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps the previous language when saving fails", async () => {
    backend.saveLanguageSettings.mockRejectedValue(new Error("language storage unavailable"));
    render(<SettingsWindowApp />);
    await screen.findByRole("button", { name: /ダーク/ });

    fireEvent.click(screen.getByRole("tab", { name: "言語" }));
    const english = screen.getByRole("button", { name: /English/ });
    await waitFor(() => expect(english).toHaveProperty("disabled", false));
    fireEvent.click(english);

    expect(await screen.findByText("language storage unavailable")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "言語", level: 1 })).toBeTruthy();
    expect(document.documentElement.lang).toBe("ja");
  });
});
