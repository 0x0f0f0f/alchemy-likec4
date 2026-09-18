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
 *
 * A `Resource.ref` is the other gap, and it cannot be closed here: the target belongs to another
 * stack, so nothing in this one can name it. The ref's own `(stack, logical id, type)` is recorded
 * as a `crossEdge` instead, for a run that holds the target's graph to resolve.
 */
import * as Alchemist from "alchemy/Alchemist";
import * as Output from "alchemy/Output";
import { isResource } from "alchemy/Resource";
import { isPlainData } from "alchemy/Util/data";
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

/** An edge whose target is a `Resource.ref`: named, not referenced, and owned by another stack. */
export interface CrossStackEdge {
  /** FQN of the resource in THIS stack that holds the ref. */
  readonly from: string;
  /** The stack the ref names — this one, when the ref omitted it. */
  readonly stack: string;
  /** The target's logical id, as `Resource.ref` was given it. */
  readonly id: string;
  /** The target's canonical type. Statically known on the ref, so no deploy is needed to read it. */
  readonly type: string | undefined;
  readonly kind: string;
  readonly sid: string | undefined;
}

export interface StackGraph {
  readonly name: string;
  readonly stage: string;
  readonly resources: readonly StackResource[];
  /** Edges whose ends are both in this stack. */
  readonly edges: readonly StackEdge[];
  /** Edges to a ref, unresolved: only a run holding the target's graph can turn one into a relation. */
  readonly crossEdges: readonly CrossStackEdge[];
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
  /** Absent `bindings` on a Container / Durable Object binding, whose `data` is a namespace handle. */
  readonly data?: { readonly bindings?: ReadonlyArray<Record<string, unknown> & { readonly type: string }> };
}

const namespacePath = (ns: NamespaceNode | undefined): string[] => {
  const out: string[] = [];
  for (let n = ns; n; n = n.Parent) out.unshift(n.Id);
  return out;
};

const upstream = (value: unknown): string[] =>
  Object.values(Output.upstreamAny(value) as Record<string, { FQN: string }>).map((r) => r.FQN);

interface RefTarget {
  readonly stack: string | undefined;
  readonly id: string;
  readonly type: string | undefined;
}

/**
 * Every ref reachable from `value`.
 *
 * `Output.upstreamAny` has no `RefExpr` arm — a ref is not a resource of this stack — so a binding
 * that holds one walks to nothing. This mirrors its shape and stops at the ref instead.
 *
 * Dispatch is per expr kind rather than by reading `.expr` off whatever arrives: an Expr is a
 * proxy that answers any unknown property with a PropExpr wrapping itself, so a generic walk
 * never terminates.
 */
const refsIn = (value: unknown, seen: WeakSet<object>): RefTarget[] => {
  if (Output.isExpr(value)) {
    if (Output.isRefExpr(value)) return [{ stack: value.stack, id: value.resourceId, type: value.stables?.Type }];
    if (Output.isAllExpr(value)) return value.outs.flatMap((out) => refsIn(out, seen));
    if (
      Output.isPropExpr(value) ||
      Output.isApplyExpr(value) ||
      Output.isFlatMapExpr(value) ||
      Output.isEffectExpr(value) ||
      Output.isNamedExpr(value)
    )
      return refsIn(value.expr, seen);
    return []; // ResourceExpr, LiteralExpr and StackRefExpr reach no ref.
  }
  // A resource is a dependency, not a container to walk into: alchemy's own `upstreamAny` tests
  // `isResource` BEFORE `isPlainData` for the same reason. A resource object is a proxy over a
  // plain object literal, so without this it reads as plain data and every resource that binds a
  // ref-holding one inherits its refs — transitively.
  if (isResource(value)) return [];
  // Every other value is a leaf, per alchemy's own dependency rule: only plain data is walked.
  if (!isPlainData(value) || seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((v) => refsIn(v, seen));
};

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

  const crossEdges: CrossStackEdge[] = [];
  const seenRef = new Set<string>();
  // Keyed on the target alone: the props walk re-reaches a ref the binding walk already typed, and
  // the binding's kind and `env` key are the better of the two.
  const addRef = (from: string, t: RefTarget, kind: string, sid: string | undefined) => {
    const key = `${from}|${t.stack ?? stack.name}|${t.id}`;
    if (seenRef.has(key)) return;
    seenRef.add(key);
    crossEdges.push({ from, stack: t.stack ?? stack.name, id: t.id, type: t.type, kind, sid });
  };

  for (const r of Object.values(stack.resources)) {
    // Bindings first: they carry the kind, and each is walked on its own so the edge is attributed
    // to the right `env` key. `data.bindings` is absent on a Container or Durable Object binding,
    // whose `data` is `{ durableObjects: { namespaceId } }` — the resource is still a node, it
    // just wires nothing here.
    for (const b of stack.bindings[r.FQN] ?? []) {
      for (const wire of b.data?.bindings ?? []) {
        // A binding whose VALUE is an Output — `secret.text`, a mapped attribute, the `access:`
        // prop — arrives as an unresolved Output proxy wrapping the whole wire, so `wire.type` is
        // another Output rather than a string and no field of it can be read as text. The
        // reference is still walkable, so the edge survives; only its kind is unknown until deploy.
        const kind = typeof wire.type === "string" ? wire.type : undefined;
        const targets = upstream(wire);
        // Nothing to walk: join every string field but the binding's own identity against the
        // resources' names. Only on a wire that is a plain object — a proxy has no readable fields.
        if (targets.length === 0 && kind !== undefined)
          for (const [key, value] of Object.entries(wire))
            if (key !== "type" && key !== "name" && typeof value === "string" && byName.has(value))
              targets.push(byName.get(value) as string);
        for (const to of targets) add({ from: r.FQN, to, kind: kind ?? "prop", sid: b.sid });
        for (const t of refsIn(wire, new WeakSet())) addRef(r.FQN, t, kind ?? "prop", b.sid);
      }
    }
    // Then plain prop references a binding did not already cover.
    for (const to of upstream(r.Props))
      if (!edges.some((e) => e.from === r.FQN && e.to === to)) add({ from: r.FQN, to, kind: "prop", sid: undefined });
    for (const t of refsIn(r.Props, new WeakSet())) addRef(r.FQN, t, "prop", undefined);
  }

  return { name: stack.name, stage: stack.stage, resources, edges, crossEdges };
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
