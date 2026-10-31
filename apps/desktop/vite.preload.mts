import { defineConfig } from "vite";

// Preload em modo sandbox não pode dar require em arquivos relativos.
// Por isso ele é empacotado em um único arquivo CommonJS, com `electron` externo.
export default defineConfig({
  build: {
    ssr: "src/preload.ts",
    outDir: "dist",
    emptyOutDir: false,
    rollupOptions: {
      external: ["electron"],
      output: { format: "cjs", entryFileNames: "preload.js" },
    },
  },
});
