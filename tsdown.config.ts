import { defineConfig } from "tsdown";

// Node-compatible ESM in dist/, types alongside. Dependencies stay external: the whole point of
// this tool is to reflect the consumer's installed alchemy, so bundling a copy would defeat it.
export default defineConfig({
  entry: { index: "index.ts", cli: "src/cli.ts", vitest: "src/vitest.ts" },
  format: "esm",
  platform: "node",
  dts: true,
  clean: true,
  outDir: "dist",
  // `import pkg from "../package.json"` is inlined, so dist/ needs no sibling package.json.
  unbundle: true,
});
