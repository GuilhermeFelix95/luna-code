/// <reference types="vite/client" />

import type { ChatBridge } from "../src/chat-api";
import type { StateBridge } from "../src/state-api";
import type { TerminalBridge } from "../src/terminal-api";

declare global {
  interface Window {
    terminal: TerminalBridge;
    chat: ChatBridge;
    state: StateBridge;
  }
}
