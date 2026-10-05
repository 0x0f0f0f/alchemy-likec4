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
 *
 * Other files name a type too, to test for it: `Queues/Subscription.ts` holds
 * `isSourceResource(source, "Cloudflare.R2.Bucket")`. A declaration takes many forms —
 * `Resource<X>("T")`, `const TypeId = "T"`, `Resource<"T", …>` — but never passes the type as
 * a later argument of a call, and that is how such a test always passes it. So when several files
 * name a type, the ones that only ever name it that way are dropped.
 *
 * And the literal is not always in the declaring file: `Workers/WorkerRuntime.ts` exports
 * `WorkerTypeId = "Cloudflare.Worker"` and `Workers/Worker.ts` declares `Platform(WorkerTypeId, …)`.
 * A file that imports such a constant names the type through it.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "oxc-parser";

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
  readonly path: string;
  readonly text: string;
}

/** Every `.ts` under `dir`, with its text for lookup and whatever it annotates. */
const readSources = (dir: string): SourceFile[] => {
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
        out.push({ path, text, category, product });
      }
    }
  };
  walk(dir);
  return out;
};

/** Minimal shape of the ESTree nodes read here; oxc returns far more. */
interface Node {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** Top-level statements, parsed once per file and only for files that need it. */
const bodies = new WeakMap<SourceFile, readonly Node[]>();
const bodyOf = (file: SourceFile): readonly Node[] => {
  let body = bodies.get(file);
  if (!body) {
    body = parseSync(file.path, file.text).program.body as unknown as Node[];
    bodies.set(file, body);
  }
  return body;
};

/** `export const X = "<type>"` in `file` → `X`. */
const aliasesIn = (file: SourceFile, type: string): string[] =>
  bodyOf(file).flatMap((stmt) => {
    const decl = stmt.type === "ExportNamedDeclaration" ? (stmt.declaration as Node | null) : null;
    if (decl?.type !== "VariableDeclaration") return [];
    return (decl.declarations as Node[]).flatMap((d) => {
      const id = d.id as Node;
      const init = d.init as Node | null;
      return id.type === "Identifier" && init?.type === "Literal" && init.value === type ? [id.name as string] : [];
    });
  });

/** Whether `file` imports any of `names`. */
const imports = (file: SourceFile, names: readonly string[]): boolean =>
  names.some((name) => file.text.includes(name)) &&
  bodyOf(file).some(
    (stmt) =>
      stmt.type === "ImportDeclaration" &&
      (stmt.specifiers as Node[]).some(
        (s) => s.type === "ImportSpecifier" && names.includes((s.imported as Node).name as string),
      ),
  );

/** Every mention of the type — its literal or an alias of it — and how many sit at argument 2+
 *  of a call. Imports are skipped: naming a constant to import it says nothing about its use. */
const mentions = (node: unknown, isType: (n: Node) => boolean, count = { all: 0, laterArg: 0 }): typeof count => {
  if (!node || typeof node !== "object") return count;
  if (Array.isArray(node)) {
    for (const child of node) mentions(child, isType, count);
    return count;
  }
  const n = node as Node;
  if (n.type === "ImportDeclaration") return count;
  if (isType(n)) count.all++;
  if (n.type === "CallExpression")
    for (const arg of (n.arguments as Node[]).slice(1)) if (isType(arg)) count.laterArg++;
  for (const [key, child] of Object.entries(n)) if (key !== "type") mentions(child, isType, count);
  return count;
};

/** Whether `file` names `type` anywhere other than as a later argument of a call. */
const declares = (file: SourceFile, type: string, aliases: readonly string[]): boolean => {
  const isType = (n: Node): boolean =>
    (n.type === "Literal" && n.value === type) || (n.type === "Identifier" && aliases.includes(n.name as string));
  const { all, laterArg } = mentions(bodyOf(file), isType);
  return all > laterArg;
};

/**
 * Map canonical resource type → the annotations on its declaring file.
 *
 * @param sourceDir the provider's source root, e.g. `node_modules/alchemy/src/Cloudflare`
 * @param types the canonical ids to resolve
 */
export const annotationsFor = (sourceDir: string, types: readonly string[]): ReadonlyMap<string, Annotations> => {
  const files = readSources(sourceDir);
  const annotated = files.filter((f) => f.category || f.product);
  const map = new Map<string, Annotations>();
  for (const type of types) {
    const literal = `"${type}"`;
    const aliases = files.filter((f) => f.text.includes(literal)).flatMap((f) => aliasesIn(f, type));
    const named = annotated.filter((f) => f.text.includes(literal) || imports(f, aliases));
    const declaring = named.length > 1 ? (named.find((f) => declares(f, type, aliases)) ?? named[0]) : named[0];
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
