import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import type { TerminalKind } from "../src/terminal-api";
import { killLiveSessions, openSession } from "./session";

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
    void openSession(container, kind, window.terminal);
  });
}

const container = document.getElementById("terminal");
if (!container) {
  throw new Error("elemento #terminal não encontrado na janela");
}

bindNewSessionButton("new-shell", "shell", container);
bindNewSessionButton("new-claude", "claude", container);
window.addEventListener("beforeunload", () => {
  killLiveSessions(window.terminal);
});
void openSession(container, "shell", window.terminal);
