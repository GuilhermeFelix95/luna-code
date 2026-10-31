import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATE_CHANNELS } from "./state-api";
import {
  isPersonalFolder,
  registerStateIpc,
  type PickFolder,
  type StateBook,
} from "./state-ipc";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

let directory: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "luna-state-ipc-"));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5 });
});

function fakeIpc(): {
  handle: (channel: string, handler: Handler) => void;
  call: (channel: string, ...args: unknown[]) => unknown;
} {
  const handlers = new Map<string, Handler>();
  return {
    handle: (channel, handler) => handlers.set(channel, handler),
    call: (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`canal não registrado: ${channel}`);
      }
      return handler({}, ...args);
    },
  };
}

function fakeBook(): StateBook {
  return {
    snapshot: vi.fn(() => ({ projects: [], conversations: [] })),
    addProject: vi.fn((folder: string) => ({
      id: "projeto-1",
      name: path.basename(folder),
      path: folder,
    })),
    removeProject: vi.fn(),
    createConversation: vi.fn((projectId: string) => ({
      id: "conversa-1",
      title: "Nova conversa",
      projectId,
      settings: { mode: "readonly" as const },
      hidden: false,
    })),
    hideConversation: vi.fn(),
  };
}

const NO_PICK: PickFolder = async () => null;

describe("registerStateIpc", () => {
  it("adiciona uma pasta existente como projeto", async () => {
    const ipc = fakeIpc();
    const book = fakeBook();
    registerStateIpc(ipc as never, book, NO_PICK);

    const project = await ipc.call(STATE_CHANNELS.addProject, directory);

    expect(book.addProject).toHaveBeenCalledWith(path.resolve(directory));
    expect(project).toMatchObject({ id: "projeto-1" });
  });

  it("recusa caminho relativo para projeto", async () => {
    const ipc = fakeIpc();
    registerStateIpc(ipc as never, fakeBook(), NO_PICK);

    await expect(
      ipc.call(STATE_CHANNELS.addProject, "pasta/relativa"),
    ).rejects.toThrow("caminho absoluto");
  });

  it("recusa arquivo no lugar de pasta", async () => {
    const ipc = fakeIpc();
    const file = path.join(directory, "arquivo.txt");
    await fs.writeFile(file, "x");
    registerStateIpc(ipc as never, fakeBook(), NO_PICK);

    await expect(ipc.call(STATE_CHANNELS.addProject, file)).rejects.toThrow(
      "precisa ser uma pasta",
    );
  });

  it("recusa pasta que não existe", async () => {
    const ipc = fakeIpc();
    registerStateIpc(ipc as never, fakeBook(), NO_PICK);

    await expect(
      ipc.call(STATE_CHANNELS.addProject, path.join(directory, "sumiu")),
    ).rejects.toThrow();
  });

  it("devolve a pasta escolhida no seletor, com o aviso de pasta pessoal", async () => {
    const ipc = fakeIpc();
    const picked = { path: os.homedir(), personal: true };
    registerStateIpc(ipc as never, fakeBook(), async () => picked);

    await expect(ipc.call(STATE_CHANNELS.pickProject)).resolves.toEqual(picked);
  });

  it("valida ids antes de remover, criar ou excluir", () => {
    const ipc = fakeIpc();
    const book = fakeBook();
    registerStateIpc(ipc as never, book, NO_PICK);

    expect(() => ipc.call(STATE_CHANNELS.removeProject, "")).toThrow(
      "projectId deve ser texto",
    );
    expect(() => ipc.call(STATE_CHANNELS.createConversation, 42)).toThrow(
      "projectId deve ser texto",
    );
    expect(() =>
      ipc.call(STATE_CHANNELS.deleteConversation, "x".repeat(65)),
    ).toThrow("conversationId deve ser texto");
    expect(book.removeProject).not.toHaveBeenCalled();
    expect(book.createConversation).not.toHaveBeenCalled();
    expect(book.hideConversation).not.toHaveBeenCalled();
  });

  it("exclusão de conversa só pede ao armazenamento para ocultar", () => {
    const ipc = fakeIpc();
    const book = fakeBook();
    registerStateIpc(ipc as never, book, NO_PICK);

    ipc.call(STATE_CHANNELS.deleteConversation, "conversa-1");

    expect(book.hideConversation).toHaveBeenCalledWith("conversa-1");
  });
});

describe("isPersonalFolder", () => {
  it("reconhece a pasta pessoal, mas não as pastas dentro dela", () => {
    expect(isPersonalFolder(os.homedir(), os.homedir())).toBe(true);
    expect(
      isPersonalFolder(path.join(os.homedir(), "projeto"), os.homedir()),
    ).toBe(false);
  });
});
