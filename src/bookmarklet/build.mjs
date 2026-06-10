import { buildSync } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const input = join(dir, "cpjourney-sniffer.js");
const outMin = join(dir, "cpjourney-sniffer.min.js");
const outBookmarklet = join(dir, "cpjourney-sniffer.bookmarklet.txt");

buildSync({
  entryPoints: [input],
  outfile: outMin,
  bundle: false,
  minify: true,
  format: "iife",
  target: "es2020",
  platform: "browser",
});

const minified = readFileSync(outMin, "utf8");
const bookmarklet = "javascript:" + encodeURIComponent(minified);

writeFileSync(outBookmarklet, bookmarklet);

console.log("Built:", outMin);
console.log("Bookmarklet:", outBookmarklet);
console.log("Bookmarklet size:", bookmarklet.length, "chars");
