import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { toHistoryMessages } from "./history";

/** Mensagens gravadas pelo SDK têm mais campos; o teste só fornece os que a conversão lê. */
function sessionMessage(value: unknown): SessionMessage {
  return value as SessionMessage;
}

describe("toHistoryMessages", () => {
  it("mantém texto do usuário e do assistente, na ordem gravada", () => {
    const history = toHistoryMessages([
      sessionMessage({
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: "  oi  " },
      }),
      sessionMessage({
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "olá" },
            { type: "tool_use", id: "t1", name: "Glob", input: {} },
            { type: "text", text: "tudo bem?" },
          ],
        },
      }),
    ]);

    expect(history).toEqual([
      { role: "user", text: "oi" },
      { role: "assistant", text: "olá\ntudo bem?" },
    ]);
  });

  it("deixa de fora resultados de ferramenta, sistema e mensagens de subagente", () => {
    const history = toHistoryMessages([
      sessionMessage({
        type: "user",
        parent_tool_use_id: null,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "t1" }],
        },
      }),
      sessionMessage({ type: "system", parent_tool_use_id: null, message: {} }),
      sessionMessage({
        type: "assistant",
        parent_tool_use_id: "t1",
        message: { content: [{ type: "text", text: "interno" }] },
      }),
    ]);

    expect(history).toEqual([]);
  });
});
