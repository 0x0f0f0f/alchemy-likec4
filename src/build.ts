/**
 * Build the LikeC4 `specification` with LikeC4's own Builder and print it with its own generator.
 *
 * Nothing here is typed by hand: kinds come from alchemy's `.Type`s, tags from its `@category`,
 * relationship kinds from Cloudflare's binding schema. Styling is deliberately absent — a
 * consumer styles by tag, which is where taste belongs.
 */
import { Builder } from "@likec4/core/builder";
import { generate } from "@likec4/generators/likec4";
import { bindingKinds, toRelationshipKind } from "./bindings.ts";
import type { AlchemyResource } from "./extract.ts";

/** `Cloudflare.R2.Bucket` → `cloudflare_r2_bucket`. Dots are FQN separators in LikeC4, so the
 *  canonical id is not a legal identifier. Splits camelCase so `D1Database` reads. The provider
 *  prefix stays because a bare `bucket` collides the day a second provider has one. */
export const toIdentifier = (type: string): string =>
  type
    .split(".")
    .flatMap((seg) => seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_-]+/))
    .filter(Boolean)
    .join("_")
    .toLowerCase();

/** `Storage & Databases` → `storage_databases`. */
export const toTag = (category: string): string =>
  category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

export interface BuildOptions {
  readonly alchemyVersion: string;
  readonly provider: string;
  /** Canonical type → alchemy `@category`. Each category becomes a tag on its kinds. */
  readonly categories?: ReadonlyMap<string, string>;
  /** Binding kinds are Cloudflare's, so only that provider emits them. */
  readonly includeRelationships?: boolean;
}

export const buildSpecification = (resources: readonly AlchemyResource[], opts: BuildOptions): string => {
  const { alchemyVersion, provider, categories, includeRelationships = true } = opts;

  const tags = Object.fromEntries([...new Set(categories?.values() ?? [])].sort().map((c) => [toTag(c), {}]));
  const deployments = Object.fromEntries(
    resources.map((r) => {
      const category = categories?.get(r.type);
      return [toIdentifier(r.type), { notation: r.type, ...(category ? { tags: [toTag(category)] } : {}) }];
    }),
  );
  const relationships = includeRelationships
    ? Object.fromEntries(bindingKinds().map((b) => [toRelationshipKind(b), { notation: b }]))
    : {};

  const built = Builder.forSpecification({ deployments, relationships, tags }).builder.build();
  // The Builder assigns each tag a palette colour (`tomato`, `grass`, …) the DSL does not accept.
  // No colour is right anyway: styling is the consumer's.
  for (const tag of Object.values(built.specification.tags)) delete (tag as { color?: string }).color;
  const dsl = generate(built);

  // The printer has no comment support, so provenance is a plain prefix.
  return [
    "// GENERATED — DO NOT EDIT.",
    `// ${resources.length} ${provider} resources, reflected from alchemy@${alchemyVersion}.`,
    "// Regenerate with:  bun run generate",
    "//",
    "// Kinds are alchemy's `.Type`s; tags are its `@category`; relationship kinds are the Workers",
    "// API's binding types. Unused kinds are harmless — LikeC4 validates a specification with",
    "// kinds nothing instantiates, so one shared file serves every repo.",
    "",
    dsl,
  ].join("\n");
};
