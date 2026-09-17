import { describe, expect, it } from "bun:test";
import { LikeC4 } from "likec4";
import { assertConverges, freeze, newViolations, reflexion } from "./assert.ts";
import { openStack, type StackGraph } from "./stack.ts";
import { matchers } from "./vitest.ts";

expect.extend(matchers);

const graph = await openStack({ entrypoint: "examples/link-shortener/alchemy.run.ts", stage: "prod" });
const model = await (await LikeC4.fromWorkspace("examples/link-shortener/docs/architecture")).computedModel();

describe("reflexion", () => {
  it("the example converges: every resource is claimed by an instanceOf", () => {
    const r = reflexion(model, graph);
    expect(r.stack).toBe("shortener_prod");
    expect(r.convergence).toEqual(["analytics", "api", "clicks", "hot", "links", "redirect", "reports"]);
    expect(r.divergence).toEqual([]);
    expect(r.absence).toEqual([]);
  });

  it("a resource the stack gained but the model never claimed is divergence", () => {
    const grown: StackGraph = {
      ...graph,
      resources: [
        ...graph.resources,
        { type: "Cloudflare.KV.Namespace", fqn: "sessions", logicalId: "sessions", namespace: [], name: undefined },
      ],
    };
    expect(reflexion(model, grown).divergence).toEqual(["sessions"]);
  });

  it("a resource the stack lost but the model still claims is absence", () => {
    const shrunk: StackGraph = { ...graph, resources: graph.resources.filter((r) => r.fqn !== "reports") };
    expect(reflexion(model, shrunk).absence).toEqual(["reports"]);
  });

  it("only looks at the stack's own root", () => {
    // The staging root is in the same model; a prod graph must not see it as absence.
    expect(reflexion(model, graph).absence).toEqual([]);
  });
});

describe("baseline ratchet", () => {
  const shrunk: StackGraph = { ...graph, resources: graph.resources.filter((r) => r.fqn !== "reports") };

  it("freezes today's violations so a build passes tomorrow", () => {
    const baseline = freeze(reflexion(model, shrunk));
    expect(baseline.absence).toEqual(["reports"]);
    expect(newViolations(reflexion(model, shrunk), baseline)).toEqual({ divergence: [], absence: [] });
  });

  it("still fails on a violation the baseline does not cover", () => {
    const baseline = freeze(reflexion(model, shrunk));
    const worse: StackGraph = {
      ...shrunk,
      resources: [
        ...shrunk.resources,
        { type: "Cloudflare.Worker", fqn: "cron", logicalId: "cron", namespace: [], name: undefined },
      ],
    };
    expect(newViolations(reflexion(model, worse), baseline).divergence).toEqual(["cron"]);
    expect(() => assertConverges(model, worse, baseline)).toThrow("deployed, unmodelled:  cron");
  });
});

describe("toConverge", () => {
  it("passes on the example", () => {
    expect(model).toConverge(graph);
  });

  it("names what disagrees", () => {
    const shrunk: StackGraph = { ...graph, resources: graph.resources.filter((r) => r.fqn !== "reports") };
    expect(() => expect(model).toConverge(shrunk)).toThrow("modelled, undeployed:  reports");
  });
});
