import type { TerminalBridge, TerminalKind } from "../src/terminal-api";
import { openSession, type Session } from "./session";

const KIND_LABEL: Record<TerminalKind, string> = {
  shell: "Terminal",
  claude: "Claude Code",
};

interface Tab {
  title: string;
  pane: HTMLElement;
  item: HTMLLIElement;
  statusText: HTMLSpanElement;
  session?: Session;
  closed: boolean;
}

export interface WorkspaceView {
  host: HTMLElement;
  list: HTMLUListElement;
}

/** Uma sessão visível por vez; as demais continuam vivas, só escondidas. */
export class Workspace {
  private readonly tabs: Tab[] = [];
  private readonly counts: Record<TerminalKind, number> = {
    shell: 0,
    claude: 0,
  };
  private active: Tab | undefined;

  constructor(
    private readonly view: WorkspaceView,
    private readonly bridge: TerminalBridge,
  ) {}

  async open(kind: TerminalKind): Promise<void> {
    this.counts[kind] += 1;
    const tab = this.createTab(`${KIND_LABEL[kind]} ${this.counts[kind]}`);
    this.activate(tab);

    try {
      const session = await openSession(tab.pane, kind, this.bridge, (code) => {
        this.setStatus(tab, `encerrada (código ${code})`);
      });
      if (tab.closed) {
        // A aba foi fechada enquanto o processo iniciava.
        session.close();
        return;
      }
      tab.session = session;
      this.setStatus(tab, "executando");
    } catch (error: unknown) {
      console.error("Falha ao abrir sessão:", error);
      tab.pane.textContent = `Falha ao abrir sessão: ${String(error)}`;
      this.setStatus(tab, "falhou");
    }
  }

  activate(tab: Tab): void {
    if (this.active) {
      this.active.pane.hidden = true;
      this.active.item.removeAttribute("aria-current");
    }
    this.active = tab;
    tab.pane.hidden = false;
    tab.item.setAttribute("aria-current", "true");
    tab.session?.focus();
  }

  close(tab: Tab): void {
    tab.closed = true;
    tab.session?.close();
    tab.pane.remove();
    tab.item.remove();
    this.tabs.splice(this.tabs.indexOf(tab), 1);

    if (this.active === tab) {
      this.active = undefined;
      const next = this.tabs.at(-1);
      if (next) {
        this.activate(next);
      }
    }
  }

  private createTab(title: string): Tab {
    const pane = document.createElement("div");
    pane.className = "session";
    pane.hidden = true;
    this.view.host.appendChild(pane);

    const item = document.createElement("li");
    item.className = "session-item";

    const select = document.createElement("button");
    select.type = "button";
    select.className = "session-select";
    select.textContent = title;

    const statusText = document.createElement("span");
    statusText.className = "session-status";
    statusText.textContent = "iniciando";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "session-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", `Fechar ${title}`);

    item.append(select, statusText, closeButton);
    this.view.list.appendChild(item);

    const tab: Tab = { title, pane, item, statusText, closed: false };
    this.tabs.push(tab);
    select.addEventListener("click", () => this.activate(tab));
    closeButton.addEventListener("click", () => this.close(tab));
    return tab;
  }

  private setStatus(tab: Tab, text: string): void {
    tab.statusText.textContent = text;
  }
}
