import { defineConfig } from "vitest/config";

// Separado do vite.config.mts, que aponta a raiz para o renderer.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "renderer-src/**/*.test.ts"],
  },
});
