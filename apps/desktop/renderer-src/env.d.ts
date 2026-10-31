/// <reference types="vite/client" />

import type { TerminalBridge } from "../src/terminal-api";

declare global {
  interface Window {
    terminal: TerminalBridge;
  }
}
