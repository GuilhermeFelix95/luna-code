// Diálogo de confirmação do próprio Luna, com o visual do app. Usa o <dialog> da página:
// Esc cancela, e a resposta vem do botão que o usuário apertou (returnValue).

import type { Confirm } from "./chat-view";

/** Valor do botão que confirma. Qualquer outra saída (Cancelar, Esc) conta como não. */
export const CONFIRM_VALUE = "ok";

export interface ConfirmElements {
  dialog: HTMLDialogElement;
  message: HTMLElement;
  action: HTMLButtonElement;
}

export function createConfirm(elements: ConfirmElements): Confirm {
  return (message, action) =>
    new Promise<boolean>((resolve) => {
      elements.message.textContent = message;
      elements.action.textContent = action;
      elements.dialog.addEventListener(
        "close",
        () => resolve(elements.dialog.returnValue === CONFIRM_VALUE),
        { once: true },
      );
      elements.dialog.showModal();
    });
}
