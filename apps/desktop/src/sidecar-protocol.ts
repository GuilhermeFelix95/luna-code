export interface SidecarRequest {
  id: number;
  method: string;
}

export interface SidecarResponse {
  id: number | null;
  result: string | null;
  error: string | null;
}

export function encodeRequest(request: SidecarRequest): string {
  return JSON.stringify(request);
}

// Valida a linha vinda do processo Rust antes de confiar nos campos.
export function decodeResponse(line: string): SidecarResponse {
  const value: unknown = JSON.parse(line);
  if (typeof value !== "object" || value === null) {
    throw new Error("resposta do sidecar não é um objeto");
  }

  const { id, result, error } = value as Record<string, unknown>;
  if (id !== null && typeof id !== "number") {
    throw new Error("campo id da resposta do sidecar é inválido");
  }
  if (result !== null && typeof result !== "string") {
    throw new Error("campo result da resposta do sidecar é inválido");
  }
  if (error !== null && typeof error !== "string") {
    throw new Error("campo error da resposta do sidecar é inválido");
  }

  return { id, result, error };
}
