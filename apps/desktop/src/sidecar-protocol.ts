export interface SidecarRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

export interface SidecarResponse {
  id: number | null;
  result: unknown;
  error: string | null;
}

export type SidecarEvent =
  | { event: "pty.output"; sessionId: number; data: string }
  | { event: "pty.exit"; sessionId: number; code: number | null };

export type SidecarMessage =
  | { kind: "response"; response: SidecarResponse }
  | { kind: "event"; event: SidecarEvent };

export function encodeRequest(request: SidecarRequest): string {
  return JSON.stringify(request);
}

// Valida a linha vinda do processo Rust antes de confiar nos campos.
export function decodeMessage(line: string): SidecarMessage {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null) {
    throw new Error("mensagem do sidecar não é um objeto");
  }

  const fields = value as Record<string, unknown>;
  if ("event" in fields) {
    return { kind: "event", event: decodeEvent(fields) };
  }
  return { kind: "response", response: decodeResponse(fields) };
}

function decodeResponse(fields: Record<string, unknown>): SidecarResponse {
  const { id, error } = fields;
  if (id !== null && typeof id !== "number") {
    throw new Error("campo id da resposta do sidecar é inválido");
  }
  if (error !== null && typeof error !== "string") {
    throw new Error("campo error da resposta do sidecar é inválido");
  }

  return { id, result: fields.result, error };
}

function decodeEvent(fields: Record<string, unknown>): SidecarEvent {
  const { event, sessionId } = fields;
  if (typeof sessionId !== "number") {
    throw new Error("campo sessionId do evento é inválido");
  }

  if (event === "pty.output") {
    const data = fields.data;
    if (typeof data !== "string") {
      throw new Error("campo data do evento pty.output é inválido");
    }
    return { event, sessionId, data };
  }

  if (event === "pty.exit") {
    const code = fields.code;
    if (code !== null && typeof code !== "number") {
      throw new Error("campo code do evento pty.exit é inválido");
    }
    return { event, sessionId, code };
  }

  throw new Error(`evento desconhecido do sidecar: ${String(event)}`);
}
