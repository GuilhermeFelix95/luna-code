// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatBridge, ChatEventPayload, ChatModel } from "../src/chat-api";
import { ChatView } from "./chat-view";

interface FakeBridge extends ChatBridge {
  emit: (payload: ChatEventPayload) => void;
}

const MODELS: ChatModel[] = [
  {
    value: "default",
    displayName: "Padrão (recomendado)",
    supportedEffortLevels: ["low", "high"],
  },
  {
    value: "opus",
    displayName: "Opus 5.5",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
];

function fakeBridge(): FakeBridge {
  const listeners: Array<(payload: ChatEventPayload) => void> = [];
  return {
    send: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    approve: vi.fn(async () => undefined),
    listModels: vi.fn(async () => MODELS),
    onEvent: (listener) => {
      listeners.push(listener);
      return () => undefined;
    },
    emit: (payload) => listeners.forEach((listener) => listener(payload)),
  };
}

let host: HTMLElement;
let list: HTMLUListElement;

async function setup(): Promise<{
  view: ChatView;
  bridge: FakeBridge;
  onActivate: () => void;
}> {
  document.body.innerHTML = "";
  host = document.createElement("main");
  list = document.createElement("ul");
  document.body.append(host, list);
  const bridge = fakeBridge();
  const onActivate = vi.fn();
  const view = new ChatView({ host, list }, bridge, onActivate);
  view.newConversation();
  // Espera a lista de modelos chegar antes de testar os seletores.
  await vi.waitFor(() => expect(select("Modelo").options).toHaveLength(3));
  return { view, bridge, onActivate };
}

function input(): HTMLTextAreaElement {
  return host.querySelector("textarea") as HTMLTextAreaElement;
}

function sendButton(): HTMLButtonElement {
  return host.querySelector(".chat-send") as HTMLButtonElement;
}

function select(label: string): HTMLSelectElement {
  return host.querySelector(
    `select[aria-label="${label}"]`,
  ) as HTMLSelectElement;
}

function choose(label: string, value: string): void {
  const element = select(label);
  element.value = value;
  element.dispatchEvent(new Event("change"));
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

  it("envia a mensagem com as configurações da conversa e limpa o campo", async () => {
    const { bridge } = await setup();
    input().value = "  olá  ";

    submit();

    expect(bridge.send).toHaveBeenCalledWith("conversa-1", "olá", {
      mode: "readonly",
    });
    expect(input().value).toBe("");
    expect(host.querySelector(".message-user")?.textContent).toContain("olá");
  });

  it("mostra o texto do assistente conforme chega", async () => {
    const { bridge } = await setup();
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

  it("mostra ferramenta recolhida com o status", async () => {
    const { bridge } = await setup();
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

  it("Enter envia e Shift+Enter quebra linha", async () => {
    const { bridge } = await setup();
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
    expect(bridge.send).toHaveBeenCalledWith("conversa-1", "um", {
      mode: "readonly",
    });
  });

  it("enquanto responde, o botão vira Parar e Enter não envia nem para", async () => {
    const { bridge } = await setup();
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

  it("seletores ficam desabilitados durante a resposta", async () => {
    const { bridge } = await setup();
    input().value = "longa";
    submit();

    expect(select("Modo de permissão").disabled).toBe(true);
    expect(select("Modelo").disabled).toBe(true);
    expect(select("Esforço").disabled).toBe(true);

    bridge.emit({
      conversationId: "conversa-1",
      event: { type: "turn-end", ok: true, text: "pronto" },
    });
    expect(select("Modo de permissão").disabled).toBe(false);
  });

  it("escolha de modo e modelo vai na próxima mensagem", async () => {
    const { bridge } = await setup();

    choose("Modo de permissão", "ask");
    choose("Modelo", "opus");
    input().value = "oi";
    submit();

    expect(bridge.send).toHaveBeenCalledWith("conversa-1", "oi", {
      mode: "ask",
      model: "opus",
    });
  });

  it("esforço mostra só os níveis do modelo escolhido", async () => {
    await setup();

    choose("Modelo", "default");
    const levelsOfDefault = [...select("Esforço").options].map(
      (item) => item.value,
    );
    choose("Modelo", "opus");
    const levelsOfOpus = [...select("Esforço").options].map(
      (item) => item.value,
    );

    expect(levelsOfDefault).toEqual(["", "low", "high"]);
    expect(levelsOfOpus).toEqual(["", "low", "medium", "high", "xhigh", "max"]);
  });

  it("troca de modelo que não aceita o esforço atual volta ao padrão", async () => {
    await setup();

    choose("Modelo", "opus");
    choose("Esforço", "max");
    choose("Modelo", "default");

    expect(select("Esforço").value).toBe("");
  });

  it("cartão de aprovação envia a resposta do usuário", async () => {
    const { bridge } = await setup();
    input().value = "crie";
    submit();
    bridge.emit({
      conversationId: "conversa-1",
      event: {
        type: "approval-request",
        requestId: "aprovacao-1",
        toolName: "Write",
        input: { file_path: "a.txt" },
      },
    });

    const card = host.querySelector(".approval");
    expect(card?.textContent).toContain("O Claude quer usar Write");
    (host.querySelector(".approval-allow") as HTMLButtonElement).click();

    expect(bridge.approve).toHaveBeenCalledWith("aprovacao-1", true);
    await vi.waitFor(() =>
      expect(host.querySelector(".approval-result")?.textContent).toBe(
        "Permitido",
      ),
    );
  });

  it("mostra falha de envio como erro na conversa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { bridge } = await setup();
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

  it("lista a conversa na barra lateral e chama onActivate ao abrir", async () => {
    const { onActivate } = await setup();

    expect(list.querySelectorAll(".chat-item")).toHaveLength(1);
    expect(onActivate).toHaveBeenCalled();
  });
});
