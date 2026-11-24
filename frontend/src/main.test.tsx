import { beforeEach, describe, expect, it, vi } from "vitest";

const reactRoot = vi.hoisted(() => ({
  render: vi.fn(),
  createRoot: vi.fn(),
}));

vi.mock("react-dom/client", () => ({ createRoot: reactRoot.createRoot }));
vi.mock("./App", () => ({ default: () => <div>app</div> }));

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
  });
});
