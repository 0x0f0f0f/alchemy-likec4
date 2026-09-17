/**
 * alchemy annotates its resources with a curated `@category` JSDoc tag — 15 groups for
 * Cloudflare (Workers & Compute, Storage & Databases, Email, …). That taxonomy is better than
 * any namespace heuristic we could invent, so styling reads it rather than guessing.
 *
 * This is the one place the package reads source rather than reflecting, and it is deliberately
 * limited to DECORATION. A category that fails to resolve costs a default style; it can never
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

interface SourceFile {
  readonly text: string;
  readonly category: string;
}

/** Every `.ts` under `dir` that carries an `@category`, with its text for declaration lookup. */
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
        if (category) out.push({ text, category });
      }
    }
  };
  walk(dir);
  return out;
};

/**
 * Map canonical resource type → alchemy's own `@category`.
 *
 * @param sourceDir the provider's source root, e.g. `node_modules/alchemy/src/Cloudflare`
 * @param types the canonical ids to resolve
 */
export const categoriesFor = (sourceDir: string, types: readonly string[]): ReadonlyMap<string, string> => {
  const files = readAnnotatedSources(sourceDir);
  const map = new Map<string, string>();
  for (const type of types) {
    const declaring = files.find((f) => f.text.includes(`"${type}"`));
    if (declaring) map.set(type, declaring.category);
  }
  return map;
};
