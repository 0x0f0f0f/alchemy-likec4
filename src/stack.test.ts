import { describe, expect, it } from "bun:test";
import * as Output from "alchemy/Output";
import * as Ref from "alchemy/Ref";
import {
  buildCrossStack,
  buildDeployment,
  buildModel,
  buildSpecification,
  buildViews,
  crossStackRelations,
} from "./build.ts";
import { deriveGraph, openStack } from "./stack.ts";

// Compiles the example stack — no deploy, no network, no state on disk.
const graph = await openStack({ entrypoint: "examples/link-shortener/alchemy.run.ts", stage: "prod" });
// The stack the shortener's `Worker.ref` names. Only a run holding both can resolve it.
const neighbour = await openStack({ entrypoint: "examples/basic/alchemy.run.ts", stage: "prod" });

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

  it("records a ref as a cross-stack edge, kind and all, though it is no resource of this stack", () => {
    // `Output.upstreamAny` walks a ref to nothing, so the binding used to vanish without a trace.
    expect(graph.crossEdges).toEqual([
      { from: "api", stack: "MyApp", id: "Api", type: "Cloudflare.Worker", kind: "service", sid: "PHOTOS" },
    ]);
    expect(graph.edges.some((e) => e.sid === "PHOTOS")).toBe(false);
  });
});

describe("crossStackRelations", () => {
  it("draws the arrow when the run holds the stack the ref names", () => {
    const { relations, unresolved } = crossStackRelations([graph, neighbour]);
    expect(relations).toEqual([{ from: "shortener.api", to: "my_app.api", kind: "service", sid: "PHOTOS" }]);
    expect(unresolved).toEqual([]);
  });

  it("reports rather than guesses when it does not", () => {
    const { relations, unresolved } = crossStackRelations([graph]);
    expect(relations).toEqual([]);
    expect(unresolved).toEqual(["Shortener/api → MyApp/Api"]);
  });

  it("names the binding kind, so the shared specification has to declare it", () => {
    const dsl = buildCrossStack(crossStackRelations([graph, neighbour]));
    expect(dsl).toInclude("shortener.api -[service_binding]-> my_app.api 'PHOTOS'");
  });

  it("writes no model block when nothing crosses, and still names what it could not draw", () => {
    const dsl = buildCrossStack(crossStackRelations([graph]));
    expect(dsl).not.toInclude("model {");
    expect(dsl).toInclude("Shortener/api → MyApp/Api");
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
    crossEdges: [],
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

  // A namespace is a container the Builder declares too, so it is one of the colliding group.
  // `Website.StaticSite("site")` is enough on its own: alchemy nests the derived `Command.Build`
  // under a namespace named after the site, and the Worker keeps the site's logical id.
  const site = {
    ...g,
    resources: [
      { ...resource("Build", "Command.Build"), fqn: "site/Build", namespace: ["site"] },
      resource("site", "Cloudflare.Worker"),
    ],
  };

  it("counts a namespace container as one of the group, instead of redeclaring its id", () => {
    const dsl = buildModel(site, { kinds: kinds(site.resources), bindings: [], descriptions: new Map() });
    expect(dsl).toInclude("site = alchemy_namespace");
    expect(dsl).toInclude("site_cloudflare_worker = cloudflare_worker");
  });

  it("gives the deployment the same ids there too", () => {
    expect(buildDeployment(site)).toInclude("instanceOf v.site_cloudflare_worker");
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

describe("a ref reached through another resource", () => {
  // A resource object is a proxy over a plain object literal, so a walk that treats plain data as
  // a container descends into a bound resource's props and claims its refs as its own.
  const worker = (fqn: string, Props: object) => ({
    Type: "Cloudflare.Worker",
    FQN: fqn,
    LogicalId: fqn,
    Props,
    Namespace: undefined,
  });
  const elsewhere = Output.of(Ref.ref("Api", { stack: "MyApp" }, "Cloudflare.Worker") as never);

  it("belongs to the resource that holds it, not to everything that binds that resource", () => {
    const gateway = worker("gateway", { env: { PHOTOS: elsewhere } });
    const front = worker("front", { env: { GATEWAY: gateway } });
    const edge = worker("edge", { env: { FRONT: front } });
    const g = deriveGraph({
      name: "P",
      stage: "t",
      resources: { gateway, front, edge },
      bindings: {
        gateway: [{ sid: "PHOTOS", data: { bindings: [{ type: "service", name: "PHOTOS", service: elsewhere }] } }],
      } as never,
    });
    expect(g.crossEdges).toEqual([
      { from: "gateway", stack: "MyApp", id: "Api", type: "Cloudflare.Worker", kind: "service", sid: "PHOTOS" },
    ]);
  });

  it("draws no self-edge, which LikeC4 rejects as an invalid parent-child relationship", () => {
    // `a` binds `b`; `b` refs `a` with no stack, so the ref means this stack.
    const b = worker("b", { env: { A: Output.of(Ref.ref("a", {}, "Cloudflare.Worker") as never) } });
    const a = worker("a", { env: { B: b } });
    const g = deriveGraph({ name: "P", stage: "t", resources: { a, b }, bindings: {} });
    const { relations } = crossStackRelations([g]);
    expect(relations.map((r) => `${r.from} -> ${r.to}`)).toEqual(["p.b -> p.a"]);
    expect(buildCrossStack(crossStackRelations([g]))).not.toInclude("p.a -> p.a");
  });
});
