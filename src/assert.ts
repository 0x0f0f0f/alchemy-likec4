/**
 * Does the model agree with the stack? The Reflexion Model (Murphy, Notkin, Sullivan, 1995),
 * with `instanceOf` as the mapping:
 *
 *   convergence  a resource in the stack, with a node in the model that an instance claims
 *   divergence   a resource in the stack that no instance claims — deployed, unmodelled
 *   absence      an instance claiming a node the stack no longer has — modelled, undeployed
 *
 * Relationships are checked the same way, between the elements the instances claim. This is where
 * intent and reality are compared, deliberately: a diagram showing a generated edge next to a
 * hand-written one renders both, which is two arrows saying the same thing rather than a diff.
 * The comparison belongs in a test.
 *
 * Nothing is auto-fixed. The result is data; `freeze` + `newViolations` make it a ratchet so an
 * existing model adopts the check on day one and only ever tightens.
 */
import type { LikeC4Model } from "likec4/model";
import { stackId } from "./build.ts";
import type { StackGraph } from "./stack.ts";

export interface Reflexion {
  readonly stack: string;
  readonly convergence: readonly string[];
  readonly divergence: readonly string[];
  readonly absence: readonly string[];
  /** A binding the stack wires that the model has no relationship for, as `from -> to`. */
  readonly unwired: readonly string[];
  /** A model relationship between two deployed elements that no binding backs. */
  readonly unbacked: readonly string[];
}

type Model = LikeC4Model<any>;

/** Compare a computed model against a stack graph. Only instances under that stack's root count. */
export const reflexion = (model: Model, graph: StackGraph): Reflexion => {
  const root = stackId(graph);
  const inStack = new Set(graph.resources.map((r) => r.fqn));

  // A generated deployment instance IS the node, so walk instances rather than their parents.
  // `fqn` is the join key: the alchemy logical id, stamped on the instance as metadata.
  const claimed = new Set<string>();
  const absence: string[] = [];
  const elementOf = new Map<string, string>();
  for (const instance of model.deployment.instances()) {
    if (!String(instance.id).startsWith(`${root}.`)) continue;
    const fqn = instance.getMetadata("fqn");
    if (typeof fqn !== "string") continue;
    elementOf.set(fqn, String(instance.element.id));
    if (inStack.has(fqn)) claimed.add(fqn);
    else absence.push(fqn);
  }

  // Relationships, between the elements those instances claim. A binding the stack wires with no
  // model relationship behind it is the same class of finding as an unmodelled resource.
  const edge = (from: string, to: string) => `${from} -> ${to}`;
  const wired = new Set(
    graph.edges.flatMap((e) => {
      const from = elementOf.get(e.from);
      const to = elementOf.get(e.to);
      return from && to ? [edge(from, to)] : [];
    }),
  );
  const deployed = new Set(elementOf.values());
  const modelled = new Set(
    [...model.relationships()]
      .map((r) => edge(String(r.source.id), String(r.target.id)))
      .filter((k) => {
        const [from, to] = k.split(" -> ") as [string, string];
        return deployed.has(from) && deployed.has(to);
      }),
  );

  return {
    stack: root,
    convergence: [...claimed].sort(),
    divergence: [...inStack].filter((f) => !claimed.has(f)).sort(),
    absence: absence.sort(),
    unwired: [...wired].filter((k) => !modelled.has(k)).sort(),
    unbacked: [...modelled].filter((k) => !wired.has(k)).sort(),
  };
};

export interface Baseline {
  readonly divergence: readonly string[];
  readonly absence: readonly string[];
  readonly unwired?: readonly string[];
  readonly unbacked?: readonly string[];
}

const EMPTY: Baseline = { divergence: [], absence: [], unwired: [], unbacked: [] };

/** The violations to tolerate from now on. Write it once; it should only ever shrink. */
export const freeze = (r: Reflexion): Baseline => ({
  divergence: r.divergence,
  absence: r.absence,
  unwired: r.unwired,
  unbacked: r.unbacked,
});

/** Violations not in the baseline — the only ones that fail a build. */
export const newViolations = (r: Reflexion, baseline: Baseline = EMPTY): Baseline => ({
  divergence: r.divergence.filter((f) => !baseline.divergence.includes(f)),
  absence: r.absence.filter((f) => !baseline.absence.includes(f)),
  unwired: r.unwired.filter((f) => !(baseline.unwired ?? []).includes(f)),
  unbacked: r.unbacked.filter((f) => !(baseline.unbacked ?? []).includes(f)),
});

/** Throw a readable error on any new violation. */
export const assertConverges = (model: Model, graph: StackGraph, baseline?: Baseline): Reflexion => {
  const r = reflexion(model, graph);
  const fresh = newViolations(r, baseline);
  const lines = [
    ...fresh.divergence.map((f) => `  deployed, unmodelled:  ${f}  (no instanceOf claims it)`),
    ...fresh.absence.map((f) => `  modelled, undeployed:  ${f}  (the stack has no such resource)`),
    ...(fresh.unwired ?? []).map((f) => `  wired, unmodelled:     ${f}  (the stack binds these, the model does not)`),
    ...(fresh.unbacked ?? []).map(
      (f) => `  modelled, unwired:     ${f}  (the model relates these, the stack does not)`,
    ),
  ];
  if (lines.length > 0) throw new Error(`${r.stack}: model and stack disagree\n${lines.join("\n")}`);
  return r;
};
