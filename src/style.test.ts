import { describe, expect, it } from "bun:test";
import * as Cloudflare from "alchemy/Cloudflare";
import { annotationsFor } from "./annotations.ts";
import { extractResources } from "./extract.ts";
import { iconFor } from "./icons.ts";
import { BY_CATEGORY, DEFAULT_STYLE, styleFor } from "./style.ts";

const resources = extractResources(Cloudflare);
const annotations = annotationsFor(
  "node_modules/alchemy/src/Cloudflare",
  resources.map((r) => r.type),
);

describe("styleFor", () => {
  it("places every category alchemy ships, so a new one fails here rather than rendering grey", () => {
    const categories = new Set([...annotations.values()].flatMap((a) => (a.category ? [a.category] : [])));
    const unplaced = [...categories].filter((c) => !(c in BY_CATEGORY));
    expect(unplaced).toEqual([]);
  });

  it("takes the shape from the resource name and the colour from the category", () => {
    // A queue and a bucket both sit in `Storage & Databases`, so the category alone would draw
    // them identically. The name disambiguates the shape; the category keeps the grouping colour.
    expect(styleFor("Cloudflare.Queues.Queue", "Storage & Databases")).toEqual({ shape: "queue", color: "indigo" });
    expect(styleFor("Cloudflare.R2.Bucket", "Storage & Databases")).toEqual({ shape: "bucket", color: "indigo" });
    expect(styleFor("Cloudflare.D1Database", "Storage & Databases")).toEqual({ shape: "storage", color: "indigo" });
    expect(styleFor("Cloudflare.Worker", "Workers & Compute")).toEqual({ shape: "component", color: "amber" });
  });

  it("falls back to the name alone for providers that ship no categories", () => {
    expect(styleFor("AWS.SQS.Queue")).toEqual({ shape: "queue", color: "amber" });
    expect(styleFor("AWS.Lambda.Function")).toEqual({ shape: "component", color: "amber" });
  });

  it("defaults rather than guessing when neither says anything", () => {
    expect(styleFor("AWS.AccessAnalyzer.Analyzer")).toEqual(DEFAULT_STYLE);
  });
});

describe("iconFor", () => {
  it("resolves the vendor's own icon set by service name", () => {
    expect(iconFor("AWS.Lambda.Function")).toBe("aws:lambda");
    // `DynamoDB` and `dynamo-db` have to collide, so names are matched on alphanumerics only.
    expect(iconFor("AWS.DynamoDB.Table")).toBe("aws:dynamo-db");
  });

  it("gives Cloudflare the Workers mark for compute and the brand mark otherwise", () => {
    expect(iconFor("Cloudflare.Worker")).toBe("tech:cloudflare-workers-icon");
    expect(iconFor("Cloudflare.R2.Bucket")).toBe("tech:cloudflare-icon");
  });

  it("does not mistake a resource name for a service on a two-segment type", () => {
    // `Neon.Branch` must not resolve to a generic `tech:branch`.
    expect(iconFor("Neon.Branch")).toBe("tech:neon");
  });

  it("covers most of AWS and falls back to the brand mark for the rest", () => {
    const aws = ["AWS.S3.Bucket", "AWS.Lambda.Function", "AWS.Aurora.Cluster", "AWS.DynamoDB.Table"];
    expect(aws.every((t) => iconFor(t))).toBe(true);
    expect(iconFor("AWS.AccessAnalyzer.Analyzer")).toBe("tech:aws");
  });
});
