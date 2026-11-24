import { fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "./SettingsPage";
import { I18nProvider } from "../../shared/i18n/i18n";

function render(ui: ReactNode) {
  return renderBase(ui, {
    wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider>,
  });
}

describe("SettingsPage", () => {
  it("selects and saves the appearance", async () => {
    const onThemeChange = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <SettingsPage onBack={vi.fn()} theme="system" onThemeChange={onThemeChange} />,
    );

    expect(
      (await screen.findByRole("button", { name: /システム/ })).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /ダーク/ }));
    await waitFor(() => expect(onThemeChange).toHaveBeenCalledWith("dark"));

    rerender(<SettingsPage onBack={vi.fn()} theme="dark" onThemeChange={onThemeChange} />);
    expect(screen.getByRole("button", { name: /ダーク/ }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("does not show any AI provider settings", async () => {
    render(<SettingsPage onBack={vi.fn()} />);

    await screen.findByRole("button", { name: /システム/ });
    expect(screen.queryByText(/API key/i)).toBeNull();
    expect(screen.queryByText(/OpenRouter/)).toBeNull();
  });

  it("returns to the previous view", () => {
    const onBack = vi.fn();
    render(<SettingsPage onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "戻る" }));
    expect(onBack).toHaveBeenCalled();
  });
});
