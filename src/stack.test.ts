import { describe, expect, it } from "bun:test";
import { buildDeployment, buildModel, buildSpecification, buildViews } from "./build.ts";
import { deriveGraph, openStack } from "./stack.ts";

// Compiles the example stack — no deploy, no network, no state on disk.
const graph = await openStack({ entrypoint: "examples/link-shortener/alchemy.run.ts", stage: "prod" });

describe("openStack", () => {
  it("compiles the stack without deploying it", () => {
    expect(graph.name).toBe("Shortener");
    expect(graph.stage).toBe("prod");
    expect(graph.resources.map((r) => r.fqn).sort()).toEqual([
      "analytics",
      "api",
      "clicks",
      "hot",
      "links",
      "redirect",
      "reports",
    ]);
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
    expect(graph.edges).toContainEqual({
      from: "analytics",
      to: "api",
      kind: "durable_object_namespace",
      sid: "COUNTER",
    });
  });

  it("emits no edge for a value binding, so secrets are never read", () => {
    expect(graph.edges.some((e) => e.sid === "REGION")).toBe(false);
    expect(graph.edges.length).toBe(8);
  });
});

describe("buildDeployment", () => {
  const dsl = buildDeployment(graph);

  it("roots the stack with the stage in the id", () => {
    expect(dsl).toInclude("shortener_prod = alchemy_stack 'Shortener (prod)'");
    expect(dsl).toInclude("stage 'prod'");
  });

  it("deploys every resource as an instance of the logical model", () => {
    expect(dsl).toInclude("instanceOf shortener.api");
    expect([...dsl.matchAll(/^ {4}instanceOf /gm)].length).toBe(graph.resources.length);
  });

  it("carries the join keys as metadata, because instance metadata replaces the element's", () => {
    expect(dsl).toInclude("fqn 'api'");
    expect(dsl).toInclude("type 'Cloudflare.Worker'");
    expect(dsl).toInclude("name 'shortener-api'");
  });

  it("declares no relationships: LikeC4 inherits them from the model through instanceOf", () => {
    expect(dsl).not.toInclude("->");
    expect(dsl).not.toInclude("-[");
  });

  it("declares no kinds — they come from the model file", () => {
    expect(dsl).not.toInclude("specification {");
  });
});

describe("buildSpecification", () => {
  const dsl = buildSpecification({
    alchemyVersion: "test",
    kinds: [...new Set(graph.resources.map((r) => r.type))],
    annotations: new Map([["Cloudflare.Worker", { category: "Workers & Compute", product: "Workers" }]]),
    bindings: [...new Set(graph.edges.map((e) => e.kind))],
    namespaces: false,
  });

  it("declares one element kind per used resource type, and nothing else", () => {
    const kinds = [...dsl.matchAll(/^ {2}element (\w+)/gm)].map((m) => m[1]);
    // Five resource types in the fixture, plus the stack container.
    expect(kinds).toContain("cloudflare_worker");
    expect(kinds).toContain("alchemy_stack");
    expect(kinds).not.toContain("cloudflare_hyperdrive");
    expect(kinds.length).toBe(new Set(graph.resources.map((r) => r.type)).size + 1);
  });

  it("styles each kind from its category and gives it the vendor icon", () => {
    expect(dsl).toInclude("shape component");
    expect(dsl).toInclude("icon tech:cloudflare-workers-icon");
    expect(dsl).toInclude("#workers_compute");
  });

  it("uses alchemy's @product as the technology label", () => {
    expect(dsl).toInclude("technology 'Workers'");
  });

  it("declares only the binding kinds these stacks wire", () => {
    const declared = [...dsl.matchAll(/^ {2}relationship (\w+)/gm)].map((m) => m[1]);
    expect(declared).toContain("d1_binding");
    expect(declared).not.toContain("hyperdrive_binding");
  });

  it("holds no model: the stacks that use these kinds are separate files", () => {
    expect(dsl).not.toInclude("model {");
  });

  it("omits the namespace container kind when nothing is namespaced", () => {
    expect(dsl).not.toInclude("alchemy_namespace");
  });
});

describe("buildModel", () => {
  const dsl = buildModel(graph, {
    kinds: [...new Set(graph.resources.map((r) => r.type))],
    bindings: [...new Set(graph.edges.map((e) => e.kind))],
    descriptions: new Map([["api", "Creates links."]]),
  });

  it("declares no kinds: they are the project's, in specification.gen.c4", () => {
    expect(dsl).not.toInclude("specification {");
    expect(dsl).not.toInclude("element cloudflare_worker {");
  });

  it("inlines no style, so a kind's styling has exactly one declaration", () => {
    expect(dsl).not.toInclude("style {");
    expect(dsl).not.toInclude("shape component");
  });

  it("carries the JSDoc from the stack as the description", () => {
    expect(dsl).toInclude("Creates links.");
  });

  it("puts every relationship in the model, typed by binding kind", () => {
    expect(dsl).toInclude("shortener.analytics -[durable_object_namespace_binding]-> shortener.api 'COUNTER'");
    expect(dsl).toInclude("-[d1_binding]->");
    expect([...dsl.matchAll(/^ {2}shortener\.\w+ -/gm)].length).toBe(graph.edges.length);
  });
});

