import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  APP_STATE_VERSION,
  emptyAppState,
  loadAppState,
  parseAppState,
  saveAppState,
  type AppState,
} from "./app-state";

const sample: AppState = {
  version: APP_STATE_VERSION,
  projects: [{ id: "p1", name: "Luna", path: "C:\\dev\\luna" }],
  conversations: [
    {
      id: "c1",
      title: "Primeira",
      projectId: "p1",
      sessionId: "sessao-1",
      settings: { mode: "ask", model: "opus", effort: "high", planning: true },
      hidden: false,
    },
  ],
};

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "luna-state-"));
  file = path.join(directory, "luna-state.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

describe("parseAppState", () => {
  it("aceita o estado salvo sem alterar nada", () => {
    expect(parseAppState(JSON.parse(JSON.stringify(sample)))).toEqual(sample);
  });

  it("recusa versão desconhecida", () => {
    expect(() => parseAppState({ ...sample, version: 99 })).toThrow(
      "versão de estado não suportada",
    );
  });

  it("recusa modo de permissão inválido", () => {
    const broken = structuredClone(sample);
    (broken.conversations[0].settings as { mode: string }).mode = "root";

    expect(() => parseAppState(broken)).toThrow("settings.mode inválido");
  });

  it("recusa projeto sem caminho", () => {
    const broken = structuredClone(sample) as unknown as {
      projects: Array<{ path?: string }>;
    };
    delete broken.projects[0].path;

    expect(() => parseAppState(broken)).toThrow("projeto.path");
  });

  it("recusa conversa oculta que não é booleana", () => {
    const broken = structuredClone(sample) as unknown as {
      conversations: Array<{ hidden: unknown }>;
    };
    broken.conversations[0].hidden = "não";

    expect(() => parseAppState(broken)).toThrow("conversa.hidden");
  });
});

describe("loadAppState", () => {
  it("arquivo ausente vira estado vazio", async () => {
    await expect(loadAppState(file)).resolves.toEqual(emptyAppState());
  });

  it("guarda e recarrega o mesmo estado", async () => {
    await saveAppState(file, sample);

    await expect(loadAppState(file)).resolves.toEqual(sample);
    await expect(fs.access(`${file}.tmp`)).rejects.toThrow();
  });

  it("arquivo corrompido é posto de lado, não apagado, e o erro é reportado", async () => {
    await fs.writeFile(file, "{ isto não é json", "utf8");
    const onCorrupt = vi.fn();

    const state = await loadAppState(file, onCorrupt);

    expect(state).toEqual(emptyAppState());
    expect(onCorrupt).toHaveBeenCalledOnce();
    const kept = (await fs.readdir(directory)).filter((name) =>
      name.startsWith("luna-state.json.corrompido-"),
    );
    expect(kept).toHaveLength(1);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("formato inválido também é posto de lado", async () => {
    await fs.writeFile(file, JSON.stringify({ version: 1 }), "utf8");
    const onCorrupt = vi.fn();

    await loadAppState(file, onCorrupt);

    expect(onCorrupt).toHaveBeenCalledOnce();
  });
});
