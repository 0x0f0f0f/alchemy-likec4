#!/usr/bin/env bun
/**
 * Generate a LikeC4 specification from alchemy's resource registry.
 *
 *   bun run index.ts [--out cloudflare.spec.c4] [--no-styles] [--no-relationships]
 */
import * as Cloudflare from "alchemy/Cloudflare";
import { extractResources } from "./src/extract.ts";
import { emitSpecification } from "./src/emit.ts";

const arg = (flag: string, fallback: string): string => {
  const i = Bun.argv.indexOf(flag);
  return i !== -1 && Bun.argv[i + 1] ? (Bun.argv[i + 1] as string) : fallback;
};
const has = (flag: string) => Bun.argv.includes(flag);

const alchemyVersion: string = (
  await Bun.file(new URL("./node_modules/alchemy/package.json", import.meta.url)).json()
).version;

const resources = extractResources(Cloudflare);

const dsl = emitSpecification(resources, {
  alchemyVersion,
  provider: "Cloudflare",
  includeStyles: !has("--no-styles"),
  includeRelationships: !has("--no-relationships"),
});

const out = arg("--out", "cloudflare.spec.c4");
await Bun.write(out, dsl);

console.log(`${resources.length} resources → ${out}  (alchemy@${alchemyVersion})`);
