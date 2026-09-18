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

/** A JSDoc block, then an optional binding or `return`, then `yield* Something("<logicalId>"`.
 *  `return yield* …` is how a resource declared inside a branch reaches the stack, so it carries
 *  prose as often as a bound one does. A binding written inline in another resource's `env` —
 *  `Cloudflare.Container("Hub", …)` — has no `yield*` and is not matched: requiring it is what
 *  keeps this from claiming the JSDoc above any call whose first argument is a string. */
const DESCRIBED =
  /\/\*\*([\s\S]*?)\*\/\s*(?:(?:const|let|var)\s+\w+\s*=\s*|return\s+)?yield\*\s*[\w.]+\(\s*["']([^"']+)["']/g;

/** The JSDoc above `export default Alchemy.Stack("<name>"`. A stack is not yielded, so `DESCRIBED`
 *  never sees it and the stack's own box was the one element with no prose of its own. */
const STACK = /\/\*\*([\s\S]*?)\*\/\s*export default\s+[\w.]+\(\s*["']([^"']+)["']/;

/** `@icon tech:foo` / `@color blue` on a JSDoc block. The stack is a box a reader clicks, so it is
 *  worth telling apart from its neighbours — and only the author of the stack knows how. */
const tag = (block: string, name: string): string | undefined =>
  new RegExp(`^\\s*\\*?\\s*@${name}\\s+(\\S+)`, "m").exec(block)?.[1];

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

/** What a stack says about itself, from the JSDoc above its own declaration. */
export interface StackProse {
  readonly description?: string;
  /** `@icon`, any icon LikeC4 bundles — `tech:cloudflare-workers-icon`. */
  readonly icon?: string;
  /** `@color`, a theme colour or one declared in the consumer's own specification. */
  readonly color?: string;
}

/** The stack's own prose and styling. Only the entrypoint declares the stack, so only it is read. */
export const stackProse = (entrypoint: string): StackProse => {
  let text: string;
  try {
    text = readFileSync(entrypoint, "utf8");
  } catch {
    return {};
  }
  const block = STACK.exec(text)?.[1];
  if (block === undefined) return {};
  const description = prose(block);
  return {
    ...(description ? { description } : {}),
    ...(tag(block, "icon") ? { icon: tag(block, "icon") } : {}),
    ...(tag(block, "color") ? { color: tag(block, "color") } : {}),
  };
};
