/**
 * Generate a LikeC4 project from one or more alchemy stacks: the vocabulary once, then each
 * stack's logical model, one deployment per stage, views, and the relationships that cross a
 * stack boundary — those belong to the run rather than to either stack, so they get a file of
 * their own.
 *
 * A repo has as many stacks as it has composition roots, and LikeC4 rejects a kind declared twice
 * in one project — so the specification is the union across every stack in the run and lives in a
 * file of its own. Pass every entrypoint: a stack left out of the run keeps whatever file it has,
 * and a kind only it used drops out of the shared specification.
 *
 * Only what the stacks use. A kind nothing instantiates is legal LikeC4 but 241 Cloudflare kinds
 * for a four-resource stack is noise, so the stacks are compiled first and the specification is
 * filtered to the types in them. `--all-kinds` restores the full catalogue for browsing.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type Annotations, annotationsFor } from "./annotations.ts";
import { bindingKinds } from "./bindings.ts";
import {
  buildCrossStack,
  buildDeployment,
  buildLandscape,
  buildModel,
  buildSpecification,
  buildViews,
  crossStackRelations,
  hasNamespaces,
} from "./build.ts";
import { readProse } from "./describe.ts";
import { type AlchemyResource, alchemyDir, discoverProviders, extractResources } from "./extract.ts";
import type { StackGraph } from "./stack.ts";

/** Write a generated file, creating its directory. Shared with the CLI. */
export const write = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
};

/** One compiled stack, and the entrypoint its JSDoc prose is read from. */
export interface StackInput {
  readonly graph: StackGraph;
  readonly entrypoint: string;
}

export interface GenerateOptions {
  /** Where the files go — a LikeC4 project's `alchemy/` directory, see `projectOutput`. */
  readonly outdir: string;
  /** Every stack in this run. The specification is their union. */
  readonly stacks: readonly StackInput[];
  /** Declare every kind alchemy ships, not only the ones these stacks use. */
  readonly allKinds?: boolean;
}

export interface StackSummary {
  readonly name: string;
  readonly stage: string;
  readonly resources: number;
  readonly relationships: number;
  readonly described: number;
  /** Every stage this project now has a file for, this stack's included. */
  readonly stages: readonly string[];
}

