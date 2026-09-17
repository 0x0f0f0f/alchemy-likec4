#!/usr/bin/env bun
/**
 * Generate LikeC4 specifications from alchemy's resource registry — one `.c4` per provider.
 *
 *   bun run generate                      # every provider alchemy exports
 *   bun run generate --provider Cloudflare
 *   bun run generate --outdir specs --no-styles
 */
import { categoriesFor } from "./src/categories.ts";
import { type AlchemyResource, discoverProviders, extractResources } from "./src/extract.ts";
import { emitSpecification } from "./src/emit.ts";

const ALCHEMY = "node_modules/alchemy";

const flag = (name: string): string | undefined => {
  const i = Bun.argv.indexOf(name);
  return i !== -1 ? Bun.argv[i + 1] : undefined;
};
const has = (name: string) => Bun.argv.includes(name);

const outdir = flag("--outdir") ?? "specs";
const only = flag("--provider");
const includeStyles = !has("--no-styles");
const includeRelationships = !has("--no-relationships");

const alchemyVersion: string = JSON.parse(await Bun.file(`${ALCHEMY}/package.json`).text()).version;
const namespaces = await discoverProviders(ALCHEMY);

// Collect across every namespace FIRST, then group by the provider named in each resource's
// canonical type. Namespaces re-export each other — alchemy/AWS exposes the four Kubernetes
// resources for EKS — so the namespace a resource was found in is not its owner. The `.Type`
// is the identity, so it decides which file the kind belongs in, and deduplication is global.
const all = new Map<string, AlchemyResource>();
const sourceDirs = new Map<string, string>();
const skipped: string[] = [];

for (const ns of namespaces) {
  let mod: object;
  try {
    mod = (await import(ns.specifier)) as object;
  } catch (error) {
    // Loudly, never silently: a short spec and a missing spec must not look the same.
    skipped.push(`${ns.name} (import failed: ${String((error as Error).message).slice(0, 60)})`);
    continue;
  }
  sourceDirs.set(ns.name, ns.sourceDir);
  for (const r of extractResources(mod)) if (!all.has(r.type)) all.set(r.type, r);
}

const byProvider = new Map<string, AlchemyResource[]>();
for (const r of all.values()) {
  if (only && r.provider !== only) continue;
  (byProvider.get(r.provider) ?? byProvider.set(r.provider, []).get(r.provider)!).push(r);
}

let total = 0;
for (const [provider, resources] of [...byProvider].sort(([a], [b]) => a.localeCompare(b))) {
  resources.sort((a, b) => a.type.localeCompare(b.type));
  const sourceDir = sourceDirs.get(provider) ?? `${ALCHEMY}/src/${provider}`;
  const categories = categoriesFor(
    sourceDir,
    resources.map((r) => r.type),
  );

  const dsl = emitSpecification(resources, {
    alchemyVersion,
    provider,
    categories,
    includeStyles,
    // Binding kinds are Cloudflare-shaped; emitting them for AWS would be fiction.
    includeRelationships: includeRelationships && provider === "Cloudflare",
  });

  const path = `${outdir}/${provider.toLowerCase()}.spec.c4`;
  await Bun.write(path, dsl);
  total += resources.length;
  console.log(
    `  ${provider.padEnd(12)} ${String(resources.length).padStart(4)} resources  ` +
      `${String(categories.size).padStart(4)} categorised  → ${path}`,
  );
}

console.log(`\n${total} resources across ${byProvider.size} providers (alchemy@${alchemyVersion})`);
if (skipped.length > 0) console.log(`skipped: ${skipped.join(", ")}`);
