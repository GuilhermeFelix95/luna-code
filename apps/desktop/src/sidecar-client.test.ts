import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { SidecarClient } from "./sidecar-client";

interface WrittenRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

class FakeSidecar extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  kill(): boolean {
    return true;
  }

  // Lê a próxima requisição escrita no stdin.
  readRequest(): Promise<WrittenRequest> {
    return new Promise((resolve) => {
      this.stdin.once("data", (chunk: Buffer) => {
        resolve(JSON.parse(chunk.toString()) as WrittenRequest);
      });
    });
  }

  reply(line: string): void {
    this.stdout.write(`${line}\n`);
  }
}

describe("SidecarClient.ping", () => {
  it("resolve com o resultado da resposta de mesmo id", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const requestPromise = fake.readRequest();
    const result = client.ping();
    const request = await requestPromise;
    fake.reply(JSON.stringify({ id: request.id, result: "pong", error: null }));

    await expect(result).resolves.toBe("pong");
  });

  it("rejeita quando o sidecar responde com erro", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const requestPromise = fake.readRequest();
    const result = client.ping();
    const request = await requestPromise;
    fake.reply(
      JSON.stringify({ id: request.id, result: null, error: "falhou" }),
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

describe("SidecarClient de terminal", () => {
  it("spawnTerminal envia cols e rows e resolve com o sessionId", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const requestPromise = fake.readRequest();
    const sessionId = client.spawnTerminal(80, 24);
    const request = await requestPromise;
    expect(request).toMatchObject({
      method: "pty.spawn",
      params: { cols: 80, rows: 24 },
    });
    fake.reply(
      JSON.stringify({
        id: request.id,
        result: { sessionId: 7 },
        error: null,
      }),
    );

    await expect(sessionId).resolves.toBe(7);
  });

  it("spawnTerminal repassa programa, argumentos, cwd e ambiente", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);
    const spec = {
      program: "claude",
      args: ["--help"],
      cwd: "C:\\Users\\guilh",
      env: { CLAUDE_CONFIG_DIR: "C:\\perfil" },
    };

    const requestPromise = fake.readRequest();
    const sessionId = client.spawnTerminal(80, 24, spec);
    const request = await requestPromise;
    expect(request.params).toEqual({ cols: 80, rows: 24, ...spec });
    fake.reply(
      JSON.stringify({ id: request.id, result: { sessionId: 3 }, error: null }),
    );

    await expect(sessionId).resolves.toBe(3);
  });

  it("spawnTerminal rejeita resultado sem sessionId numérico", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const requestPromise = fake.readRequest();
    const sessionId = client.spawnTerminal(80, 24);
    const request = await requestPromise;
    fake.reply(JSON.stringify({ id: request.id, result: {}, error: null }));

    await expect(sessionId).rejects.toThrow("resultado de pty.spawn inválido");
  });

  it("writeTerminal envia o texto como base64", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const requestPromise = fake.readRequest();
    const write = client.writeTerminal(7, "echo oi\r");
    const request = await requestPromise;
    expect(request).toMatchObject({
      method: "pty.write",
      params: {
        sessionId: 7,
        data: Buffer.from("echo oi\r", "utf8").toString("base64"),
      },
    });
    fake.reply(JSON.stringify({ id: request.id, result: null, error: null }));

    await expect(write).resolves.toBeUndefined();
  });

  it("resizeTerminal e killTerminal enviam os parâmetros corretos", async () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);

    const resizeRequest = fake.readRequest();
    const resize = client.resizeTerminal(7, 100, 30);
    const resizeWritten = await resizeRequest;
    expect(resizeWritten).toMatchObject({
      method: "pty.resize",
      params: { sessionId: 7, cols: 100, rows: 30 },
    });
    fake.reply(
      JSON.stringify({ id: resizeWritten.id, result: null, error: null }),
    );
    await resize;

    const killRequest = fake.readRequest();
    const kill = client.killTerminal(7);
    const killWritten = await killRequest;
    expect(killWritten).toMatchObject({
      method: "pty.kill",
      params: { sessionId: 7 },
    });
    fake.reply(
      JSON.stringify({ id: killWritten.id, result: null, error: null }),
    );
    await kill;
  });

  it("entrega eventos pty.output aos ouvintes sem resolver nenhuma requisição", () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);
    const received: unknown[] = [];
    client.onEvent((event) => received.push(event));

    fake.reply('{"event":"pty.output","sessionId":7,"data":"b2k="}');

    expect(received).toEqual([
      { event: "pty.output", sessionId: 7, data: "b2k=" },
    ]);
  });

  it("onEvent devolve função que cancela a assinatura", () => {
    const fake = new FakeSidecar();
    const client = new SidecarClient(fake);
    const received: unknown[] = [];
    const unsubscribe = client.onEvent((event) => received.push(event));

    unsubscribe();
    fake.reply('{"event":"pty.exit","sessionId":7,"code":0}');

    expect(received).toEqual([]);
  });
});
