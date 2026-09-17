import { describe, expect, it } from "bun:test";
import { buildDeployment } from "./build.ts";
import { openStack } from "./stack.ts";

// Compiles the example stack — no deploy, no network, no state on disk.
const graph = await openStack({ entrypoint: "example/alchemy.run.ts", stage: "prod" });

describe("openStack", () => {
  it("compiles the stack without deploying it", () => {
    expect(graph.name).toBe("Shortener");
    expect(graph.stage).toBe("prod");
    expect(graph.resources.map((r) => r.fqn).sort()).toEqual(["analytics", "api", "clicks", "hot", "links", "redirect", "reports"]);
  });

  it("identifies each resource by the same canonical type the specification uses", () => {
    expect(graph.resources.find((r) => r.fqn === "api")?.type).toBe("Cloudflare.Worker");
    expect(graph.resources.find((r) => r.fqn === "links")?.type).toBe("Cloudflare.D1Database");
  });

  it("types every edge by its binding kind", () => {
    expect(graph.edges).toContainEqual({ from: "redirect", to: "clicks", kind: "queue", sid: "CLICKS" });
    expect(graph.edges).toContainEqual({ from: "api", to: "links", kind: "d1", sid: "LINKS" });
    expect(graph.edges).toContainEqual({ from: "analytics", to: "reports", kind: "r2_bucket", sid: "REPORTS" });
  });

  it("recovers the Durable Object edge alchemy's own graph omits", () => {
    // A DO binding names its host script; nothing in alchemy's dependency graph links them.
    expect(graph.edges).toContainEqual({ from: "analytics", to: "api", kind: "durable_object_namespace", sid: "COUNTER" });
  });

  it("emits no edge for a value binding, so secrets are never read", () => {
    expect(graph.edges.some((e) => e.sid === "REGION")).toBe(false);
    expect(graph.edges.length).toBe(8);
  });
});

describe("buildDeployment", () => {
  const dsl = buildDeployment(graph);

  it("roots the stack, stage in the id, and nests resources under it", () => {
    expect(dsl).toInclude("shortener_prod = alchemy_stack 'Shortener (prod)'");
    expect(dsl).toInclude("api = cloudflare_worker");
  });

  it("carries the join keys as metadata", () => {
    expect(dsl).toInclude("fqn 'api'");
    expect(dsl).toInclude("type 'Cloudflare.Worker'");
    expect(dsl).toInclude("name 'shortener-api'");
  });

  it("types relations by binding kind", () => {
    expect(dsl).toInclude("shortener_prod.analytics -[durable_object_namespace_binding]-> shortener_prod.api 'COUNTER'");
    expect(dsl).toInclude("-[d1_binding]->");
  });

  it("declares no kinds — they come from the specification files", () => {
    expect(dsl).not.toInclude("specification {");
  });
});
