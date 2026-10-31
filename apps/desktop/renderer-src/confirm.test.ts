// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createConfirm, type ConfirmElements } from "./confirm";

let elements: ConfirmElements;

beforeEach(() => {
  elements = {
    dialog: document.createElement("dialog"),
    message: document.createElement("p"),
    action: document.createElement("button"),
  };
  // happy-dom não abre o <dialog> de verdade; o teste só precisa do evento de fechamento.
  elements.dialog.showModal = vi.fn();
  document.body.replaceChildren(elements.dialog);
});

/** Simula o usuário apertando um botão do formulário: o dialog guarda o valor e fecha. */
function closeWith(value: string): void {
  elements.dialog.returnValue = value;
  elements.dialog.dispatchEvent(new Event("close"));
}

describe("createConfirm", () => {
  it("mostra a mensagem e o nome da ação no diálogo", () => {
    const confirm = createConfirm(elements);

    void confirm("Excluir esta conversa?", "Excluir");

    expect(elements.message.textContent).toBe("Excluir esta conversa?");
    expect(elements.action.textContent).toBe("Excluir");
    expect(elements.dialog.showModal).toHaveBeenCalled();
  });

  it("resolve verdadeiro quando o usuário confirma", async () => {
    const confirm = createConfirm(elements);

    const answer = confirm("Remover?", "Remover");
    closeWith("ok");

    await expect(answer).resolves.toBe(true);
  });

  it("resolve falso quando o usuário cancela ou fecha com Esc", async () => {
    const confirm = createConfirm(elements);

    const cancelled = confirm("Remover?", "Remover");
    closeWith("cancel");
    const escaped = confirm("Remover?", "Remover");
    closeWith("");

    await expect(cancelled).resolves.toBe(false);
    await expect(escaped).resolves.toBe(false);
  });
});
