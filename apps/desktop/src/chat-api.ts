// Contrato do chat entre o processo principal, o preload e o renderer.
// Não importa nada do Electron nem do SDK, para rodar em Node puro.

export const CHAT_CHANNELS = {
  send: "chat:send",
  stop: "chat:stop",
  approve: "chat:approve",
  models: "chat:models",
  open: "chat:open",
  event: "chat:event",
} as const;

/** Modos de permissão escolhidos pelo usuário em cada conversa. */
export const CHAT_MODES = ["readonly", "ask", "full"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export function isChatMode(value: unknown): value is ChatMode {
  return CHAT_MODES.some((mode) => mode === value);
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return EFFORT_LEVELS.some((level) => level === value);
}

/** Configuração de um envio. Modelo e esforço ausentes significam "padrão do modelo". */
export interface ChatSettings {
  mode: ChatMode;
  model?: string;
  effort?: EffortLevel;
  /** Planejar: a conversa roda só em modo de planejamento, sem editar nem executar. */
  planning?: boolean;
}

/** Mensagem de uma conversa salva, reconstruída do histórico do Claude ao reabrir. */
export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

/** Modelo disponível na conta, com os níveis de esforço que ele aceita. */
export interface ChatModel {
  value: string;
  displayName: string;
  supportedEffortLevels: EffortLevel[];
}

/** Eventos de um turno, já traduzidos do SDK. */
export type RunnerEvent =
  | { type: "session"; sessionId: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-use"; id: string; name: string; input: unknown }
  | { type: "tool-result"; toolUseId: string; isError: boolean }
  | { type: "turn-end"; ok: boolean; text: string };

/** Pedido de aprovação de uma ferramenta, no modo "Acesso parcial". */
export interface ApprovalRequestEvent {
  type: "approval-request";
  requestId: string;
  toolName: string;
  input: unknown;
}

export type ChatEvent = RunnerEvent | ApprovalRequestEvent;

export interface ChatEventPayload {
  conversationId: string;
  event: ChatEvent;
}

/** API exposta ao renderer pelo preload. */
export interface ChatBridge {
  send(
    conversationId: string,
    text: string,
    settings: ChatSettings,
  ): Promise<void>;
  stop(conversationId: string): Promise<void>;
  approve(requestId: string, allowed: boolean): Promise<void>;
  listModels(): Promise<ChatModel[]>;
  open(conversationId: string): Promise<HistoryMessage[]>;
  onEvent(listener: (payload: ChatEventPayload) => void): () => void;
}
