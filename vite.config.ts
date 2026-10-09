import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// Builds the board widget into one self-contained dist/board.html: the
// widget iframe's CSP blocks undeclared origins, so JS and CSS (including
// chessground's piece images, which are data URIs) must all be inline.
export default defineConfig({
  root: "widget",
  plugins: [viteSingleFile()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./widget/board.html", import.meta.url)),
    },
  },
});
