// Contrato do chat entre o processo principal, o preload e o renderer.
// Não importa nada do Electron nem do SDK, para rodar em Node puro.

export const CHAT_CHANNELS = {
  send: "chat:send",
  stop: "chat:stop",
  event: "chat:event",
} as const;

/** Eventos de um turno, já traduzidos do SDK. */
export type RunnerEvent =
  | { type: "session"; sessionId: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-use"; id: string; name: string; input: unknown }
  | { type: "tool-result"; toolUseId: string; isError: boolean }
  | { type: "turn-end"; ok: boolean; text: string };

export interface ChatEventPayload {
  conversationId: string;
  event: RunnerEvent;
}

/** API exposta ao renderer pelo preload. */
export interface ChatBridge {
  send(conversationId: string, text: string): Promise<void>;
  stop(conversationId: string): Promise<void>;
  onEvent(listener: (payload: ChatEventPayload) => void): () => void;
}
