/**
 * Read a stack's resource graph by compiling its entrypoint — no deploy, no network, no state.
 *
 * `Alchemist.open` imports the entrypoint and runs the stack body under placeholder services.
 * Every `yield* Cloudflare.Worker(...)` is then a registry insert, and the result is a compiled
 * stack whose resources carry symbolic props. Dependencies are recovered by walking those props
 * with `Output.upstreamAny`: a prop that holds another resource (or one of its attributes) is an
 * edge. Value bindings — `plain_text`, `secret_text`, `json` — reference nothing, so they yield no
 * edge and their values are never read.
 *
 * A binding that names its host rather than referencing it — a Durable Object's `scriptName` — is
 * the one gap in alchemy's own graph. A name-join against the resources' names closes it.
 */
import * as Alchemist from "alchemy/Alchemist";
import * as Output from "alchemy/Output";
import * as Effect from "effect/Effect";
import { placeholderEnvironment } from "./auth.ts";

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

/** What this module reads off alchemy's compiled stack. */
export interface CompiledStack {
  readonly name: string;
  readonly stage: string;
  readonly resources: Record<string, ResourceLike>;
  readonly bindings: Record<string, readonly Binding[]>;
}

export interface ResourceLike {
  readonly Type: string;
  readonly FQN: string;
  readonly LogicalId: string;
  readonly Props: unknown;
  readonly Namespace: NamespaceNode | undefined;
}

interface NamespaceNode {
  readonly Id: string;
  readonly Parent?: NamespaceNode;
}

export interface Binding {
  readonly sid: string;
  readonly data: { readonly bindings: ReadonlyArray<Record<string, unknown> & { readonly type: string }> };
}

const namespacePath = (ns: NamespaceNode | undefined): string[] => {
  const out: string[] = [];
  for (let n = ns; n; n = n.Parent) out.unshift(n.Id);
  return out;
};

const upstream = (value: unknown): string[] =>
  Object.values(Output.upstreamAny(value) as Record<string, { FQN: string }>).map((r) => r.FQN);

/** The graph of a compiled stack. Pure, so the edge rules are testable without compiling one. */
export const deriveGraph = (stack: CompiledStack): StackGraph => {
  const resources = Object.values(stack.resources).map((r): StackResource => {
    const name = (r.Props as { name?: unknown } | undefined)?.name;
    return {
      type: r.Type,
      fqn: r.FQN,
      logicalId: r.LogicalId,
      namespace: namespacePath(r.Namespace),
      name: typeof name === "string" ? name : undefined,
    };
  });
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
    // Bindings first: they carry the kind, and each is walked on its own so the edge is attributed
    // to the right `env` key.
    for (const b of stack.bindings[r.FQN] ?? []) {
      for (const wire of b.data.bindings) {
        const targets = upstream(wire);
        // Nothing to walk: join every string field but the binding's own identity against the
        // resources' names.
        if (targets.length === 0)
          for (const [key, value] of Object.entries(wire))
            if (key !== "type" && key !== "name" && typeof value === "string" && byName.has(value))
              targets.push(byName.get(value) as string);
        for (const to of targets) add({ from: r.FQN, to, kind: wire.type, sid: b.sid });
      }
    }
    // Then plain prop references a binding did not already cover.
    for (const to of upstream(r.Props))
      if (!edges.some((e) => e.from === r.FQN && e.to === to)) add({ from: r.FQN, to, kind: "prop", sid: undefined });
  }

  return { name: stack.name, stage: stack.stage, resources, edges };
};

export interface OpenOptions {
  /** @default `Alchemist.DEFAULT_ENTRYPOINT` — `alchemy.run.ts` */
  readonly entrypoint?: string;
  /** @default "placeholder" — the stage only matters for names interpolated from it. */
  readonly stage?: string;
}

/** Compile the stack at `entrypoint` and return its graph, as an Effect. */
export const stackGraph = (opts: OpenOptions = {}): Effect.Effect<StackGraph> =>
  Effect.gen(function* () {
    // Building a provider layer resolves credentials, though compiling never calls an API. A
    // placeholder satisfies each variable alchemy's auth providers declare as required.
    placeholderEnvironment();
    const session = yield* Alchemist.open({ entrypoint: opts.entrypoint, stage: opts.stage }, { dev: true });
    return deriveGraph(session.stack as unknown as CompiledStack);
  }).pipe(Effect.scoped, Effect.provide(Alchemist.layer())) as Effect.Effect<StackGraph>;

/** Promise form, for scripts. */
export const openStack = (opts: OpenOptions = {}): Promise<StackGraph> => Effect.runPromise(stackGraph(opts));
