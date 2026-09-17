/**
 * Generate the specification files: one `<provider>.spec.c4` per provider alchemy ships, plus
 * `alchemy.spec.c4` for the two container kinds a stack graph needs.
 */
import { dirname } from "node:path";
import { buildSpecification, buildStackSpecification } from "./build.ts";
import { categoriesFor } from "./categories.ts";
import { type AlchemyResource, discoverProviders, extractResources } from "./extract.ts";

export interface GenerateOptions {
  /** @default "specs" */
  readonly outdir?: string;
  /** Only this provider, e.g. `Cloudflare`. */
  readonly provider?: string;
}

export interface GeneratedProvider {
  readonly name: string;
  readonly resources: number;
  readonly categorised: number;
  readonly path: string;
}

export interface GenerateResult {
  readonly alchemyVersion: string;
  readonly providers: readonly GeneratedProvider[];
  readonly total: number;
  /** Subpaths that failed to import. Loud, never silent: a helper and a broken provider must not look the same. */
  readonly skipped: readonly string[];
}

/** alchemy's package root, wherever the consumer's linker put it. */
const alchemyDir = () => dirname(dirname(Bun.resolveSync("alchemy", process.cwd())));

export const generateSpecs = async (opts: GenerateOptions = {}): Promise<GenerateResult> => {
  const { outdir = "specs", provider: only } = opts;
  const alchemy = alchemyDir();
  const alchemyVersion: string = JSON.parse(await Bun.file(`${alchemy}/package.json`).text()).version;

  // Collect across every subpath FIRST, then group by the provider named in each resource's
  // canonical type. Subpaths re-export each other — alchemy/AWS exposes the Kubernetes resources
  // for EKS — so where a resource was found is not its owner; its `.Type` is.
  const all = new Map<string, AlchemyResource>();
  const sourceDirs = new Map<string, string>();
  const skipped: string[] = [];
  for (const ns of await discoverProviders(alchemy)) {
    let mod: object;
    try {
      mod = (await import(ns.specifier)) as object;
    } catch (error) {
      skipped.push(`${ns.name} (${String((error as Error).message).slice(0, 60)})`);
      continue;
    }
    const found = extractResources(mod);
    if (found.length === 0) continue; // a runtime helper, not a provider
    sourceDirs.set(ns.name, ns.sourceDir);
    for (const r of found) if (!all.has(r.type)) all.set(r.type, r);
  }

  const byProvider = new Map<string, AlchemyResource[]>();
  for (const r of all.values()) {
    if (only && r.provider !== only) continue;
    (byProvider.get(r.provider) ?? byProvider.set(r.provider, []).get(r.provider)!).push(r);
  }

  const providers: GeneratedProvider[] = [];
  for (const [name, resources] of [...byProvider].sort(([a], [b]) => a.localeCompare(b))) {
    resources.sort((a, b) => a.type.localeCompare(b.type));
    const categories = categoriesFor(
      sourceDirs.get(name) ?? `${alchemy}/src/${name}`,
      resources.map((r) => r.type),
    );
    const path = `${outdir}/${name.toLowerCase()}.spec.c4`;
    await Bun.write(
      path,
      buildSpecification(resources, {
        alchemyVersion,
        provider: name,
        categories,
        // Binding kinds are Cloudflare's; emitting them for AWS would be fiction.
        includeRelationships: name === "Cloudflare",
      }),
    );
    providers.push({ name, resources: resources.length, categorised: categories.size, path });
  }
  await Bun.write(`${outdir}/alchemy.spec.c4`, buildStackSpecification());

  return { alchemyVersion, providers, total: providers.reduce((n, p) => n + p.resources, 0), skipped };
};
