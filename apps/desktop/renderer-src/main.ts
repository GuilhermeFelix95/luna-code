import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { ChatView } from "./chat-view";
import { createConfirm } from "./confirm";
import { Workspace } from "./workspace";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`elemento #${id} não encontrado na janela`);
  }
  return element as T;
}

// A área principal mostra a tela inicial, uma conversa ou um terminal, nunca mais de um.
const welcomeHost = requireElement("welcome");
const chatHost = requireElement("chat");
const terminalHost = requireElement("terminal");

/** Mostra a área da conversa: esconde o terminal. A conversa e a tela inicial cuidam de si. */
function showChatArea(): void {
  terminalHost.hidden = true;
}

function showTerminal(): void {
  terminalHost.hidden = false;
  chatHost.hidden = true;
  welcomeHost.hidden = true;
}

const chat = new ChatView(
  {
    host: chatHost,
    welcome: welcomeHost,
    list: requireElement("chat-list"),
    newChat: requireElement<HTMLButtonElement>("new-chat"),
    addProject: requireElement<HTMLButtonElement>("add-project"),
    welcomeAddProject: requireElement<HTMLButtonElement>("welcome-add-project"),
  },
  window.chat,
  window.state,
  createConfirm({
    dialog: requireElement<HTMLDialogElement>("confirm-dialog"),
    message: requireElement("confirm-message"),
    action: requireElement<HTMLButtonElement>("confirm-action"),
  }),
  showChatArea,
);

const workspace = new Workspace(
  {
    host: terminalHost,
    list: requireElement<HTMLUListElement>("session-list"),
    onActivate: showTerminal,
  },
  window.terminal,
);

requireElement("new-shell").addEventListener("click", () => {
  void workspace.open("shell");
});

chat.load().catch((error: unknown) => {
  console.error("Falha ao carregar projetos e conversas:", error);
});
