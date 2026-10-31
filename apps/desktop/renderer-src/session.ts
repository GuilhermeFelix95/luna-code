import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import {
  decodeBase64,
  type TerminalBridge,
  type TerminalKind,
} from "../src/terminal-api";

const TERMINAL_FONT = "Consolas, 'Cascadia Mono', monospace";
const TERMINAL_FONT_SIZE = 14;

export interface Session {
  focus(): void;
  close(): void;
}

/**
 * Abre um terminal dentro de `pane`. `onExit` é chamado quando o processo termina.
 * Se o spawn falhar, a exceção sobe para quem chamou e nada fica registrado.
 */
export async function openSession(
  pane: HTMLElement,
  kind: TerminalKind,
  bridge: TerminalBridge,
  onExit: (code: number | null) => void,
): Promise<Session> {
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
  // Ajusta a sessão quando o painel muda de tamanho, inclusive ao ser exibido de novo.
  const resizeObserver = new ResizeObserver(() => fit.fit());
  resizeObserver.observe(pane);

  // A saída pode chegar antes de o spawn resolver; guarda até conhecer o sessionId.
  const session: { id?: number; ended: boolean; pendingOutput: string[] } = {
    ended: false,
    pendingOutput: [],
  };
  const stopOutput = bridge.onOutput((payload) => {
    if (session.id === undefined) {
      session.pendingOutput.push(payload.data);
      return;
    }
    if (payload.sessionId === session.id) {
      terminal.write(decodeBase64(payload.data));
    }
  });
  const stopExit = bridge.onExit((payload) => {
    if (payload.sessionId !== session.id) {
      return;
    }
    // Sem processo ativo, não há mais saída para este painel; solta os listeners.
    session.ended = true;
    stopOutput();
    stopExit();
    terminal.writeln(`\r\n[processo encerrado com código ${payload.code}]`);
    void bridge.kill(payload.sessionId);
    onExit(payload.code);
  });

  let id: number;
  try {
    id = await bridge.spawn(kind, terminal.cols, terminal.rows);
  } catch (error: unknown) {
    stopOutput();
    stopExit();
    resizeObserver.disconnect();
    terminal.dispose();
    throw error;
  }
  session.id = id;
  for (const data of session.pendingOutput.splice(0)) {
    terminal.write(decodeBase64(data));
  }

  terminal.onData((data) => {
    void bridge.write(id, data);
  });
  terminal.onResize(({ cols, rows }) => {
    void bridge.resize(id, cols, rows);
  });
  terminal.focus();

  return {
    focus: () => terminal.focus(),
    close: () => {
      resizeObserver.disconnect();
      stopOutput();
      stopExit();
      if (!session.ended) {
        bridge.close(id).catch((error: unknown) => {
          console.error("Falha ao encerrar sessão:", error);
        });
      }
      terminal.dispose();
    },
  };
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
