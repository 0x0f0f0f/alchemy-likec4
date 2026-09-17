/**
 * Does the model agree with the stack? The Reflexion Model (Murphy, Notkin, Sullivan, 1995),
 * with `instanceOf` as the mapping:
 *
 *   convergence  a resource in the stack, with a node in the model that an instance claims
 *   divergence   a resource in the stack that no instance claims — deployed, unmodelled
 *   absence      an instance claiming a node the stack no longer has — modelled, undeployed
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
}

type Model = LikeC4Model<any>;

/** Compare a computed model against a stack graph. Only nodes under that stack's root count. */
export const reflexion = (model: Model, graph: StackGraph): Reflexion => {
  const root = stackId(graph);
  const inStack = new Set(graph.resources.map((r) => r.fqn));

  const claimed = new Set<string>();
  const absence: string[] = [];
  for (const node of model.deployment.nodes()) {
    if (node.id !== root && !String(node.id).startsWith(`${root}.`)) continue;
    const fqn = node.getMetadata("fqn");
    if (typeof fqn !== "string" || [...node.instances()].length === 0) continue;
    if (inStack.has(fqn)) claimed.add(fqn);
    else absence.push(fqn);
  }

  return {
    stack: root,
    convergence: [...claimed].sort(),
    divergence: [...inStack].filter((f) => !claimed.has(f)).sort(),
    absence: absence.sort(),
  };
};

export interface Baseline {
  readonly divergence: readonly string[];
  readonly absence: readonly string[];
}

/** The violations to tolerate from now on. Write it once; it should only ever shrink. */
export const freeze = (r: Reflexion): Baseline => ({ divergence: r.divergence, absence: r.absence });

/** Violations not in the baseline — the only ones that fail a build. */
export const newViolations = (r: Reflexion, baseline: Baseline = { divergence: [], absence: [] }): Baseline => ({
  divergence: r.divergence.filter((f) => !baseline.divergence.includes(f)),
  absence: r.absence.filter((f) => !baseline.absence.includes(f)),
});

/** Throw a readable error on any new violation. */
export const assertConverges = (model: Model, graph: StackGraph, baseline?: Baseline): Reflexion => {
  const r = reflexion(model, graph);
  const fresh = newViolations(r, baseline);
  const lines = [
    ...fresh.divergence.map((f) => `  deployed, unmodelled:  ${f}  (no instanceOf claims it)`),
    ...fresh.absence.map((f) => `  modelled, undeployed:  ${f}  (the stack has no such resource)`),
  ];
  if (lines.length > 0) throw new Error(`${r.stack}: model and stack disagree\n${lines.join("\n")}`);
  return r;
};
