/**
 * Generate a LikeC4 project from an alchemy stack: the vocabulary, the logical model, one
 * deployment per stage, and views.
 *
 * Only what the stack uses. A kind nothing instantiates is legal LikeC4 but 241 Cloudflare kinds
 * for a four-resource stack is noise, so the stack is compiled first and the specification is
 * filtered to the types in it. `--all-kinds` restores the full catalogue for browsing.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Annotations, annotationsFor } from "./annotations.ts";
import { buildDeployment, buildModel, buildViews } from "./build.ts";
import { descriptionsFor } from "./describe.ts";
import { type AlchemyResource, alchemyDir, discoverProviders, extractResources } from "./extract.ts";
import type { StackGraph } from "./stack.ts";

/** Write a generated file, creating its directory. Shared with the CLI. */
export const write = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

export interface GenerateOptions {
  /** Where the files go — a LikeC4 project's `alchemy/` directory, see `projectOutput`. */
  readonly outdir: string;
  /** The compiled stack. */
  readonly graph: StackGraph;
  /** The stack entrypoint, scanned for the JSDoc above each resource. */
  readonly entrypoint: string;
  /** Declare every kind alchemy ships, not only the ones this stack uses. */
  readonly allKinds?: boolean;
}

export interface GenerateResult {
  readonly alchemyVersion: string;
  readonly files: readonly string[];
  readonly kinds: number;
  readonly resources: number;
  readonly relationships: number;
  readonly described: number;
  readonly stages: readonly string[];
  /** Subpaths that failed to import. Loud, never silent: a helper and a broken provider must not look the same. */
  readonly skipped: readonly string[];
}

/** Every resource alchemy ships, with the provider source dir each was found under. */
const catalogue = async (alchemy: string) => {
  const all = new Map<string, AlchemyResource>();
  const sourceDirs = new Map<string, string>();
  const skipped: string[] = [];
  for (const ns of await discoverProviders(alchemy)) {
    try {
      const module = await import(ns.specifier);
      for (const r of extractResources(module as Record<string, unknown>)) {
        if (!all.has(r.type)) all.set(r.type, r);
        if (!sourceDirs.has(r.provider)) sourceDirs.set(r.provider, ns.sourceDir);
      }
    } catch (e) {
      skipped.push(`${ns.name} (${(e as Error).message.slice(0, 60)})`);
    }
  }
  return { all, sourceDirs, skipped };
};

/** `<Stack>.<name>.gen.c4` names that are not a stage. */
const RESERVED = new Set(["model", "views"]);

/**
 * Every stage this project already has a file for, plus the one being written, so `views.gen.c4`
 * lists them all. Generating `staging` must not drop the view for `prod`.
 */
const knownStages = async (outdir: string, graph: StackGraph): Promise<string[]> => {
  const prefix = `${graph.name}.`;
  let entries: string[] = [];
  try {
    entries = await readdir(outdir);
  } catch {
    // first run: the directory does not exist yet
  }
  const stages = new Set([graph.stage]);
  for (const e of entries) {
    if (!e.startsWith(prefix) || !e.endsWith(".gen.c4")) continue;
    const stage = e.slice(prefix.length, -".gen.c4".length);
    if (!RESERVED.has(stage)) stages.add(stage);
  }
  return [...stages];
};

export const generate = async (opts: GenerateOptions): Promise<GenerateResult> => {
  const { outdir, graph, entrypoint, allKinds } = opts;
  const alchemy = alchemyDir();
  const alchemyVersion: string = JSON.parse(await readFile(`${alchemy}/package.json`, "utf8")).version;

  const used = [...new Set(graph.resources.map((r) => r.type))].sort();
  const { all, sourceDirs, skipped } = allKinds
    ? await catalogue(alchemy)
    : { all: new Map<string, AlchemyResource>(), sourceDirs: new Map<string, string>(), skipped: [] as string[] };
  const kinds = allKinds ? [...all.keys()].sort() : used;

  // Annotations are read per provider, because each provider's sources live in its own directory.
  const annotations = new Map<string, Annotations>();
  const byProvider = new Map<string, string[]>();
  for (const type of kinds) {
    const provider = type.split(".")[0] as string;
    const types = byProvider.get(provider) ?? [];
    types.push(type);
    byProvider.set(provider, types);
  }
  for (const [provider, types] of byProvider)
    for (const [type, a] of annotationsFor(sourceDirs.get(provider) ?? `${alchemy}/src/${provider}`, types))
      annotations.set(type, a);

  const descriptions = descriptionsFor(entrypoint);
  const stages = await knownStages(outdir, graph);

  const files = [
    `${outdir}/${graph.name}.model.gen.c4`,
    `${outdir}/${graph.name}.${graph.stage}.gen.c4`,
    `${outdir}/${graph.name}.views.gen.c4`,
  ] as const;
  await write(files[0], buildModel(graph, { alchemyVersion, kinds, annotations, descriptions, allBindings: allKinds }));
  await write(files[1], buildDeployment(graph));
  await write(files[2], buildViews(graph, stages));

  return {
    alchemyVersion,
    files: [...files],
    kinds: kinds.length,
    resources: graph.resources.length,
    relationships: graph.edges.length,
    described: graph.resources.filter((r) => descriptions.has(r.logicalId)).length,
    stages,
    skipped,
  };
};
