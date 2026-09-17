/**
 * alchemy annotates its resources with JSDoc tags we can read rather than guess:
 *
 *   @category  15 curated groups for Cloudflare (Workers & Compute, Storage & Databases, …)
 *   @product   104 distinct product names (R2, D1, Queues) — the `technology` label
 *
 * `@see` is deliberately not read. It is the first URL in the declaring file, which is often a
 * sub-feature guide rather than the product (`Cloudflare.Worker` resolves to a
 * workers-for-platforms page), and a wrong link is worse than none. A consumer adds their own
 * with `extend <element> { link … }`.
 *
 * That taxonomy is better than any namespace heuristic we could invent, so styling reads it.
 *
 * This is the one place the package reads source rather than reflecting, and it is deliberately
 * limited to DECORATION. An annotation that fails to resolve costs a default style; it can never
 * cost a missing resource, because the resource list comes from reflection.
 *
 * Resources are matched to their declaring file by searching for the canonical `.Type` string
 * literal, not by guessing a path from the export name. Guessing the path resolves 205/241;
 * finding the declaration resolves 241/241 — export names and file names diverge often enough
 * (`Alerting.NotificationWebhook` declares `Cloudflare.Alerting.Webhook`) that it matters.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CATEGORY = /@category\s+(.+)/;
const PRODUCT = /@product\s+(.+)/;

/** What one resource's declaring file says about it. All fields optional: this is decoration. */
export interface Annotations {
  /** alchemy's `@category`, e.g. `Storage & Databases`. */
  readonly category?: string;
  /** alchemy's `@product`, e.g. `R2`. Becomes `technology`. */
  readonly product?: string;
}

interface SourceFile extends Annotations {
  readonly text: string;
}

/** Every `.ts` under `dir` that carries at least one annotation, with its text for lookup. */
const readAnnotatedSources = (dir: string): SourceFile[] => {
  const out: SourceFile[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return; // a provider whose sources are not shipped is simply unstyled
    }
    for (const entry of entries) {
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".ts")) {
        const text = readFileSync(path, "utf8");
        const category = text.match(CATEGORY)?.[1]?.trim();
        const product = text.match(PRODUCT)?.[1]?.trim();
        if (category || product) out.push({ text, category, product });
      }
    }
  };
  walk(dir);
  return out;
};

/**
 * Map canonical resource type → the annotations on its declaring file.
 *
 * @param sourceDir the provider's source root, e.g. `node_modules/alchemy/src/Cloudflare`
 * @param types the canonical ids to resolve
 */
export const annotationsFor = (sourceDir: string, types: readonly string[]): ReadonlyMap<string, Annotations> => {
  const files = readAnnotatedSources(sourceDir);
  const map = new Map<string, Annotations>();
  for (const type of types) {
    const declaring = files.find((f) => f.text.includes(`"${type}"`));
    if (declaring) map.set(type, { category: declaring.category, product: declaring.product });
  }
  return map;
};

/** Just the categories, for callers that only style by group. */
export const categoriesFor = (sourceDir: string, types: readonly string[]): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const [type, a] of annotationsFor(sourceDir, types)) if (a.category) map.set(type, a.category);
  return map;
};
