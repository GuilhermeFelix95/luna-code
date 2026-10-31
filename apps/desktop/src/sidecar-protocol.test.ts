import { describe, expect, it } from "vitest";
import { decodeMessage, encodeRequest } from "./sidecar-protocol";

describe("encodeRequest", () => {
  it("serializa a requisição sem params quando não há parâmetros", () => {
    expect(encodeRequest({ id: 4, method: "ping" })).toBe(
      '{"id":4,"method":"ping"}',
    );
  });

  it("serializa os params junto com a requisição", () => {
    expect(
      encodeRequest({
        id: 5,
        method: "pty.spawn",
        params: { cols: 80, rows: 24 },
      }),
    ).toBe('{"id":5,"method":"pty.spawn","params":{"cols":80,"rows":24}}');
  });
});

describe("decodeMessage de resposta", () => {
  it("aceita resposta de sucesso com resultado de qualquer tipo", () => {
    expect(
      decodeMessage('{"id":1,"result":{"sessionId":2},"error":null}'),
    ).toEqual({
      kind: "response",
      response: { id: 1, result: { sessionId: 2 }, error: null },
    });
  });

  it("aceita resposta de erro sem id", () => {
    expect(decodeMessage('{"id":null,"result":null,"error":"x"}')).toEqual({
      kind: "response",
      response: { id: null, result: null, error: "x" },
    });
  });

  it("rejeita id com tipo errado", () => {
    expect(() =>
      decodeMessage('{"id":"1","result":"pong","error":null}'),
    ).toThrow("campo id");
  });

  it("rejeita error com tipo errado", () => {
    expect(() => decodeMessage('{"id":1,"result":null,"error":5}')).toThrow(
      "campo error",
    );
  });
});

describe("decodeMessage de evento", () => {
  it("decodifica pty.output", () => {
    expect(
      decodeMessage('{"event":"pty.output","sessionId":3,"data":"b2k="}'),
    ).toEqual({
      kind: "event",
      event: { event: "pty.output", sessionId: 3, data: "b2k=" },
    });
  });

  it("aceita pty.exit sem código de saída", () => {
    expect(
      decodeMessage('{"event":"pty.exit","sessionId":3,"code":null}'),
    ).toEqual({
      kind: "event",
      event: { event: "pty.exit", sessionId: 3, code: null },
    });
  });

  it("rejeita evento sem sessionId", () => {
    expect(() => decodeMessage('{"event":"pty.exit","code":0}')).toThrow(
      "campo sessionId",
    );
  });

  it("rejeita pty.output sem data string", () => {
    expect(() =>
      decodeMessage('{"event":"pty.output","sessionId":1,"data":3}'),
    ).toThrow("campo data");
  });

  it("rejeita evento desconhecido", () => {
    expect(() => decodeMessage('{"event":"outro","sessionId":1}')).toThrow(
      "evento desconhecido",
    );
  });
});

describe("decodeMessage de entrada inválida", () => {
  it("rejeita valor que não é objeto", () => {
    expect(() => decodeMessage("42")).toThrow("não é um objeto");
  });

  it("rejeita JSON malformado", () => {
    expect(() => decodeMessage("{")).toThrow();
  });
});
