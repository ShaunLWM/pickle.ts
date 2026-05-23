import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  dts: true,
  minify: true,
  sourcemap: true,
  clean: true,
  external: ["socket.io-client", "socket.io-msgpack-parser"],
});
