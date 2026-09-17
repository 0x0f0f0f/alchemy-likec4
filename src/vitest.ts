/**
 * A matcher for vitest or bun:test:
 *
 *   import { matchers } from "alchemy-likec4/vitest";
 *   expect.extend(matchers);
 *   expect(model).toConverge(graph, baseline?);
 */
import type { LikeC4Model } from "likec4/model";
import { type Baseline, newViolations, reflexion } from "./assert.ts";
import type { StackGraph } from "./stack.ts";

export const matchers = {
  toConverge(received: LikeC4Model<any>, graph: StackGraph, baseline?: Baseline) {
    const r = reflexion(received, graph);
    const fresh = newViolations(r, baseline);
    const pass = fresh.divergence.length === 0 && fresh.absence.length === 0;
    return {
      pass,
      message: () =>
        pass
          ? `${r.stack}: model and stack converge on ${r.convergence.length} resources`
          : [
              `${r.stack}: model and stack disagree`,
              ...fresh.divergence.map((f) => `  deployed, unmodelled:  ${f}`),
              ...fresh.absence.map((f) => `  modelled, undeployed:  ${f}`),
            ].join("\n"),
    };
  },
};

declare module "bun:test" {
  interface Matchers<T> {
    toConverge(graph: StackGraph, baseline?: Baseline): T;
  }
}
