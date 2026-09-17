#!/usr/bin/env node
/**
 *   alchemy-likec4 spec       --project <dir> [--provider Cloudflare]
 *   alchemy-likec4 deployment --project <dir> [--entrypoint alchemy.run.ts] [--stage prod]
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
import { buildDeployment } from "./build.ts";
import { generateSpecs, write } from "./generate.ts";
import { type NotALikeC4Project, projectOutput } from "./project.ts";
import { stackGraph } from "./stack.ts";

// alchemy's runtime provides no Stdio service, so effect/Console is out; plain console is fine here.
const say = (line: string) => Effect.sync(() => console.log(line));

const project = Flag.string("project").pipe(
  Flag.withDescription("LikeC4 project directory (holds a likec4.config.*); output goes to <project>/alchemy/"),
);

const output = (dir: string) => Effect.try({ try: () => projectOutput(dir), catch: (e) => e as NotALikeC4Project });

const spec = Command.make(
  "spec",
  {
    project,
    provider: Flag.string("provider").pipe(Flag.withDescription("Only this provider, e.g. Cloudflare"), Flag.optional),
  },
  ({ project, provider }) =>
    Effect.gen(function* () {
      const outdir = yield* output(project);
      const r = yield* Effect.promise(() => generateSpecs({ outdir, provider: Option.getOrUndefined(provider) }));
      for (const p of r.providers)
        yield* say(
          `  ${p.name.padEnd(12)} ${String(p.resources).padStart(4)} resources  ${String(p.categorised).padStart(4)} categorised  → ${p.path}`,
        );
      yield* say(`\n${r.total} resources across ${r.providers.length} providers (alchemy@${r.alchemyVersion})`);
      if (r.skipped.length > 0) yield* say(`could not import: ${r.skipped.join(", ")}`);
    }),
).pipe(Command.withDescription("Generate the specification: one deploymentNode kind per alchemy resource"));

const deployment = Command.make(
  "deployment",
  {
    project,
    entrypoint: Flag.string("entrypoint").pipe(
      Flag.withDescription("Stack entrypoint"),
      Flag.withDefault(DEFAULT_ENTRYPOINT),
    ),
    stage: Flag.string("stage").pipe(Flag.withDescription("Stage; only names derived from it change"), Flag.optional),
  },
  ({ project, entrypoint, stage }) =>
    Effect.gen(function* () {
      const outdir = yield* output(project);
      const graph = yield* stackGraph({ entrypoint, stage: Option.getOrUndefined(stage) });
      const path = `${outdir}/${graph.name}.${graph.stage}.gen.c4`;
      yield* Effect.promise(() => write(path, buildDeployment(graph)));
      yield* say(
        `${graph.name} @ ${graph.stage}: ${graph.resources.length} resources, ${graph.edges.length} edges → ${path}`,
      );
    }),
).pipe(Command.withDescription("Generate the deployment model from a stack, without deploying it"));

const root = Command.make("alchemy-likec4", {}, () =>
  Effect.fail(new CliError.ShowHelp({ commandPath: ["alchemy-likec4"], errors: [] })),
).pipe(
  Command.withDescription(
    "LikeC4 from alchemy: the specification from its resources, the deployment model from a stack",
  ),
  Command.withSubcommands([spec, deployment]),
);

Command.run(root, { version: pkg.version }).pipe(Effect.provide(PlatformServices), Effect.scoped, runMain);
