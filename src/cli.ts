#!/usr/bin/env bun
/**
 *   alchemy-likec4 spec [--outdir specs] [--provider Cloudflare]
 *   alchemy-likec4 deployment [--entrypoint alchemy.run.ts] [--stage prod] [--out file.gen.c4]
 *
 * A thin shell over the library — the same `effect/unstable/cli` alchemy's own CLI is built on.
 */
import { dirname } from "node:path";
import { DEFAULT_ENTRYPOINT } from "alchemy/Alchemist";
import { PlatformServices, runMain } from "alchemy/Util/PlatformServices";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as CliError from "effect/unstable/cli/CliError";
import * as Command from "effect/unstable/cli/Command";
import * as Flag from "effect/unstable/cli/Flag";
import pkg from "../package.json" with { type: "json" };
import { buildDeployment } from "./build.ts";
import { generateSpecs } from "./generate.ts";
import { stackGraph } from "./stack.ts";

// alchemy's runtime provides no Stdio service, so effect/Console is out; plain console is fine here.
const say = (line: string) => Effect.sync(() => console.log(line));

const spec = Command.make(
  "spec",
  {
    outdir: Flag.string("outdir").pipe(
      Flag.withDescription("Directory for <provider>.spec.c4"),
      Flag.withDefault("specs"),
    ),
    provider: Flag.string("provider").pipe(Flag.withDescription("Only this provider, e.g. Cloudflare"), Flag.optional),
  },
  ({ outdir, provider }) =>
    Effect.gen(function* () {
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
    entrypoint: Flag.string("entrypoint").pipe(
      Flag.withDescription("Stack entrypoint"),
      Flag.withDefault(DEFAULT_ENTRYPOINT),
    ),
    stage: Flag.string("stage").pipe(Flag.withDescription("Stage; only names derived from it change"), Flag.optional),
    out: Flag.string("out").pipe(
      Flag.withDescription("Output file; default <stack>.<stage>.gen.c4 beside the entrypoint"),
      Flag.optional,
    ),
  },
  ({ entrypoint, stage, out }) =>
    Effect.gen(function* () {
      const graph = yield* stackGraph({ entrypoint, stage: Option.getOrUndefined(stage) });
      const path = Option.getOrElse(out, () => `${dirname(entrypoint)}/${graph.name}.${graph.stage}.gen.c4`);
      yield* Effect.promise(() => Bun.write(path, buildDeployment(graph)));
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
