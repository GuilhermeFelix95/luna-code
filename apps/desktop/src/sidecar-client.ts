import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
  decodeResponse,
  encodeRequest,
  type SidecarResponse,
} from "./sidecar-protocol";

// Recorte mínimo do processo filho, para permitir teste sem subir o binário.
export interface SidecarProcess {
  stdin: Writable;
  stdout: Readable;
  kill(): boolean;
  on(event: "exit", listener: (code: number | null) => void): unknown;
}

interface PendingRequest {
  resolve(result: string): void;
  reject(error: Error): void;
}

export class SidecarClient {
  private nextId = 1;
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly process: SidecarProcess) {
    readline
      .createInterface({ input: process.stdout })
      .on("line", (line) => this.handleLine(line));
    process.stdin.on("error", (error) => this.rejectAll(error));
    process.on("exit", (code) =>
      this.rejectAll(new Error(`sidecar encerrou com código ${code}`)),
    );
  }

  ping(): Promise<string> {
    return this.call("ping");
  }

  stop(): void {
    this.process.kill();
  }

  private call(method: string): Promise<string> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${encodeRequest({ id, method })}\n`);
    });
  }

  private handleLine(line: string): void {
    let response: SidecarResponse;
    try {
      response = decodeResponse(line);
    } catch (error) {
      this.rejectAll(toError(error));
      return;
    }

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
    } else if (response.result !== null) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error("resposta sem resultado nem erro"));
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
