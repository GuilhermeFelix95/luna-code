import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  decodeMessage,
  encodeRequest,
  type SidecarEvent,
  type SidecarMessage,
} from "./sidecar-protocol";

// Recorte mínimo do processo filho, para permitir teste sem subir o binário.
export interface SidecarProcess {
  stdin: Writable;
  stdout: Readable;
  kill(): boolean;
  on(event: "exit", listener: (code: number | null) => void): unknown;
}

export type SidecarEventListener = (event: SidecarEvent) => void;

interface PendingRequest {
  resolve(result: unknown): void;
  reject(error: Error): void;
}

export class SidecarClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly listeners = new Set<SidecarEventListener>();

  constructor(private readonly process: SidecarProcess) {
    readline
      .createInterface({ input: process.stdout })
      .on("line", (line) => this.handleLine(line));
    process.stdin.on("error", (error) => this.rejectAll(error));
    process.on("exit", (code) =>
      this.rejectAll(new Error(`sidecar encerrou com código ${code}`)),
    );
  }

  async ping(): Promise<string> {
    const result = await this.call("ping");
    if (typeof result !== "string") {
      throw new Error("resultado de ping inválido");
    }
    return result;
  }

  async spawnTerminal(cols: number, rows: number): Promise<number> {
    const result = await this.call("pty.spawn", { cols, rows });
    if (!isSessionResult(result)) {
      throw new Error("resultado de pty.spawn inválido");
    }
    return result.sessionId;
  }

  /** `data` é texto em UTF-8; o protocolo transporta base64. */
  async writeTerminal(sessionId: number, data: string): Promise<void> {
    const encoded = Buffer.from(data, "utf8").toString("base64");
    await this.call("pty.write", { sessionId, data: encoded });
  }

  async resizeTerminal(
    sessionId: number,
    cols: number,
    rows: number,
  ): Promise<void> {
    await this.call("pty.resize", { sessionId, cols, rows });
  }

  async killTerminal(sessionId: number): Promise<void> {
    await this.call("pty.kill", { sessionId });
  }

  /** Assina eventos `pty.output` e `pty.exit`. Retorna a função para cancelar. */
  onEvent(listener: SidecarEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stop(): void {
    this.process.kill();
  }

  private call(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${encodeRequest({ id, method, params })}\n`);
    });
  }

  private handleLine(line: string): void {
    let message: SidecarMessage;
    try {
      message = decodeMessage(line);
    } catch (error) {
      this.rejectAll(toError(error));
      return;
    }

    if (message.kind === "event") {
      for (const listener of this.listeners) {
        listener(message.event);
      }
      return;
    }

    const { response } = message;
    if (response.id === null) {
      this.rejectAll(new Error(response.error ?? "resposta sem id"));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      this.rejectAll(
        new Error(`resposta para id desconhecido: ${response.id}`),
      );
      return;
    }
    this.pending.delete(response.id);

    if (response.error !== null) {
      pending.reject(new Error(response.error));
    } else {
      pending.resolve(response.result);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isSessionResult(value: unknown): value is { sessionId: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { sessionId?: unknown }).sessionId === "number"
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