describe("buildViews", () => {
  const dsl = buildViews(graph, ["prod", "staging"]);

  it("emits a landscape and one deployment view per stage", () => {
    expect(dsl).toInclude("view shortener_landscape");
    expect(dsl).toInclude("deployment view shortener_prod");
    expect(dsl).toInclude("deployment view shortener_staging");
  });

  it("uses the children selector, because `.**` drops resources with no relationship", () => {
    expect(dsl).toInclude("include shortener_prod, shortener_prod.*");
    const includes = [...dsl.matchAll(/^ {4}include .+$/gm)].map((m) => m[0]);
    expect(includes.length).toBe(3);
    expect(includes.some((line) => line.includes(".**"))).toBe(false);
  });
});

describe("deriveGraph", () => {
  // A hand-made compiled stack: two Workers, one binding that names its host under a key alchemy
  // has never used, one value binding, and one binding whose own name happens to be a resource name.
  const worker = (fqn: string, name: string) =>
    [fqn, { Type: "Cloudflare.Worker", FQN: fqn, LogicalId: fqn, Props: { name }, Namespace: undefined }] as const;
  const g = deriveGraph({
    name: "S",
    stage: "t",
    resources: Object.fromEntries([worker("api", "s-api"), worker("edge", "s-edge")]),
    bindings: {
      edge: [
        { sid: "COUNTER", data: { bindings: [{ type: "durable_object_namespace", name: "COUNTER", host: "s-api" }] } },
        { sid: "REGION", data: { bindings: [{ type: "plain_text", name: "REGION", text: "eu" }] } },
        { sid: "s-api", data: { bindings: [{ type: "plain_text", name: "s-api", text: "x" }] } },
      ],
    },
  });

  it("joins a host name under any key, not only scriptName", () => {
    expect(g.edges).toContainEqual({ from: "edge", to: "api", kind: "durable_object_namespace", sid: "COUNTER" });
  });

  it("never joins on a binding's own name, and a value binding yields nothing", () => {
    expect(g.edges.length).toBe(1);
  });
});

describe("ids that differ only by case", () => {
  // An Access application `Vault` in front of a Website `vault` — both spellings are alchemy state
  // rows a consumer cannot rename, and both sanitise to `vault`.
  const resource = (logicalId: string, type: string) => ({
    type,
    fqn: logicalId,
    logicalId,
    namespace: [] as string[],
    name: undefined,
  });
  const kinds = (rs: ReadonlyArray<{ type: string }>) => [...new Set(rs.map((r) => r.type))];
  const g = {
    name: "V",
    stage: "prod",
    resources: [resource("Vault", "Cloudflare.Access.Application"), resource("vault", "Cloudflare.Worker")],
    edges: [],
  };

  it("disambiguates by canonical type instead of refusing to build", () => {
    const dsl = buildModel(g, { kinds: kinds(g.resources), bindings: [], descriptions: new Map() });
    expect(dsl).toInclude("vault_cloudflare_access_application");
    expect(dsl).toInclude("vault_cloudflare_worker");
  });

  it("gives the deployment the same ids, so instanceOf resolves", () => {
    const dsl = buildDeployment(g);
    expect(dsl).toInclude("instanceOf v.vault_cloudflare_worker");
    expect(dsl).toInclude("instanceOf v.vault_cloudflare_access_application");
  });

  it("leaves an id alone when nothing collides with it", () => {
    const one = [resource("vault", "Cloudflare.Worker")];
    const dsl = buildModel({ ...g, resources: one }, { kinds: kinds(one), bindings: [], descriptions: new Map() });
    expect(dsl).toInclude("vault = cloudflare_worker");
    expect(dsl).not.toInclude("vault_cloudflare_worker");
  });
});

describe("bindings a stack can carry that are not wires", () => {
  const worker = (fqn: string, name: string) =>
    [fqn, { Type: "Cloudflare.Worker", FQN: fqn, LogicalId: fqn, Props: { name }, Namespace: undefined }] as const;

  it("skips a binding whose data holds no wires, rather than throwing", () => {
    // A Container / Durable Object binding: `data` is a namespace handle, with no `bindings` array.
    const g = deriveGraph({
      name: "S",
      stage: "t",
      resources: Object.fromEntries([worker("api", "s-api")]),
      bindings: { api: [{ sid: "HUB", data: { durableObjects: { namespaceId: {} } } } as never] },
    });
    expect(g.edges).toEqual([]);
  });

  it("does not string-match a wire whose kind is an unresolved Output", () => {
    // `secret.text` and the `access:` prop arrive as an Output proxy wrapping the whole wire: the
    // kind is not a string, and no field of it can be read as one. Interpolating it used to throw.
    const g = deriveGraph({
      name: "S",
      stage: "t",
      resources: Object.fromEntries([worker("api", "s-api"), worker("edge", "s-edge")]),
      bindings: {
        edge: [{ sid: "SECRET", data: { bindings: [{ type: {}, name: "SECRET", host: "s-api" }] } } as never],
      },
    });
    expect(g.edges).toEqual([]);
  });
});
