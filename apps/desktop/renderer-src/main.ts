import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { decodeBase64, type TerminalKind } from "../src/terminal-api";

const TERMINAL_FONT = "Consolas, 'Cascadia Mono', monospace";
const TERMINAL_FONT_SIZE = 14;

// Sessões com processo ainda ativo. São encerradas ao fechar a janela.
const liveSessions = new Set<number>();

async function openSession(
  container: HTMLElement,
  kind: TerminalKind,
): Promise<void> {
  const pane = document.createElement("div");
  pane.className = "session";
  container.appendChild(pane);

  const terminal = new Terminal({
    cursorBlink: true,
    fontFamily: TERMINAL_FONT,
    fontSize: TERMINAL_FONT_SIZE,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(pane);
  loadWebgl(terminal);
  fit.fit();
  // Ajusta a sessão quando o painel muda de tamanho, pela janela ou por outra sessão.
  new ResizeObserver(() => fit.fit()).observe(pane);

  // A saída pode chegar antes de o spawn resolver; guarda até conhecer o sessionId.
  const session: { id?: number; pendingOutput: string[] } = {
    pendingOutput: [],
  };
  const stopOutput = window.terminal.onOutput((payload) => {
    if (session.id === undefined) {
      session.pendingOutput.push(payload.data);
      return;
    }
    if (payload.sessionId === session.id) {
      terminal.write(decodeBase64(payload.data));
    }
  });
  const stopExit = window.terminal.onExit((payload) => {
    if (payload.sessionId !== session.id) {
      return;
    }
    // Sem sessão ativa, não há mais saída para este painel; solta os listeners.
    stopOutput();
    stopExit();
    liveSessions.delete(payload.sessionId);
    terminal.writeln(`\r\n[processo encerrado com código ${payload.code}]`);
    void window.terminal.kill(payload.sessionId);
  });

  let id: number;
  try {
    id = await window.terminal.spawn(kind, terminal.cols, terminal.rows);
  } catch (error: unknown) {
    stopOutput();
    stopExit();
    console.error("Falha ao abrir sessão:", error);
    pane.textContent = `Falha ao abrir sessão: ${String(error)}`;
    return;
  }
  session.id = id;
  liveSessions.add(id);
  for (const data of session.pendingOutput.splice(0)) {
    terminal.write(decodeBase64(data));
  }

  terminal.onData((data) => {
    void window.terminal.write(id, data);
  });
  terminal.onResize(({ cols, rows }) => {
    void window.terminal.resize(id, cols, rows);
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

function bindNewSessionButton(
  buttonId: string,
  kind: TerminalKind,
  container: HTMLElement,
): void {
  const button = document.getElementById(buttonId);
  if (!button) {
    throw new Error(`botão #${buttonId} não encontrado na janela`);
  }
  button.addEventListener("click", () => {
    void openSession(container, kind);
  });
}

const container = document.getElementById("terminal");
if (!container) {
  throw new Error("elemento #terminal não encontrado na janela");
}

bindNewSessionButton("new-shell", "shell", container);
bindNewSessionButton("new-claude", "claude", container);
window.addEventListener("beforeunload", () => {
  for (const id of liveSessions) {
    void window.terminal.kill(id);
  }
});
void openSession(container, "shell");
