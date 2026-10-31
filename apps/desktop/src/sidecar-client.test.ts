import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { SidecarClient } from "./sidecar-client";

class FakeSidecar extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  kill(): boolean {
    return true;
  }

  // Lê a requisição escrita no stdin e devolve o id enviado.
  readRequestId(): Promise<number> {
    return new Promise((resolve) => {
      this.stdin.once("data", (chunk: Buffer) => {
        const request = JSON.parse(chunk.toString()) as { id: number };
        resolve(request.id);
      });
    });
  }

  reply(line: string): void {
    this.stdout.write(`${line}\n`);
  }
}

describe("SidecarClient", () => {
  it("ping resolve com o resultado da resposta de mesmo id", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const idPromise = fake.readRequestId();
    const result = client.ping();
    fake.reply(
      JSON.stringify({ id: await idPromise, result: "pong", error: null }),
    );

    await expect(result).resolves.toBe("pong");
  });

  it("ping rejeita quando o sidecar responde com erro", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const idPromise = fake.readRequestId();
    const result = client.ping();
    fake.reply(
      JSON.stringify({ id: await idPromise, result: null, error: "falhou" }),
    );

    await expect(result).rejects.toThrow("falhou");
  });

  it("rejeita pendentes quando o processo encerra", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const result = client.ping();
    fake.emit("exit", 1);

    await expect(result).rejects.toThrow("código 1");
  });

  it("rejeita quando a linha recebida não é um protocolo válido", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const result = client.ping();
    fake.reply("linha inválida");

    await expect(result).rejects.toThrow();
  });
});
