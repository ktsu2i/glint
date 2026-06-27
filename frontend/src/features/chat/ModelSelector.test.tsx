import { fireEvent, render as renderBase, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({
  listProviderModels: vi.fn(),
}));

vi.mock("../../shared/api/backend", () => ({
  listProviderModels: backend.listProviderModels,
}));

import { ModelSelector } from "./ModelSelector";
import { I18nProvider } from "../../shared/i18n/i18n";
import type { LLMConfig } from "../../shared/api/backend";

function render(ui: ReactNode) {
  return renderBase(ui, {
    wrapper: ({ children }) => <I18nProvider initialLanguage="ja">{children}</I18nProvider>,
  });
}

function makeConfig(overrides: Partial<LLMConfig> = {}): LLMConfig {
  return {
    activeProviderId: "openai",
    activeModelRef: { providerId: "openai", modelId: "gpt-5" },
    recentProviderIds: ["openai"],
    recentModels: [{ providerId: "openai", modelId: "gpt-5" }],
    providers: [
      {
        providerId: "openai",
        model: "gpt-5",
        models: [],
        hasApiKey: true,
        configured: true,
        isActive: true,
      },
      {
        providerId: "anthropic",
        model: "claude-opus-4-7",
        models: [],
        hasApiKey: true,
        configured: true,
        isActive: false,
      },
      {
        providerId: "openai_compatible:local",
        displayLabel: "Local",
        model: "local-7b",
        models: ["local-7b"],
        hasApiKey: false,
        configured: true,
        isActive: false,
      },
      {
        providerId: "ollama",
        model: "",
        models: [],
        hasApiKey: false,
        configured: false,
        isActive: false,
      },
    ],
    catalog: [
      { id: "openai", displayName: "OpenAI", authKind: "bearer", optionSchema: [], capabilities: { streaming: true, tools: false, images: false } },
      { id: "anthropic", displayName: "Anthropic", authKind: "x-api-key", optionSchema: [], capabilities: { streaming: true, tools: false, images: false } },
      { id: "ollama", displayName: "Ollama", authKind: "none", optionSchema: [], capabilities: { streaming: true, tools: false, images: false } },
      { id: "openai_compatible", displayName: "OpenAI-compatible", authKind: "bearer", optionSchema: [], capabilities: { streaming: true, tools: false, images: false } },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  backend.listProviderModels.mockImplementation(async (providerId: string) => {
    if (providerId === "openai") {
      return { providerId, models: [{ id: "gpt-5", source: "builtin" }], source: "builtin" };
    }
    if (providerId === "anthropic") {
      return { providerId, models: [{ id: "claude-opus-4-7", source: "builtin" }], source: "builtin" };
    }
    return { providerId, models: [], source: "builtin" };
  });
});

describe("ModelSelector", () => {
  it("renders the active model with provider/model tooltip and a popover that lists configured options", async () => {
    const onSelect = vi.fn();
    render(<ModelSelector config={makeConfig()} switching={false} onSelect={onSelect} onOpenSettings={vi.fn()} />);

    const button = screen.getByRole("button", { name: /gpt-5/ });
    expect(button.getAttribute("title")).toBe("openai / gpt-5");
    fireEvent.click(button);

    const popover = screen.getByRole("dialog");
    expect(popover).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("option", { name: /gpt-5/ })).toBeTruthy());
    await waitFor(() => expect(screen.getByRole("option", { name: /claude-opus-4-7/ })).toBeTruthy());
    expect(screen.getByRole("option", { name: /local-7b/ })).toBeTruthy();
    // ollama has no configured model => filtered out
    expect(screen.queryByText(/Ollama/)).toBeNull();
  });

  it("filters by query then selects with Enter, calling onSelect with the (providerId, modelId) pair", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ModelSelector config={makeConfig()} switching={false} onSelect={onSelect} onOpenSettings={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    const search = screen.getByRole("textbox", { name: "modelを検索" });
    await waitFor(() => expect(screen.getByRole("option", { name: /claude-opus-4-7/ })).toBeTruthy());
    fireEvent.change(search, { target: { value: "claude" } });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: /claude-opus-4-7/ })).toBeTruthy();
    });
    expect(screen.queryByRole("option", { name: /gpt-5/ })).toBeNull();

    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("anthropic", "claude-opus-4-7"));
  });

  it("walks options with ArrowDown / ArrowUp and selects with Enter", async () => {
    const onSelect = vi.fn().mockResolvedValue(undefined);
    render(<ModelSelector config={makeConfig()} switching={false} onSelect={onSelect} onOpenSettings={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    const search = screen.getByRole("textbox", { name: "modelを検索" });
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(1));

    // The first focused entry is the recent (openai, gpt-5). ArrowDown moves to the
    // next entry across sections.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(onSelect).toHaveBeenCalledOnce());
    const [calledWith] = onSelect.mock.calls;
    expect(calledWith[0]).not.toBe("openai");
  });

  it("closes on Escape and restores focus to the trigger button", async () => {
    render(<ModelSelector config={makeConfig()} switching={false} onSelect={vi.fn()} onOpenSettings={vi.fn()} />);
    const button = screen.getByRole("button", { name: /gpt-5/ });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());

    const search = screen.getByRole("textbox", { name: "modelを検索" });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("invokes onOpenSettings from the popover footer", async () => {
    const onOpenSettings = vi.fn();
    render(<ModelSelector config={makeConfig()} switching={false} onSelect={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: /gpt-5/ }));
    fireEvent.click(screen.getByRole("button", { name: "Model connectionsを開く" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("renders a 'choose a model' setup CTA when nothing is configured", () => {
    const onOpenSettings = vi.fn();
    render(
      <ModelSelector
        config={makeConfig({ providers: [], activeProviderId: "", recentProviderIds: [], recentModels: [] })}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );
    const cta = screen.getByRole("button", { name: "modelを選択" });
    fireEvent.click(cta);
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("places recently-used (provider, model) pairs above the rest", async () => {
    render(
      <ModelSelector
        config={makeConfig({
          activeProviderId: "anthropic",
          activeModelRef: { providerId: "anthropic", modelId: "claude-opus-4-7" },
          recentProviderIds: ["anthropic", "openai"],
          recentModels: [
            { providerId: "anthropic", modelId: "claude-opus-4-7" },
            { providerId: "openai", modelId: "gpt-5" },
          ],
        })}
        switching={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /claude-opus-4-7/ }));
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(0));

    const options = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    expect(options[0]).toContain("claude-opus-4-7");
    expect(options[1]).toContain("gpt-5");
    expect(options[2]).toContain("local-7b");
  });
});
