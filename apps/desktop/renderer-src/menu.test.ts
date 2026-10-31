// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Menu } from "./menu";

const ITEMS = [
  { value: "readonly", label: "Somente leitura" },
  { value: "ask", label: "Acesso parcial" },
  { value: "full", label: "Acesso total" },
];

function buildMenu(onChange = vi.fn()): {
  menu: Menu;
  trigger: HTMLButtonElement;
  panel: HTMLElement;
  onChange: ReturnType<typeof vi.fn>;
} {
  const menu = new Menu("Modo de permissão", onChange);
  menu.setOptions(ITEMS, "readonly");
  document.body.replaceChildren(menu.element);
  return {
    menu,
    trigger: menu.element.querySelector<HTMLButtonElement>(".menu-trigger")!,
    panel: menu.element.querySelector<HTMLElement>(".menu-panel")!,
    onChange,
  };
}

function itemFor(panel: HTMLElement, value: string): HTMLButtonElement {
  return panel.querySelector<HTMLButtonElement>(`[data-value="${value}"]`)!;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Menu", () => {
  it("mostra o rótulo da opção atual e marca só ela", () => {
    const { trigger, panel } = buildMenu();

    expect(trigger.textContent).toBe("Somente leitura");
    expect(itemFor(panel, "readonly").getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(itemFor(panel, "full").getAttribute("aria-checked")).toBe("false");
  });

  it("escolher uma opção fecha o painel e avisa a mudança", () => {
    const { trigger, panel, onChange } = buildMenu();
    trigger.click();

    itemFor(panel, "full").click();

    expect(panel.hidden).toBe(true);
    expect(trigger.textContent).toBe("Acesso total");
    expect(onChange).toHaveBeenCalledWith("full");
  });

  it("escolher a opção que já está marcada não avisa", () => {
    const { trigger, panel, onChange } = buildMenu();
    trigger.click();

    itemFor(panel, "readonly").click();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("seta para baixo abre o menu no foco da opção atual", () => {
    const { trigger, panel } = buildMenu();

    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    expect(panel.hidden).toBe(false);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(itemFor(panel, "readonly"));
  });

  it("setas movem o foco entre as opções e voltam ao início no fim", () => {
    const { trigger, panel } = buildMenu();
    trigger.click();

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(document.activeElement).toBe(itemFor(panel, "ask"));

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(document.activeElement).toBe(itemFor(panel, "full"));
  });

  it("Esc fecha o menu e devolve o foco ao botão", () => {
    const { trigger, panel } = buildMenu();
    trigger.click();

    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("clicar fora fecha o menu", () => {
    const { trigger, panel } = buildMenu();
    trigger.click();

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(panel.hidden).toBe(true);
  });

  it("trocar as opções refaz a lista e o rótulo", () => {
    const { menu, trigger, panel } = buildMenu();

    menu.setOptions([{ value: "planning", label: "Planejando" }], "planning");

    expect(trigger.textContent).toBe("Planejando");
    expect(panel.querySelectorAll(".menu-item")).toHaveLength(1);
  });

  it("desabilitado não abre", () => {
    const { menu, trigger, panel } = buildMenu();
    menu.setDisabled(true);

    trigger.click();

    expect(trigger.disabled).toBe(true);
    expect(panel.hidden).toBe(true);
  });
});
