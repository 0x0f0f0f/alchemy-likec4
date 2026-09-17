/**
 * Read a stack's resource graph by compiling its entrypoint — no deploy, no network, no state.
 *
 * `Alchemist.open` imports `alchemy.run.ts` and runs the stack body under placeholder services.
 * Every `yield* Cloudflare.Worker(...)` is then a registry insert, and the result is a
 * `CompiledStack` whose resources carry symbolic props. Dependencies are recovered by walking
 * those props with `Output.upstreamAny`: a prop that holds another resource (or one of its
 * attributes) is an edge. Value bindings — `plain_text`, `secret_text`, `json` — reference
 * nothing, so they yield no edge and their values are never read.
 *
 * Durable Object bindings are the one gap. They are plain values naming a `scriptName`, not
 * resources, so alchemy's own graph omits them; a name-join against each Worker's `name` closes it.
 */
import * as Alchemist from "alchemy/Alchemist";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";

export interface StackResource {
  /** Canonical type, e.g. `Cloudflare.Worker` — the join key to the generated specification. */
  readonly type: string;
  readonly fqn: string;
  readonly logicalId: string;
  /** Namespace path, outermost first. Empty at the stack root. */
  readonly namespace: readonly string[];
  /** The `name` prop when it is a plain string; Outputs stay unresolved before a deploy. */
  readonly name: string | undefined;
}

export interface StackEdge {
  readonly from: string;
  readonly to: string;
  /** Binding kind from the Workers API (`d1`, `kv_namespace`, …) or `prop` for a plain reference. */
  readonly kind: string;
  /** The `env` key the binding is exposed under, when it is a binding. */
  readonly sid: string | undefined;
}

export interface StackGraph {
  readonly name: string;
  readonly stage: string;
  readonly resources: readonly StackResource[];
  readonly edges: readonly StackEdge[];
}

interface ResourceLike {
  readonly Type: string;
  readonly FQN: string;
  readonly LogicalId: string;
  readonly Props: unknown;
  readonly Namespace: { Id: string; Parent?: unknown } | undefined;
}

interface Binding {
  readonly sid: string;
  readonly data: { readonly bindings: ReadonlyArray<Record<string, unknown> & { type: string }> };
}

const namespacePath = (ns: ResourceLike["Namespace"]): string[] => {
  const out: string[] = [];
  for (let n = ns; n; n = n.Parent as ResourceLike["Namespace"]) out.unshift(n.Id);
  return out;
};

const upstream = (value: unknown): string[] =>
  Object.values(Output.upstreamAny(value) as Record<string, { FQN: string }>).map((r) => r.FQN);

export interface OpenOptions {
  /** @default "alchemy.run.ts" */
  readonly entrypoint?: string;
  /** @default "placeholder" — the stage only matters for names interpolated from it. */
  readonly stage?: string;
}

/** Compile the stack at `entrypoint` and return its graph, as an Effect. */
export const stackGraph = (opts: OpenOptions = {}): Effect.Effect<StackGraph> => {
  // Building a provider layer resolves credentials, even though compiling never calls an API.
  // Placeholders satisfy the lookup; real values, when present, are left alone.
  process.env.CLOUDFLARE_API_TOKEN ??= "placeholder";
  process.env.CLOUDFLARE_ACCOUNT_ID ??= "placeholder";
  return (
    Effect.gen(function* () {
      const session = yield* Alchemist.open({ entrypoint: opts.entrypoint, stage: opts.stage }, { dev: true });
      const stack = session.stack as {
        name: string;
        stage: string;
        resources: Record<string, ResourceLike>;
        bindings: Record<string, readonly Binding[]>;
      };

      const resources = Object.values(stack.resources).map(
        (r): StackResource => ({
          type: r.Type,
          fqn: r.FQN,
          logicalId: r.LogicalId,
          namespace: namespacePath(r.Namespace),
          name: typeof (r.Props as { name?: unknown })?.name === "string" ? (r.Props as { name: string }).name : undefined,
        }),
      );
      const byName = new Map(resources.flatMap((r) => (r.name ? [[r.name, r.fqn] as const] : [])));

      const edges: StackEdge[] = [];
      const seen = new Set<string>();
      const add = (e: StackEdge) => {
        const key = `${e.from}|${e.to}|${e.kind}|${e.sid ?? ""}`;
        if (e.from !== e.to && !seen.has(key)) {
          seen.add(key);
          edges.push(e);
        }
      };

      for (const r of Object.values(stack.resources)) {
        // Bindings first: they carry the kind. Each binding is walked on its own so the edge is
        // attributed to the right `env` key.
        for (const b of stack.bindings[r.FQN] ?? []) {
          for (const wire of b.data.bindings) {
            const targets = upstream(wire);
            // A Durable Object binding names its host script instead of referencing it.
            const script = wire.scriptName ?? wire.service;
            if (targets.length === 0 && typeof script === "string" && byName.has(script))
              targets.push(byName.get(script) as string);
            for (const to of targets) add({ from: r.FQN, to, kind: wire.type, sid: b.sid });
          }
        }
        // Then plain prop references not already covered by a binding.
        for (const to of upstream(r.Props))
          if (!edges.some((e) => e.from === r.FQN && e.to === to)) add({ from: r.FQN, to, kind: "prop", sid: undefined });
      }

      return { name: stack.name, stage: stack.stage, resources, edges };
    }).pipe(Effect.scoped, Effect.provide(Alchemist.layer())) as Effect.Effect<StackGraph>
  );
};

/** Promise form, for scripts. */
export const openStack = (opts: OpenOptions = {}): Promise<StackGraph> => Effect.runPromise(stackGraph(opts));
