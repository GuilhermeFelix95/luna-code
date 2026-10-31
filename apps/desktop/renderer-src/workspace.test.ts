// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TerminalBridge } from "../src/terminal-api";
import { Workspace } from "./workspace";

vi.mock("@xterm/xterm", async () => ({
  Terminal: (await import("./testing/xterm-fake")).FakeTerminal,
}));
vi.mock("@xterm/addon-fit", async () => ({
  FitAddon: (await import("./testing/xterm-fake")).FakeFitAddon,
}));
vi.mock("@xterm/addon-webgl", async () => ({
  WebglAddon: (await import("./testing/xterm-fake")).FakeWebglAddon,
}));

let nextSessionId = 1;

function fakeBridge(): TerminalBridge {
  return {
    spawn: vi.fn(async () => nextSessionId++),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    onOutput: () => () => undefined,
    onExit: () => () => undefined,
  };
}

function mountWorkspace(bridge: TerminalBridge): {
  workspace: Workspace;
  list: HTMLUListElement;
  host: HTMLElement;
} {
  const host = document.createElement("main");
  const list = document.createElement("ul");
  document.body.append(host, list);
  const onActivate = vi.fn();
  return {
    workspace: new Workspace({ host, list, onActivate }, bridge),
    list,
    host,
  };
}

const panes = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>(".session"),
];

describe("Workspace", () => {
  beforeEach(() => {
    nextSessionId = 1;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lista cada sessão na barra lateral e mostra só a sessão ativa", async () => {
    const { workspace, list, host } = mountWorkspace(fakeBridge());

    await workspace.open("shell");
    await workspace.open("claude");

    const titles = [...list.querySelectorAll(".session-select")].map(
      (button) => button.textContent,
    );
    expect(titles).toEqual(["Terminal 1", "Claude Code 1"]);

    const [first, second] = panes(host);
    expect(first.hidden).toBe(true);
    expect(second.hidden).toBe(false);
  });

  it("trocar de sessão esconde a anterior e mostra a escolhida", async () => {
    const { workspace, list, host } = mountWorkspace(fakeBridge());
    await workspace.open("shell");
    await workspace.open("claude");

    const firstSelect =
      list.querySelectorAll<HTMLButtonElement>(".session-select")[0];
    firstSelect.click();

    const [first, second] = panes(host);
    expect(first.hidden).toBe(false);
    expect(second.hidden).toBe(true);
  });

  it("fechar a sessão ativa remove o painel, o item e encerra o processo", async () => {
    const bridge = fakeBridge();
    const { workspace, list, host } = mountWorkspace(bridge);
    await workspace.open("claude");

    list.querySelector<HTMLButtonElement>(".session-close")?.click();

    expect(panes(host)).toHaveLength(0);
    expect(list.querySelectorAll(".session-item")).toHaveLength(0);
    expect(bridge.close).toHaveBeenCalledWith(1);
  });
});
