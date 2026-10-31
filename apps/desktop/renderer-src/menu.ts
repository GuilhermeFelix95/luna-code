// Menu próprio para escolhas curtas (modo, modelo, esforço). Substitui o <select> nativo, que o
// sistema desenha e não aceita estilo. Teclado: seta para baixo abre; setas movem; Enter ou
// Espaço escolhe; Esc fecha e devolve o foco ao botão; Tab fecha.
// Todo texto vai por textContent.

export interface MenuItem {
  value: string;
  label: string;
}

export class Menu {
  readonly element: HTMLDivElement;
  private readonly trigger: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private items: MenuItem[] = [];
  private value = "";

  constructor(
    label: string,
    private readonly onChange: (value: string) => void,
  ) {
    this.element = document.createElement("div");
    this.element.className = "menu";

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "menu-trigger";
    this.trigger.setAttribute("aria-haspopup", "menu");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.setAttribute("aria-label", label);

    this.panel = document.createElement("div");
    this.panel.className = "menu-panel";
    this.panel.setAttribute("role", "menu");
    this.panel.hidden = true;

    this.element.append(this.trigger, this.panel);

    this.trigger.addEventListener("click", () => this.toggle());
    this.trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.open();
      }
    });
    this.panel.addEventListener("keydown", (event) =>
      this.handlePanelKey(event),
    );
    document.addEventListener("pointerdown", (event) => {
      if (!this.element.contains(event.target as Node | null)) {
        this.close();
      }
    });
  }

  /** Troca as opções e marca a atual. Usado quando o modelo muda e a lista de esforço se refaz. */
  setOptions(items: MenuItem[], value: string): void {
    this.items = items;
    this.value = value;
    this.render();
  }

  setDisabled(disabled: boolean): void {
    this.trigger.disabled = disabled;
    if (disabled) {
      this.close();
    }
  }

  private render(): void {
    const current = this.items.find((item) => item.value === this.value);
    this.trigger.textContent = current?.label ?? "";
    this.panel.replaceChildren(
      ...this.items.map((item) => this.buildItem(item)),
    );
  }

  private buildItem(item: MenuItem): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.setAttribute("role", "menuitemradio");
    button.setAttribute("aria-checked", String(item.value === this.value));
    button.dataset.value = item.value;
    button.textContent = item.label;
    button.addEventListener("click", () => this.choose(item.value));
    return button;
  }

  private choose(value: string): void {
    this.close();
    if (value === this.value) {
      return;
    }
    this.value = value;
    this.render();
    this.onChange(value);
  }

  private open(): void {
    this.panel.hidden = false;
    this.trigger.setAttribute("aria-expanded", "true");
    const buttons = this.itemButtons();
    const checked = buttons.find(
      (button) => button.getAttribute("aria-checked") === "true",
    );
    (checked ?? buttons[0])?.focus();
  }

  private close(): void {
    if (this.panel.hidden) {
      return;
    }
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-expanded", "false");
  }

  private toggle(): void {
    if (this.panel.hidden) {
      this.open();
    } else {
      this.close();
    }
  }

  private handlePanelKey(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      this.close();
      this.trigger.focus();
      return;
    }
    if (event.key === "Tab") {
      this.close();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }
    const buttons = this.itemButtons();
    if (buttons.length === 0) {
      return;
    }
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = (index + step + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }

  private itemButtons(): HTMLButtonElement[] {
    return [...this.panel.querySelectorAll<HTMLButtonElement>(".menu-item")];
  }
}
