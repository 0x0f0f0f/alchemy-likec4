import { describe, expect, it } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Stack from "alchemy/Stack";
import { bindingKinds, toRelationshipKind } from "./bindings.ts";
import { buildSpecification, toIdentifier, toTag } from "./build.ts";
import { categoriesFor } from "./categories.ts";
import { discoverProviders, extractResources } from "./extract.ts";

const resources = extractResources(Cloudflare);
const categories = categoriesFor(
  "node_modules/alchemy/src/Cloudflare",
  resources.map((r) => r.type),
);

describe("extractResources", () => {
  it("finds the resources alchemy actually ships", () => {
    // Not pinned to an exact count — alchemy adds resources and that is the point of
    // generating. Pinned to an order of magnitude, so a broken predicate returning 0 or
    // returning every export fails loudly.
    expect(resources.length).toBeGreaterThan(150);
    expect(resources.length).toBeLessThan(600);
  });

  it("identifies each resource by the `.Type` it registers itself under", () => {
    for (const r of resources) expect(r.type).toStartWith("Cloudflare.");
    expect(resources.map((r) => r.type)).toContain("Cloudflare.R2.Bucket");
    expect(resources.map((r) => r.type)).toContain("Cloudflare.Worker");
    expect(resources.map((r) => r.type)).toContain("Cloudflare.D1Database");
  });

  it("excludes Providers, Errors and Bindings — they carry no `.Type`", () => {
    const types = resources.map((r) => r.type);
    expect(types).not.toContain("Cloudflare.R2.BucketProvider");
    // A binding is a property of a Worker's env, not a provisioned resource.
    expect(types).not.toContain("Cloudflare.DurableObject");
  });

  it("keeps the export path when it differs from the type", () => {
    // `Cloudflare.AI.DynamicRouting` is exported as `AI.GatewayDynamicRouting`; a reader
    // looking for it in code needs the path, not the id.
    const renamed = resources.filter((r) => !r.type.endsWith(`.${r.exportPath.split(".").pop()}`));
    expect(renamed.length).toBeGreaterThan(0);
  });

  it("deduplicates re-exports", () => {
    expect(new Set(resources.map((r) => r.type)).size).toBe(resources.length);
  });

  it("is pinned by snapshot so an alchemy bump shows exactly which kinds moved", () => {
    expect(resources.map((r) => r.type)).toMatchSnapshot();
  });
});

describe("toIdentifier", () => {
  it("flattens a dotted type into a legal LikeC4 identifier", () => {
    // Dots are FQN separators in LikeC4 and illegal in an identifier.
    expect(toIdentifier("Cloudflare.R2.Bucket")).toBe("cloudflare_r2_bucket");
    expect(toIdentifier("Cloudflare.Worker")).toBe("cloudflare_worker");
    expect(toIdentifier("Cloudflare.Access.Application")).toBe("cloudflare_access_application");
  });

  it("splits camelCase so compound names stay readable", () => {
    expect(toIdentifier("Cloudflare.D1Database")).toBe("cloudflare_d1_database");
    expect(toIdentifier("Cloudflare.ApiToken.AccountApiToken")).toBe("cloudflare_api_token_account_api_token");
  });

  it("never emits a dot", () => {
    for (const r of resources) expect(toIdentifier(r.type)).not.toInclude(".");
  });

  it("produces unique identifiers across every resource", () => {
    const ids = resources.map((r) => toIdentifier(r.type));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("toTag", () => {
  it("turns a category into a legal tag", () => {
    expect(toTag("Storage & Databases")).toBe("storage_databases");
    expect(toTag("Cloudflare One (Zero Trust)")).toBe("cloudflare_one_zero_trust");
  });
});

describe("bindingKinds", () => {
  const kinds = bindingKinds();

  it("reads the Workers API's binding vocabulary rather than a hand-written list", () => {
    for (const k of ["d1", "r2_bucket", "kv_namespace", "durable_object_namespace", "service", "queue", "workflow"])
      expect(kinds).toContain(k);
    expect(kinds.length).toBeGreaterThan(30);
  });

  it("is pinned by snapshot so a schema change is visible in review", () => {
    expect(kinds).toMatchSnapshot();
  });

  it("maps a binding to a relationship kind", () => {
    expect(toRelationshipKind("d1")).toBe("d1_binding");
  });
});

describe("buildSpecification", () => {
  const dsl = buildSpecification(resources, { alchemyVersion: "test", provider: "Cloudflare", categories });

  it("stamps provenance so a stale file is obvious in review", () => {
    expect(dsl).toInclude("GENERATED — DO NOT EDIT");
    expect(dsl).toInclude("alchemy@test");
    expect(dsl).toInclude(`${resources.length} Cloudflare resources`);
  });

  it("emits one deploymentNode per resource", () => {
    const count = [...dsl.matchAll(/^ {2}deploymentNode /gm)].length;
    expect(count).toBe(resources.length);
  });

  it("tags every kind with alchemy's own category", () => {
    expect(dsl).toInclude("#storage_databases");
    expect(dsl).toInclude("tag storage_databases");
    expect([...dsl.matchAll(/^ {2}tag /gm)].length).toBe(new Set(categories.values()).size);
  });

  it("emits one relationship kind per binding kind in the schema", () => {
    expect([...dsl.matchAll(/^ {2}relationship /gm)].length).toBe(bindingKinds().length);
    expect(dsl).toInclude("relationship d1_binding");
    expect(dsl).toInclude("relationship durable_object_namespace_binding");
  });

  it("emits no styles — styling by tag is the consumer's job", () => {
    expect(dsl).not.toInclude("style {");
  });

  it("can be asked for kinds only", () => {
    const bare = buildSpecification(resources, {
      alchemyVersion: "test",
      provider: "Cloudflare",
      includeRelationships: false,
    });
    expect(bare).not.toMatch(/^ {2}relationship /m);
    expect(bare.length).toBeLessThan(dsl.length);
  });
});

describe("discoverProviders", () => {
  it("lists every subpath off alchemy's exports map; resources decide which are providers", async () => {
    const names = (await discoverProviders("node_modules/alchemy")).map((p) => p.name);
    expect(names).toContain("Cloudflare");
    expect(names).toContain("AWS");
    expect(names).toContain("Stack");
    // The test that separates a provider from a runtime helper is whether it yields resources.
    expect(extractResources(Stack)).toEqual([]);
  });
});

describe("categoriesFor", () => {
  it("resolves every Cloudflare resource to one of alchemy's curated categories", () => {
    // A path guess resolves 205/241; finding the declaring file resolves all of them.
    expect(categories.size).toBe(resources.length);
    expect(categories.get("Cloudflare.R2.Bucket")).toBe("Storage & Databases");
    expect(categories.get("Cloudflare.Worker")).toBe("Workers & Compute");
  });

  it("is pinned by snapshot so a category change is visible in review", () => {
    expect([...new Set(categories.values())].sort()).toMatchSnapshot();
  });

  it("returns an empty map rather than throwing when sources are absent", () => {
    expect(categoriesFor("node_modules/alchemy/src/DoesNotExist", ["X"]).size).toBe(0);
  });
});
