import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { ChatView } from "./chat-view";
import { Workspace } from "./workspace";

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`elemento #${id} não encontrado na janela`);
  }
  return element as T;
}

// A área principal mostra o chat ou um terminal, nunca os dois.
const chatHost = requireElement("chat");
const terminalHost = requireElement("terminal");

function showChat(): void {
  chatHost.hidden = false;
  terminalHost.hidden = true;
}

function showTerminal(): void {
  terminalHost.hidden = false;
  chatHost.hidden = true;
}

const chat = new ChatView(
  {
    host: chatHost,
    list: requireElement<HTMLUListElement>("chat-list"),
  },
  window.chat,
  showChat,
);

const workspace = new Workspace(
  {
    host: terminalHost,
    list: requireElement<HTMLUListElement>("session-list"),
    onActivate: showTerminal,
  },
  window.terminal,
);

requireElement("new-chat").addEventListener("click", () => {
  chat.newConversation();
});

requireElement("new-shell").addEventListener("click", () => {
  void workspace.open("shell");
});

chat.newConversation();
