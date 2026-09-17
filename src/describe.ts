/**
 * Read the user's own prose for each resource from the JSDoc above it in their stack.
 *
 * `extend` cannot add a `description` to an element (verified against likec4 1.59.3: it accepts
 * tags, links, metadata and relationships, and rejects description, technology, title, style and
 * icon). So a generated element's description has to come from the generator, and the only place
 * the user can write it without editing a generated file is next to the resource itself:
 *
 *   /** The only thing on the request path a visitor waits for. *\/
 *   const redirect = yield* Cloudflare.Worker("redirect", { ... });
 *
 * Keyed on the logical id — the first argument — which is the same key the compiled stack uses.
 * Decoration only: a resource with no JSDoc simply has no description.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

/** A JSDoc block, then an optional binding, then `yield* Something("<logicalId>"`. */
const DESCRIBED = /\/\*\*([\s\S]*?)\*\/\s*(?:(?:const|let|var)\s+\w+\s*=\s*)?yield\*\s*[\w.]+\(\s*["']([^"']+)["']/g;

/** JSDoc body → one line of prose. Tag lines are metadata, not description. */
const prose = (block: string): string =>
  block
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^\*+\s?/, "")
        .trim(),
    )
    .filter((line) => line.length > 0 && !line.startsWith("@"))
    .join(" ")
    .trim();

/** Every `.ts` under `dir`, skipping the places a stack never declares resources. */
const sources = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".alchemy" || entry.startsWith(".")) continue;
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts")) out.push(path);
    }
  };
  walk(dir);
  return out;
};

/**
 * Map logical id → the prose above its declaration.
 *
 * @param entrypoint the stack entrypoint; its whole directory tree is scanned, because alchemy's
 *   own file-layout guidance is one file per resource
 */
export const descriptionsFor = (entrypoint: string): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const path of sources(dirname(entrypoint))) {
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const [, block, logicalId] of text.matchAll(DESCRIBED)) {
      const description = prose(block as string);
      // First wins, so a resource declared once keeps its own prose even if an id repeats.
      if (description && !map.has(logicalId as string)) map.set(logicalId as string, description);
    }
  }
  return map;
};
