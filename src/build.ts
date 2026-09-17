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
import type { StackGraph, StackResource } from "./stack.ts";

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

/** The two container kinds a stack graph needs that no alchemy resource provides. Declared once,
 *  in their own generated file, so several stacks' `.gen.c4` files can share a project. */
export const STACK_KINDS = { alchemy_stack: {}, alchemy_namespace: {} } as const;

export const buildStackSpecification = (): string =>
  generate(Builder.forSpecification({ deployments: STACK_KINDS }).builder.build());

/**
 * Render a stack graph as a `deployment` block: the stack as root node, namespaces nested under it,
 * one node per resource with its canonical type as kind, and one relation per edge. Kinds are
 * referenced, not declared — they live in the generated specification files. A consumer maps
 * nodes onto the logical model with `extend <node> { instanceOf … }` in a hand-written file.
 */
export const buildDeployment = (graph: StackGraph): string => {
  const kinds = new Set(graph.resources.map((r) => toIdentifier(r.type)));
  const relationships = Object.fromEntries(
    [...new Set(graph.edges.filter((e) => e.kind !== "prop").map((e) => toRelationshipKind(e.kind)))].map((k) => [k, {}]),
  );

  const { builder, deployment: d } = Builder.forSpecification({
    deployments: { ...STACK_KINDS, ...Object.fromEntries([...kinds].map((k) => [k, {}])) },
    relationships,
    metadataKeys: ["fqn", "type", "name", "stage"],
  });
  const helpers = d as unknown as Record<string, (id: string, props?: object) => { with: (...ops: unknown[]) => unknown }>;

  // Stage in the id, so one file per stage can share a project without colliding.
  const stackId = toIdentifier(`${graph.name}_${graph.stage}`);
  const nodeId = (fqn: string) => toIdentifier(fqn);
  const fqnOf = (r: StackResource) => [stackId, ...r.namespace.map(toIdentifier), nodeId(r.fqn)].join(".");
  const byFqn = new Map(graph.resources.map((r) => [r.fqn, fqnOf(r)]));
  if (new Set(byFqn.values()).size !== byFqn.size) throw new Error("resource ids collide after sanitising");

  // Group resources by namespace path so each namespace is emitted once, nested.
  type Tree = { nodes: Map<string, Tree>; resources: StackResource[] };
  const root: Tree = { nodes: new Map(), resources: [] };
  for (const r of graph.resources) {
    let t = root;
    for (const ns of r.namespace) t = t.nodes.get(ns) ?? t.nodes.set(ns, { nodes: new Map(), resources: [] }).get(ns)!;
    t.resources.push(r);
  }
  const emit = (t: Tree): unknown[] => [
    ...[...t.nodes].map(([ns, sub]) => helpers.alchemy_namespace!(toIdentifier(ns), { title: ns }).with(...emit(sub))),
    ...t.resources.map((r) =>
      helpers[toIdentifier(r.type)]!(nodeId(r.fqn), {
        title: r.logicalId,
        metadata: { fqn: r.fqn, type: r.type, ...(r.name ? { name: r.name } : {}) },
      }),
    ),
  ];

  const rel = (d as unknown as { rel: (from: string, to: string, props: object) => unknown }).rel;
  const built = builder
    .with(
      (d as unknown as { deployment: (...ops: unknown[]) => (b: unknown) => unknown }).deployment(
        helpers.alchemy_stack!(stackId, { title: `${graph.name} (${graph.stage})`, metadata: { stage: graph.stage } }).with(
          ...emit(root),
        ),
        ...graph.edges.map((e) =>
          rel(byFqn.get(e.from)!, byFqn.get(e.to)!, {
            title: e.sid ?? "",
            ...(e.kind === "prop" ? {} : { kind: toRelationshipKind(e.kind) }),
          }),
        ),
      ),
    )
    .build();

  return [
    "// GENERATED — DO NOT EDIT.",
    `// Stack ${graph.name}, stage ${graph.stage}: ${graph.resources.length} resources, ${graph.edges.length} edges.`,
    "// Regenerate with:  bun run generate deployment",
    "//",
    "// Map nodes onto the logical model from a hand-written file:  extend <node> { instanceOf <element> }",
    "",
    generate({ deployments: built.deployments }),
  ].join("\n");
};
