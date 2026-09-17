#!/usr/bin/env node
/**
 *   alchemy-likec4 generate --project <dir> [--entrypoint alchemy.run.ts] [--stage prod] [--all-kinds]
 *
 * `<dir>` is a LikeC4 project (holds a likec4.config.*); everything lands in `<dir>/alchemy/`.
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
import { generate } from "./generate.ts";
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
      Flag.withDescription("Stack entrypoint"),
      Flag.withDefault(DEFAULT_ENTRYPOINT),
    ),
    stage: Flag.string("stage").pipe(Flag.withDescription("Stage; only names derived from it change"), Flag.optional),
    allKinds: Flag.boolean("all-kinds").pipe(
      Flag.withDescription("Declare every kind alchemy ships, not only the ones this stack uses"),
      Flag.withDefault(false),
    ),
  },
  ({ project, entrypoint, stage, allKinds }) =>
    Effect.gen(function* () {
      const outdir = yield* output(project);
      const graph = yield* stackGraph({ entrypoint, stage: Option.getOrUndefined(stage) });
      const r = yield* Effect.promise(() => generate({ outdir, graph, entrypoint, allKinds }));
      for (const f of r.files) yield* say(`  → ${f}`);
      yield* say(
        `\n${graph.name} @ ${graph.stage}: ${r.resources} resources, ${r.relationships} relationships, ` +
          `${r.kinds} kinds, ${r.described} described (alchemy@${r.alchemyVersion})`,
      );
      if (r.stages.length > 1) yield* say(`stages in this project: ${[...r.stages].sort().join(", ")}`);
      if (r.skipped.length > 0) yield* say(`could not import: ${r.skipped.join(", ")}`);
    }),
).pipe(Command.withDescription("Generate the specification, the logical model, the deployment and views from a stack"));

const root = Command.make("alchemy-likec4", {}, () =>
  Effect.fail(new CliError.ShowHelp({ commandPath: ["alchemy-likec4"], errors: [] })),
).pipe(
  Command.withDescription(
    "LikeC4 from alchemy: the specification from its resources, the deployment model from a stack",
  ),
  Command.withSubcommands([generateCmd]),
);

Command.run(root, { version: pkg.version }).pipe(Effect.provide(PlatformServices), Effect.scoped, runMain);
