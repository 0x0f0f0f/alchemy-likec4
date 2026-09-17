import { describe, expect, it } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import { discoverProviders, extractResources } from "./extract.ts";
import { categoriesFor } from "./categories.ts";
import { emitSpecification, toIdentifier } from "./emit.ts";

const resources = extractResources(Cloudflare);

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

describe("emitSpecification", () => {
  const dsl = emitSpecification(resources, { alchemyVersion: "test", provider: "Cloudflare" });

  it("stamps provenance so a stale file is obvious in review", () => {
    expect(dsl).toInclude("GENERATED — DO NOT EDIT");
    expect(dsl).toInclude("alchemy@test");
    expect(dsl).toInclude(`${resources.length} Cloudflare resources`);
  });

  it("emits one deploymentNode per resource", () => {
    const count = [...dsl.matchAll(/^ {2}deploymentNode /gm)].length;
    expect(count).toBe(resources.length);
  });

  it("emits binding relationship kinds", () => {
    expect(dsl).toInclude("relationship service_binding");
    expect(dsl).toInclude("relationship durable_object_binding");
  });

  it("can be asked for kinds only", () => {
    const bare = emitSpecification(resources, {
      alchemyVersion: "test",
      provider: "Cloudflare",
      includeStyles: false,
      includeRelationships: false,
    });
    expect(bare).not.toInclude("style {");
    expect(bare).not.toMatch(/^ {2}relationship /m);
    expect(bare.length).toBeLessThan(dsl.length);
  });
});

describe("discoverProviders", () => {
  it("reads providers off alchemy's own exports map", async () => {
    const providers = await discoverProviders("node_modules/alchemy");
    const names = providers.map((p) => p.name);
    expect(names).toContain("Cloudflare");
    expect(names).toContain("AWS");
    // runtime helpers are not providers
    expect(names).not.toContain("Runtime");
    expect(names).not.toContain("Stack");
    expect(names).not.toContain("Test");
  });
});

describe("categoriesFor", () => {
  it("resolves every Cloudflare resource to one of alchemy's curated categories", () => {
    const types = resources.map((r) => r.type);
    const cats = categoriesFor("node_modules/alchemy/src/Cloudflare", types);
    // A path guess resolves 205/241; finding the declaring file resolves all of them.
    expect(cats.size).toBe(resources.length);
    expect(cats.get("Cloudflare.R2.Bucket")).toBe("Storage & Databases");
    expect(cats.get("Cloudflare.Worker")).toBe("Workers & Compute");
  });

  it("returns an empty map rather than throwing when sources are absent", () => {
    expect(categoriesFor("node_modules/alchemy/src/DoesNotExist", ["X"]).size).toBe(0);
  });
});
