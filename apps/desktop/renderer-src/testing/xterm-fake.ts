// Dublê do xterm para testes de DOM. O xterm precisa de canvas e WebGL, que não
// existem no ambiente de teste. Este dublê só cria um textarea, onde o foco do teclado fica.

export class FakeTerminal {
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

  dispose(): void {
    this.textarea?.remove();
  }
}

export class FakeFitAddon {
  fit(): void {}
}

export class FakeWebglAddon {
  onContextLoss(): void {}

  dispose(): void {}
}
