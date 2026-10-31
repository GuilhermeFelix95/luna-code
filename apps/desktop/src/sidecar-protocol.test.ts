import { describe, expect, it } from "vitest";
import { decodeResponse, encodeRequest } from "./sidecar-protocol";

describe("encodeRequest", () => {
  it("serializa a requisição em JSON", () => {
    expect(encodeRequest({ id: 4, method: "ping" })).toBe(
      '{"id":4,"method":"ping"}',
    );
  });
});

describe("decodeResponse", () => {
  it("aceita resposta válida de sucesso", () => {
    expect(decodeResponse('{"id":1,"result":"pong","error":null}')).toEqual({
      id: 1,
      result: "pong",
      error: null,
    });
  });

  it("aceita resposta de erro sem id", () => {
    expect(decodeResponse('{"id":null,"result":null,"error":"x"}')).toEqual({
      id: null,
      result: null,
      error: "x",
    });
  });

  it("rejeita valor que não é objeto", () => {
    expect(() => decodeResponse("42")).toThrow("não é um objeto");
  });

  it("rejeita id com tipo errado", () => {
    expect(() =>
      decodeResponse('{"id":"1","result":"pong","error":null}'),
    ).toThrow("campo id");
  });

  it("rejeita JSON malformado", () => {
    expect(() => decodeResponse("{")).toThrow();
  });
});
