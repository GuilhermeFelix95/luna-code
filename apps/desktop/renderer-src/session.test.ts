// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalBridge } from "../src/terminal-api";
import { openSession } from "./session";

// O xterm precisa de canvas e WebGL, que não existem no DOM de teste. O dublê
// só cria um textarea, que é onde o xterm recebe o teclado.
const fake = vi.hoisted(() => {
  class FakeTerminal {
    cols = 80;
    rows = 24;
    private textarea: HTMLTextAreaElement | undefined;

    loadAddon(): void {}

    open(container: HTMLElement): void {
      this.textarea = document.createElement("textarea");
      container.appendChild(this.textarea);
    }

    focus(): void {
      this.textarea?.focus();
    }

    write(): void {}

    writeln(): void {}

    onData(): void {}

    onResize(): void {}
  }

  class FakeFitAddon {
    fit(): void {}
  }

  class FakeWebglAddon {
    onContextLoss(): void {}

    dispose(): void {}
  }

  return { FakeTerminal, FakeFitAddon, FakeWebglAddon };
});

vi.mock("@xterm/xterm", () => ({ Terminal: fake.FakeTerminal }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: fake.FakeFitAddon }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: fake.FakeWebglAddon }));

function fakeBridge(): TerminalBridge {
  return {
    spawn: vi.fn(async () => 1),
    write: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
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
    const container = document.createElement("div");
    document.body.appendChild(container);

    await openSession(container, "claude", fakeBridge());

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
  });
});
