/**
 * Enumerate alchemy's resources by runtime reflection.
 *
 * Every alchemy resource carries `.Type` — the canonical id it registers itself under
 * (`R2.Bucket.Type === "Cloudflare.R2.Bucket"`). Nothing else in the namespace does: a
 * Provider, an Error or a Binding has no own properties at all. So `.Type` is both the
 * predicate and the identity, and the list cannot drift from what alchemy actually ships.
 *
 * Reflection rather than source-scanning on purpose. Resources are declared three different
 * ways in the source (`Resource<T>("id")`, `export const XTypeId = "id"`, and a bare literal),
 * and no single pattern is complete — scanning `src` finds 233, scanning `.d.ts` finds 39, and
 * each misses resources the other catches. The module object has no such problem.
 *
 * The cost is that importing `alchemy/Cloudflare` pulls the whole effect peer graph, which has
 * to be version-pinned. See `overrides` in package.json.
 */

import { dirname } from "node:path";

/** alchemy's package root, wherever the consumer's linker put it — two levels above its entry. */
export const alchemyDir = (): string => dirname(dirname(Bun.resolveSync("alchemy", process.cwd())));

/** A resource, as alchemy itself defines it. */
export interface AlchemyResource {
  /** Canonical id, e.g. `Cloudflare.R2.Bucket`. This is `.Type`. */
  readonly type: string;
  /** Provider segment, e.g. `Cloudflare`. */
  readonly provider: string;
  /** Namespace segment, e.g. `R2`. Absent for top-level resources like `Cloudflare.Worker`. */
  readonly namespace: string | undefined;
  /** Final segment, e.g. `Bucket`. */
  readonly name: string;
  /** Where it is exported from, which is NOT always the type — `Cloudflare.AI.DynamicRouting`
   *  is exported as `AI.GatewayDynamicRouting`. Kept so a reader can find it in code. */
  readonly exportPath: string;
}

/** Read a property without triggering a getter — several throw outside a request handler. */
const plain = (obj: object, key: string): unknown => {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  return d && !d.get ? d.value : undefined;
};

const isResource = (v: unknown): v is { Type: string } =>
  typeof v === "function" && typeof plain(v as object, "Type") === "string";

const split = (type: string): Pick<AlchemyResource, "provider" | "namespace" | "name"> => {
  const parts = type.split(".");
  const provider = parts[0] ?? type;
  const name = parts[parts.length - 1] ?? type;
  return { provider, namespace: parts.length > 2 ? parts.slice(1, -1).join(".") : undefined, name };
};

/** A module namespace (`[object Module]` — bun gives it a prototype, so the tag is the test) or an
 *  object literal: the two shapes a sub-namespace takes. Anything else — a Layer, a Schema, a
 *  client — is a value, not a namespace, and is not entered. */
const isNamespaceLike = (v: object): boolean =>
  Object.prototype.toString.call(v) === "[object Module]" || Object.getPrototypeOf(v) === Object.prototype;

/**
 * Walk a provider namespace and return every resource in it, sorted by canonical id.
 * Deduplicated by `.Type`, because a resource can be re-exported under several paths.
 */
export const extractResources = (namespace: object): AlchemyResource[] => {
  const found = new Map<string, AlchemyResource>();
  const seen = new WeakSet<object>();

  const walk = (obj: object, prefix: string): void => {
    if (seen.has(obj)) return;
    seen.add(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
      const value = plain(obj, key);
      if (!value) continue;
      const exportPath = prefix ? `${prefix}.${key}` : key;

      if (isResource(value)) {
        const type = value.Type;
        if (!found.has(type)) found.set(type, { type, exportPath, ...split(type) });
      } else if (typeof value === "object" && isNamespaceLike(value)) {
        walk(value, exportPath);
      }
    }
  };

  walk(namespace, "");
  return [...found.values()].sort((a, b) => a.type.localeCompare(b.type));
};

/** A provider namespace alchemy exports, e.g. `Cloudflare` at `alchemy/Cloudflare`. */
export interface Provider {
  readonly name: string;
  /** Import specifier, e.g. `alchemy/Cloudflare`. */
  readonly specifier: string;
  /** Source root for `@category` lookup, if the package ships sources. */
  readonly sourceDir: string;
}

/** Every top-level subpath alchemy exports, read from its own `exports` map. Which of them is a
 *  provider is not decided here by name: a provider is a subpath whose module yields resources,
 *  and `extractResources` is the test. Runtime helpers like `alchemy/Cli` yield none. */
export const discoverProviders = async (alchemyPkgPath: string): Promise<Provider[]> => {
  const pkg = JSON.parse(await Bun.file(`${alchemyPkgPath}/package.json`).text());
  return Object.keys(pkg.exports ?? {})
    .filter((k) => k.startsWith("./") && !k.includes("*") && !k.slice(2).includes("/"))
    .map((k) => k.slice(2))
    .sort()
    .map((name) => ({ name, specifier: `alchemy/${name}`, sourceDir: `${alchemyPkgPath}/src/${name}` }));
};
