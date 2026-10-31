import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { decodeBase64 } from "../src/terminal-api";

const TERMINAL_FONT = "Consolas, 'Cascadia Mono', monospace";
const TERMINAL_FONT_SIZE = 14;

async function startTerminal(container: HTMLElement): Promise<void> {
  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: TERMINAL_FONT,
    fontSize: TERMINAL_FONT_SIZE,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  loadWebgl(terminal);
  fit.fit();

  // A saída pode chegar antes de o spawn resolver; guarda até conhecer o sessionId.
  const session: { id?: number; pendingOutput: string[] } = {
    pendingOutput: [],
  };
  window.terminal.onOutput((payload) => {
    if (session.id === undefined) {
      session.pendingOutput.push(payload.data);
      return;
    }
    if (payload.sessionId === session.id) {
      terminal.write(decodeBase64(payload.data));
    }
  });
  window.terminal.onExit((payload) => {
    if (payload.sessionId !== session.id) {
      return;
    }
    terminal.writeln(`\r\n[processo encerrado com código ${payload.code}]`);
    void window.terminal.kill(payload.sessionId);
  });

  const id = await window.terminal.spawn(terminal.cols, terminal.rows);
  session.id = id;
  for (const data of session.pendingOutput.splice(0)) {
    terminal.write(decodeBase64(data));
  }

  terminal.onData((data) => {
    void window.terminal.write(id, data);
  });
  terminal.onResize(({ cols, rows }) => {
    void window.terminal.resize(id, cols, rows);
  });
  window.addEventListener("resize", () => fit.fit());
  window.addEventListener("beforeunload", () => {
    void window.terminal.kill(id);
  });
}

// WebGL é o caminho rápido; se não estiver disponível, o xterm usa o renderer DOM.
function loadWebgl(terminal: Terminal): void {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => webgl.dispose());
    terminal.loadAddon(webgl);
  } catch (error: unknown) {
    console.warn("WebGL indisponível; usando o renderer DOM:", error);
  }
}

const container = document.getElementById("terminal");
if (!container) {
  throw new Error("elemento #terminal não encontrado na janela");
}

startTerminal(container).catch((error: unknown) => {
  console.error("Falha ao iniciar o terminal:", error);
  container.textContent = `Falha ao iniciar o terminal: ${String(error)}`;
});
