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
 * filtered to the types in them.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { type Annotations, annotationsFor } from "./annotations.ts";
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
  /** Every stack in this run. The specification is their union. A stack may appear once per
   *  stage: its logical model is then the union of what every stage declares. */
  readonly stacks: readonly StackInput[];
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

/** A package's root as the stacks' own install resolves it: `src/index.ts` under bun,
 *  `lib/index.js` under node, both two levels down. Resolved from the entrypoint, not from
 *  this package, because providers are the consumer's dependencies, not ours. */
const packageRoot = (pkg: string, from: string): string | undefined => {
  try {
    return dirname(dirname(createRequire(from).resolve(pkg)));
  } catch {
    return undefined;
  }
};

/** `Cloudflare` → `@alchemy.run/cloudflare`; core resources (`Alchemy.KeyPair`) live in `alchemy`. */
const providerPackage = (provider: string): string =>
  provider === "Alchemy" ? "alchemy" : `@alchemy.run/${provider.toLowerCase()}`;

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
 * Every stage this project already has a file for, plus the ones being written, so `views.gen.c4`
 * lists them all. Generating `staging` must not drop the view for `prod`.
 */
const knownStages = (entries: readonly string[], name: string, writing: readonly string[]): string[] => {
  const prefix = `${name}.`;
  const stages = new Set(writing);
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

/** First of each key, in order. */
const uniqueBy = <T>(items: readonly T[], key: (t: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * One logical model per stack, from every stage of it in the run. Stages may declare different
 * resources — a widget only prod needs — and each stage's deployment instantiates the one model,
 * so the model holds them all and ids that a collision suffixes agree across every stage.
 */
const mergeStages = (graphs: readonly StackGraph[]): Map<string, StackGraph> => {
  const merged = new Map<string, StackGraph>();
  for (const g of graphs) {
    const m = merged.get(g.name);
    merged.set(
      g.name,
      m === undefined
        ? g
        : {
            ...m,
            resources: uniqueBy([...m.resources, ...g.resources], (r) => r.fqn),
            edges: uniqueBy([...m.edges, ...g.edges], (e) => `${e.from}|${e.to}|${e.kind}|${e.sid ?? ""}`),
            crossEdges: uniqueBy([...m.crossEdges, ...g.crossEdges], (e) => `${e.from}|${e.stack}|${e.id}`),
          },
    );
  }
  return merged;
};

export const generate = async (opts: GenerateOptions): Promise<GenerateResult> => {
  const { outdir, stacks } = opts;
  const first = stacks[0];
  if (first === undefined) throw new Error("no stacks to generate: pass at least one --entrypoint");

  const from = resolve(first.entrypoint);
  const alchemy = packageRoot("alchemy", from);
  if (alchemy === undefined) throw new Error(`alchemy is not resolvable from ${from}`);
  const alchemyVersion: string = JSON.parse(await readFile(`${alchemy}/package.json`, "utf8")).version;
  const graphs = stacks.map((s) => s.graph);
  const models = mergeStages(graphs);

  const cross = crossStackRelations([...models.values()]);

  const kinds = [...new Set(graphs.flatMap((g) => g.resources.map((r) => r.type)))].sort();
  // A cross-stack relationship carries a binding kind too, and it is the only place some stacks
  // use one: without it the shared specification would not declare the kind the relation names.
  const wired = [...graphs.flatMap((g) => g.edges.map((e) => e.kind)), ...cross.relations.map((r) => r.kind)];
  const bindings = [...new Set(wired.filter((k) => k !== "prop"))].sort();

  // Annotations are read per provider, because each provider's sources live in its own directory.
  const annotations = new Map<string, Annotations>();
  const byProvider = new Map<string, string[]>();
  for (const type of kinds) {
    const provider = type.split(".")[0] as string;
    byProvider.set(provider, [...(byProvider.get(provider) ?? []), type]);
  }
  // Annotations are decoration: a provider whose package is not where the name points gets the
  // default style, not an error.
  for (const [provider, types] of byProvider) {
    const root = packageRoot(providerPackage(provider), from);
    if (root === undefined) continue;
    for (const [type, a] of annotationsFor(join(root, "src"), types)) annotations.set(type, a);
  }

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
  for (const [name, model] of models) {
    const inputs = stacks.filter((s) => s.graph.name === name);
    const prose = readProse((inputs[0] as StackInput).entrypoint);
    const { descriptions } = prose;
    unparsed.push(...prose.unparsed.map((f) => `${name}: ${f}`));
    const stages = knownStages(
      entries,
      name,
      inputs.map((s) => s.graph.stage),
    );
    const stackKinds = [...new Set(model.resources.map((r) => r.type))].sort();
    const stackBindings = [...new Set(model.edges.filter((e) => e.kind !== "prop").map((e) => e.kind))].sort();

    const shared = [`${outdir}/${name}.model.gen.c4`, `${outdir}/${name}.views.gen.c4`] as const;
    await write(
      shared[0],
      buildModel(model, { kinds: stackKinds, bindings: stackBindings, descriptions, stack: prose.stack }),
    );
    await write(shared[1], buildViews(model, stages));
    files.push(...shared);

    for (const { graph } of inputs) {
      const deployment = `${outdir}/${name}.${graph.stage}.gen.c4`;
      await write(deployment, buildDeployment(graph, model.resources));
      files.push(deployment);
      summaries.push({
        name,
        stage: graph.stage,
        resources: graph.resources.length,
        relationships: graph.edges.length,
        described: graph.resources.filter((r) => descriptions.has(r.logicalId)).length,
        stages,
      });
    }
  }

  return {
    alchemyVersion,
    files,
    kinds: kinds.length,
    stacks: summaries,
    unresolved: cross.unresolved,
    unparsed,
    stale: staleStacks(entries, new Set(models.keys())),
  };
};
