// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatBridge, ChatEventPayload } from "../src/chat-api";
import { ChatView } from "./chat-view";

interface FakeBridge extends ChatBridge {
  emit: (payload: ChatEventPayload) => void;
}

function fakeBridge(): FakeBridge {
  const listeners: Array<(payload: ChatEventPayload) => void> = [];
  return {
    send: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    onEvent: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
    emit: (payload) => listeners.forEach((listener) => listener(payload)),
  };
}

let host: HTMLElement;
let list: HTMLUListElement;

function setup(): {
  view: ChatView;
  bridge: FakeBridge;
  onActivate: () => void;
} {
  document.body.innerHTML = "";
  host = document.createElement("main");
  list = document.createElement("ul");
  document.body.append(host, list);
  const bridge = fakeBridge();
  const onActivate = vi.fn();
  const view = new ChatView({ host, list }, bridge, onActivate);
  view.newConversation();
  return { view, bridge, onActivate };
}

function input(): HTMLTextAreaElement {
  return host.querySelector("textarea") as HTMLTextAreaElement;
}

function sendButton(): HTMLButtonElement {
  return host.querySelector(".chat-send") as HTMLButtonElement;
}

function submit(): void {
  host
    .querySelector("form")
    ?.dispatchEvent(new Event("submit", { cancelable: true }));
}

describe("ChatView", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("envia a mensagem, mostra no chat e limpa o campo", async () => {
    const { bridge } = setup();
    input().value = "  olá  ";

    submit();

    expect(bridge.send).toHaveBeenCalledWith("conversa-1", "olá");
    expect(input().value).toBe("");
    expect(host.querySelector(".message-user")?.textContent).toContain("olá");
  });

  it("mostra o texto do assistente conforme chega", () => {
    const { bridge } = setup();
    input().value = "oi";
    submit();

    bridge.emit({
      conversationId: "conversa-1",
      event: { type: "text-delta", text: "Olá!" },
    });

    expect(host.querySelector(".message-assistant")?.textContent).toContain(
      "Olá!",
    );
  });

  it("mostra ferramenta recolhida com o status", () => {
    const { bridge } = setup();
    input().value = "liste";
    submit();

    bridge.emit({
      conversationId: "conversa-1",
      event: {
        type: "tool-use",
        id: "t1",
        name: "Glob",
        input: { pattern: "*" },
      },
    });
    bridge.emit({
      conversationId: "conversa-1",
      event: { type: "tool-result", toolUseId: "t1", isError: false },
    });

    const tool = host.querySelector("details.tool");
    expect(tool?.querySelector("summary")?.textContent).toBe(
      "Glob · concluído",
    );
    expect(tool?.querySelector("pre")?.textContent).toContain('"pattern": "*"');
  });

  it("Enter envia e Shift+Enter quebra linha", () => {
    const { bridge } = setup();
    input().value = "um";
    input().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        cancelable: true,
      }),
    );
    expect(bridge.send).not.toHaveBeenCalled();

    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
    );
    expect(bridge.send).toHaveBeenCalledWith("conversa-1", "um");
  });

  it("enquanto responde, o botão vira Parar e Enter não envia nem para", () => {
    const { bridge } = setup();
    input().value = "longa";
    submit();

    expect(sendButton().textContent).toBe("Parar");
    input().value = "outra";
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", cancelable: true }),
    );
    expect(bridge.send).toHaveBeenCalledTimes(1);
    expect(bridge.stop).not.toHaveBeenCalled();

    submit();
    expect(bridge.stop).toHaveBeenCalledWith("conversa-1");
  });

  it("mostra falha de envio como erro na conversa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bridge } = setup();
    bridge.send = vi.fn(async () => {
      throw new Error("ainda há uma resposta em andamento");
    });
    input().value = "oi";

    submit();

    await vi.waitFor(() =>
      expect(host.querySelector(".message-error")?.textContent).toContain(
        "ainda há uma resposta em andamento",
      ),
    );
    expect(sendButton().textContent).toBe("Enviar");
    vi.restoreAllMocks();
  });

  it("lista a conversa na barra lateral e chama onActivate ao abrir", () => {
    const { onActivate } = setup();

    expect(list.querySelectorAll(".chat-item")).toHaveLength(1);
    expect(onActivate).toHaveBeenCalled();
  });
});
