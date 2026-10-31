import { defineConfig, type Plugin } from "vite";

// O Electron carrega a página por file://. Scripts `type="module"` e `crossorigin`
// falham nesse protocolo. O bundle não tem import/export, então roda como script clássico com `defer`.
const fileProtocolFriendlyHtml: Plugin = {
  name: "file-protocol-friendly-html",
  enforce: "post",
  transformIndexHtml(html) {
    return html
      .replace(/<script([^>]*)>/g, (_tag, attributes: string) => {
        const cleaned = attributes
          .replace(/ type="module"/g, "")
          .replace(/ crossorigin/g, "");
        return `<script defer${cleaned}>`;
      })
      .replace(/ crossorigin/g, "");
  },
};

export default defineConfig({
  root: "renderer-src",
  base: "./",
  plugins: [fileProtocolFriendlyHtml],
  build: {
    outDir: "../renderer",
    emptyOutDir: true,
    modulePreload: false,
    rollupOptions: {
      output: { format: "es" },
    },
  },
});
