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
 * Resources are matched to their declaring file by the canonical `.Type` string, not by guessing a
 * path from the export name. Guessing the path resolves 205/241; finding the declaration resolves
 * them all — export names and file names diverge often enough (`Alerting.NotificationWebhook`
 * declares `Cloudflare.Alerting.Webhook`) that it matters. The declaration passes the type as a
 * call's FIRST argument (`Resource<Bucket>("Cloudflare.R2.Bucket")`), either as the literal or as a
 * const bound to it (`Platform(WorkerTypeId, …)`); other files name it only to test a value
 * (`isSourceResource(source, "Cloudflare.R2.Bucket")`), which is not a declaration.
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
  /** Every `const NAME = "…"` this file binds, so a file-local `TypeId` resolves only here. */
  readonly consts: ReadonlyMap<string, string>;
}

/** `const WorkerTypeId = "Cloudflare.Worker"`: a type id bound to a name, for the first-argument test. */
const TYPE_CONST = /\b(export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*"([^"]+)"/g;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every annotated `.ts` under `dir`, and every exported `const NAME = "…"` anywhere under it. */
const readSources = (dir: string): { files: SourceFile[]; exported: Map<string, string> } => {
  const files: SourceFile[] = [];
  const exported = new Map<string, string>();
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
        const consts = new Map<string, string>();
        for (const [, isExported, name, value] of text.matchAll(TYPE_CONST)) {
          if (!name || value === undefined) continue;
          consts.set(name, value);
          if (isExported) exported.set(name, value);
        }
        const category = text.match(CATEGORY)?.[1]?.trim();
        const product = text.match(PRODUCT)?.[1]?.trim();
        if (category || product) files.push({ text, consts, category, product });
      }
    }
  };
  walk(dir);
  return { files, exported };
};

/**
 * Map canonical resource type → the annotations on its declaring file.
 *
 * @param sourceDir the provider's source root, e.g. `node_modules/alchemy/src/Cloudflare`
 * @param types the canonical ids to resolve
 */
export const annotationsFor = (sourceDir: string, types: readonly string[]): ReadonlyMap<string, Annotations> => {
  const { files, exported } = readSources(sourceDir);
  const map = new Map<string, Annotations>();
  for (const type of types) {
    const declares = (f: SourceFile): boolean => {
      // A name means `type` here if this file binds it so, or imports an export that does.
      const bound = (name: string, value: string): boolean => (f.consts.get(name) ?? value) === type;
      const names = [
        ...[...f.consts].filter(([, v]) => v === type).map(([n]) => n),
        ...[...exported].filter(([n, v]) => v === type && bound(n, v)).map(([n]) => n),
      ];
      const alternatives = [`"${escapeRegExp(type)}"`, ...names.map((n) => `${escapeRegExp(n)}\\b`)];
      return new RegExp(`\\(\\s*(?:${alternatives.join("|")})\\s*[,)]`).test(f.text);
    };
    // Failing a declaration, the file that names the literal: `Platform("Cloudflare.Container", …)`
    // sits in an unannotated file beside the `Container.ts` that binds `ContainerTypeId`.
    const declaring = files.find(declares) ?? files.find((f) => f.text.includes(`"${type}"`));
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
