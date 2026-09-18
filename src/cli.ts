#!/usr/bin/env node
/**
 *   alchemy-likec4 generate --project <dir> [--entrypoint alchemy.run.ts …] [--stage prod] [--all-kinds]
 *
 * `<dir>` is a LikeC4 project (holds a likec4.config.*); everything lands in `<dir>/alchemy/`.
 * `--entrypoint` repeats: a monorepo has one stack per composition root, and they share one
 * specification, so they have to be generated together.
 *
 * A thin shell over the library — the same `effect/unstable/cli` alchemy's own CLI is built on.
 */
import { DEFAULT_ENTRYPOINT } from "alchemy/Alchemist";
import { PlatformServices, runMain } from "alchemy/Util/PlatformServices";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import pkg from "../package.json" with { type: "json" };
import { generate, type StackInput } from "./generate.ts";
import { type NotALikeC4Project, projectOutput } from "./project.ts";
import { stackGraph } from "./stack.ts";

// alchemy's runtime provides no Stdio service, so effect/Console is out; plain console is fine here.
const say = (line: string) => Effect.sync(() => console.log(line));

const project = Flag.string("project").pipe(
  Flag.withDescription("LikeC4 project directory (holds a likec4.config.*); output goes to <project>/alchemy/"),
);

const output = (dir: string) => Effect.try({ try: () => projectOutput(dir), catch: (e) => e as NotALikeC4Project });

const generateCmd = Command.make(
  "generate",
  {
    project,
    entrypoint: Flag.string("entrypoint").pipe(
      Flag.withDescription("Stack entrypoint; repeat it once per stack in a monorepo"),
      Flag.atLeast(0),
    ),
    stage: Flag.string("stage").pipe(Flag.withDescription("Stage; only names derived from it change"), Flag.optional),
    allKinds: Flag.boolean("all-kinds").pipe(
      Flag.withDescription("Declare every kind alchemy ships, not only the ones these stacks use"),
      Flag.withDefault(false),
    ),
  },
  ({ project, entrypoint, stage, allKinds }) =>
    Effect.gen(function* () {
      const outdir = yield* output(project);
      const entrypoints = entrypoint.length > 0 ? entrypoint : [DEFAULT_ENTRYPOINT];

      const stacks: StackInput[] = [];
      for (const e of entrypoints) {
        const graph = yield* stackGraph({ entrypoint: e, stage: Option.getOrUndefined(stage) });
        stacks.push({ graph, entrypoint: e });
      }

      const r = yield* Effect.promise(() => generate({ outdir, stacks, allKinds }));
      for (const f of r.files) yield* say(`  → ${f}`);
      yield* say(`\n${r.kinds} kinds, reflected from alchemy@${r.alchemyVersion}`);
      for (const s of r.stacks)
        yield* say(
          `  ${s.name} @ ${s.stage}: ${s.resources} resources, ${s.relationships} relationships, ` +
            `${s.described} described`,
        );
      const stages = [...new Set(r.stacks.flatMap((s) => s.stages))].sort();
      if (stages.length > 1) yield* say(`stages in this project: ${stages.join(", ")}`);
      if (r.skipped.length > 0) yield* say(`could not import: ${r.skipped.join(", ")}`);
      // A file that will not parse keeps its resources and loses their prose. Never silent.
      if (r.unparsed.length > 0)
        yield* say(
          `\nWARNING: ${r.unparsed.length} source file${r.unparsed.length === 1 ? "" : "s"} would not parse, ` +
            `so the resources in ${r.unparsed.length === 1 ? "it has" : "them have"} no description:\n  ` +
            r.unparsed.join("\n  "),
        );
      // Each is an arrow the diagram does not draw, because the stack the ref names is not here.
      if (r.unresolved.length > 0)
        yield* say(
          `\nWARNING: ${r.unresolved.length} ref${r.unresolved.length === 1 ? "" : "s"} to a stack not in this ` +
            `run, so the relationship is not drawn:\n  ${r.unresolved.join("\n  ")}`,
        );
      // The shared specification only covers the stacks in this run, so one left out no longer
      // has its kinds declared. Loud: the next `likec4 validate` would blame the wrong file.
      if (r.stale.length > 0)
        yield* say(
          `\nWARNING: ${r.stale.join(", ")} ${r.stale.length === 1 ? "has a model" : "have models"} here but ` +
            `${r.stale.length === 1 ? "was" : "were"} not generated. Pass every --entrypoint, or the ` +
            "specification will not declare the kinds they use.",
        );
    }),
).pipe(Command.withDescription("Generate the specification, the logical model, the deployment and views from stacks"));

const root = Command.make("alchemy-likec4", {}, () =>
  Effect.fail(new CliError.ShowHelp({ commandPath: ["alchemy-likec4"], errors: [] })),
).pipe(
  Command.withDescription(
    "LikeC4 from alchemy: the specification from its resources, the deployment model from your stacks",
  ),
  Command.withSubcommands([generateCmd]),
);

Command.run(root, { version: pkg.version }).pipe(Effect.provide(PlatformServices), Effect.scoped, runMain);
