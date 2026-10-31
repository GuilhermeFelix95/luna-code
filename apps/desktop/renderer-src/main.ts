import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import type { TerminalKind } from "../src/terminal-api";
import { Workspace } from "./workspace";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`elemento #${id} não encontrado na janela`);
  }
  return element as T;
}

const workspace = new Workspace(
  {
    host: requireElement("terminal"),
    list: requireElement<HTMLUListElement>("session-list"),
  },
  window.terminal,
);

function bindNewSessionButton(buttonId: string, kind: TerminalKind): void {
  requireElement(buttonId).addEventListener("click", () => {
    void workspace.open(kind);
  });
}

bindNewSessionButton("new-shell", "shell");
bindNewSessionButton("new-claude", "claude");
void workspace.open("shell");