export interface GenerateResult {
  readonly alchemyVersion: string;
  readonly files: readonly string[];
  readonly kinds: number;
  readonly stacks: readonly StackSummary[];
  /** Subpaths that failed to import. Loud, never silent: a helper and a broken provider must not look the same. */
  readonly skipped: readonly string[];
  /**
   * Refs whose target stack was not in this run, as `<stack>/<resource> → <stack>/<id>`. Each is an
   * arrow the diagram is missing, and passing that stack's `--entrypoint` is what draws it.
   */
  readonly unresolved: readonly string[];
  /**
   * Source files that would not parse, as `<stack>: <path>`. Their resources keep their boxes and
   * lose their prose, so this is reported rather than swallowed.
   */
  readonly unparsed: readonly string[];
  /**
   * Stacks this project holds a model for that were NOT in this run. Their kinds are absent from
   * the shared specification, so the project no longer validates — the fix is to pass every
   * entrypoint, which is why this is reported rather than silently tolerated.
   */
  readonly stale: readonly string[];
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

const SPECIFICATION = "specification.gen.c4";
const CROSS_STACK = "cross-stack.gen.c4";
const LANDSCAPE = "landscape.gen.c4";

/** What `<outdir>` already holds, or nothing on a first run. */
const existing = async (outdir: string): Promise<string[]> => {
  try {
    return await readdir(outdir);
  } catch {
    return []; // first run: the directory does not exist yet
  }
};

/**
 * Every stage this project already has a file for, plus the one being written, so `views.gen.c4`
 * lists them all. Generating `staging` must not drop the view for `prod`.
 */
const knownStages = (entries: readonly string[], graph: StackGraph): string[] => {
  const prefix = `${graph.name}.`;
  const stages = new Set([graph.stage]);
  for (const e of entries) {
    // A stack named `specification`, `cross-stack` or `landscape` would otherwise read its own
    // project-wide file as a stage called `gen`.
    if (e === SPECIFICATION || e === CROSS_STACK || e === LANDSCAPE) continue;
    if (!e.startsWith(prefix) || !e.endsWith(".gen.c4")) continue;
    const stage = e.slice(prefix.length, -".gen.c4".length);
    if (!RESERVED.has(stage)) stages.add(stage);
  }
  return [...stages];
};

/** Stacks with a model file in `<outdir>` that this run did not write. */
const staleStacks = (entries: readonly string[], written: ReadonlySet<string>): string[] =>
  entries
    .filter((e) => e.endsWith(".model.gen.c4"))
    .map((e) => e.slice(0, -".model.gen.c4".length))
    .filter((name) => !written.has(name));

export const generate = async (opts: GenerateOptions): Promise<GenerateResult> => {
  const { outdir, stacks, allKinds } = opts;
  if (stacks.length === 0) throw new Error("no stacks to generate: pass at least one --entrypoint");

  const alchemy = alchemyDir();
  const alchemyVersion: string = JSON.parse(await readFile(`${alchemy}/package.json`, "utf8")).version;
  const graphs = stacks.map((s) => s.graph);

  const cross = crossStackRelations(graphs);

  const used = [...new Set(graphs.flatMap((g) => g.resources.map((r) => r.type)))].sort();
  const { all, sourceDirs, skipped } = allKinds
    ? await catalogue(alchemy)
    : { all: new Map<string, AlchemyResource>(), sourceDirs: new Map<string, string>(), skipped: [] as string[] };
  const kinds = allKinds ? [...all.keys()].sort() : used;
  // A cross-stack relationship carries a binding kind too, and it is the only place some stacks
  // use one: without it the shared specification would not declare the kind the relation names.
  const wired = [...graphs.flatMap((g) => g.edges.map((e) => e.kind)), ...cross.relations.map((r) => r.kind)];
  const bindings = allKinds ? bindingKinds() : [...new Set(wired.filter((k) => k !== "prop"))].sort();

  // Annotations are read per provider, because each provider's sources live in its own directory.
  const annotations = new Map<string, Annotations>();
  const byProvider = new Map<string, string[]>();
  for (const type of kinds) {
    const provider = type.split(".")[0] as string;
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), type]);
  }
  for (const [provider, types] of byProvider)
    for (const [type, a] of annotationsFor(sourceDirs.get(provider) ?? `${alchemy}/src/${provider}`, types))
      annotations.set(type, a);

  const entries = await existing(outdir);
  const files: string[] = [`${outdir}/${SPECIFICATION}`, `${outdir}/${CROSS_STACK}`, `${outdir}/${LANDSCAPE}`];
  await write(
    files[0] as string,
    buildSpecification({ alchemyVersion, kinds, annotations, bindings, namespaces: hasNamespaces(graphs) }),
  );
  await write(files[1] as string, buildCrossStack(cross));
  await write(files[2] as string, buildLandscape(graphs));

  const summaries: StackSummary[] = [];
  const unparsed: string[] = [];
  for (const { graph, entrypoint } of stacks) {
    const prose = readProse(entrypoint);
    const { descriptions } = prose;
    unparsed.push(...prose.unparsed.map((f) => `${graph.name}: ${f}`));
    const stages = knownStages(entries, graph);
    const stackKinds = [...new Set(graph.resources.map((r) => r.type))].sort();
    const stackBindings = [...new Set(graph.edges.filter((e) => e.kind !== "prop").map((e) => e.kind))].sort();

    const mine = [
      `${outdir}/${graph.name}.model.gen.c4`,
      `${outdir}/${graph.name}.${graph.stage}.gen.c4`,
      `${outdir}/${graph.name}.views.gen.c4`,
    ] as const;
    await write(
      mine[0],
      buildModel(graph, { kinds: stackKinds, bindings: stackBindings, descriptions, stack: prose.stack }),
    );
    await write(mine[1], buildDeployment(graph));
    await write(mine[2], buildViews(graph, stages));
    files.push(...mine);

    summaries.push({
      name: graph.name,
      stage: graph.stage,
      resources: graph.resources.length,
      relationships: graph.edges.length,
      described: graph.resources.filter((r) => descriptions.has(r.logicalId)).length,
      stages,
    });
  }

  return {
    alchemyVersion,
    files,
    kinds: kinds.length,
    stacks: summaries,
    skipped,
    unresolved: cross.unresolved,
    unparsed,
    stale: staleStacks(entries, new Set(graphs.map((g) => g.name))),
  };
};
