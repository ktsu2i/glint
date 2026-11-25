import { beforeEach, describe, expect, it, vi } from "vitest";

const reactRoot = vi.hoisted(() => ({
  render: vi.fn(),
  createRoot: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: reactRoot.createRoot }));
vi.mock("./App", () => ({ default: () => <div>app</div> }));
vi.mock("./features/settings/SettingsWindow", () => ({
  SettingsWindowApp: () => <div>settings</div>,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
  reactRoot.createRoot.mockReturnValue({ render: reactRoot.render });
});

describe("frontend entrypoint", () => {
  it("mounts the application into the root element", async () => {
    await import("./main");

    expect(reactRoot.createRoot).toHaveBeenCalledWith(document.querySelector("#root"));
    expect(reactRoot.render).toHaveBeenCalledOnce();
    expect(JSON.stringify(reactRoot.render.mock.calls[0]?.[0])).not.toContain("settings");
  });

  it("renders the settings window when opened with the settings hash", async () => {
    window.location.hash = "#settings";
    try {
      await import("./main");
      const element = reactRoot.render.mock.calls[0]?.[0] as { props: { children: unknown } };
      const child = element.props.children as { type: { name: string } };
      expect(child.type.name).toBe("SettingsWindowApp");
    } finally {
      window.location.hash = "";
    }
  });
});
