// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalBridge } from "../src/terminal-api";
import { openSession } from "./session";

vi.mock("@xterm/xterm", async () => ({
  Terminal: (await import("./testing/xterm-fake")).FakeTerminal,
}));
vi.mock("@xterm/addon-fit", async () => ({
  FitAddon: (await import("./testing/xterm-fake")).FakeFitAddon,
}));
vi.mock("@xterm/addon-webgl", async () => ({
  WebglAddon: (await import("./testing/xterm-fake")).FakeWebglAddon,
}));

function fakeBridge(): TerminalBridge {
  return {
    spawn: vi.fn(async () => 1),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    kill: vi.fn(async () => undefined),
    onOutput: () => () => undefined,
    onExit: () => () => undefined,
  };
}

describe("openSession", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("foca o painel novo para o teclado ir para a sessão, não para o botão", async () => {
    const pane = document.createElement("div");
    document.body.appendChild(pane);

    await openSession(pane, "claude", fakeBridge(), () => undefined);

    const textarea = pane.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
  });
});
