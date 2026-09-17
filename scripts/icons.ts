#!/usr/bin/env bun
/**
 * Generate `src/icons.gen.ts` from the icon sets @likec4/icons ships.
 *
 * The alternative is a hand-written table of one entry per alchemy resource, which would be 1057
 * lines that rot on every likec4 bump. Reading the directory listing is the same information,
 * derived. @likec4/icons stays a devDependency: only the names ship, not the 26MB of SVG.
 *
 * Run with `bun run build:icons`. The output is committed and snapshot-tested.
 */
import { readdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PACKS = ["aws", "gcp", "azure", "tech"] as const;

const iconsDir = dirname(fileURLToPath(import.meta.resolve("@likec4/icons/package.json")));

const index = Object.fromEntries(
  PACKS.map((pack) => [
    pack,
    readdirSync(`${iconsDir}/${pack}`)
      .filter((f) => f.endsWith(".js") && f !== "index.js")
      .map((f) => f.replace(/\.js$/, ""))
      .sort(),
  ]),
);

const counts = PACKS.map((p) => `${p} ${(index[p] as string[]).length}`).join(", ");
const body = `/**
 * GENERATED — DO NOT EDIT.  Regenerate with:  bun run build:icons
 *
 * Every icon name @likec4/icons ships, per pack (${counts}). A LikeC4 icon id is \`<pack>:<name>\`.
 * \`iconFor\` in icons.ts indexes these by name normalised to alphanumerics, so \`DynamoDB\` finds
 * \`dynamo-db\`.
 */
export const ICON_NAMES: Record<string, readonly string[]> = ${JSON.stringify(index)};
`;

await Bun.write(`${import.meta.dirname}/../src/icons.gen.ts`, body);
console.log(`src/icons.gen.ts: ${counts}`);
