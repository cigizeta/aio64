import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// The widget loads Stockfish.js from unpkg at the installed version, so the
// CDN always serves the same build as the server's fallback.
const stockfishVersion = (
  JSON.parse(readFileSync(createRequire(import.meta.url).resolve("stockfish/package.json"), "utf8")) as {
    version: string;
  }
).version;

// Aio64's own version (CalVer, YYYY.M.MICRO), kept only in package.json.
const aio64Version = (
  JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }
).version;

// Builds the board widget into one self-contained dist/board.html: the
// widget iframe's CSP blocks undeclared origins, so JS and CSS (including
// chessground's piece images, which are data URIs) must all be inline.
export default defineConfig({
  root: "widget",
  plugins: [viteSingleFile()],
  define: {
    __STOCKFISH_VERSION__: JSON.stringify(stockfishVersion),
    __AIO64_VERSION__: JSON.stringify(aio64Version),
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL("./widget/board.html", import.meta.url)),
    },
  },
});
