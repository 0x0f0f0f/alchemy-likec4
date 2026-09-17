/**
 * Build LikeC4 with LikeC4's own Builder and print it with its own generator.
 *
 * Nothing here is typed by hand: kinds come from alchemy's `.Type`s, tags from its `@category`,
 * relationship kinds from Cloudflare's binding schema, nodes and edges from a compiled stack.
 * Styling is deliberately absent — a consumer styles by tag, which is where taste belongs.
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
    .flatMap((seg) => seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_\-/]+/))
    .filter(Boolean)
    .join("_")
    .toLowerCase();

/** `Storage & Databases` → `storage_databases`. */
export const toTag = (category: string): string =>
  category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** The printer has no comment support, so provenance is a plain prefix. */
const generated = (about: readonly string[], dsl: string): string =>
  ["// GENERATED — DO NOT EDIT.", ...about.map((l) => (l ? `// ${l}` : "//")), "", dsl].join("\n");

export interface BuildOptions {
  readonly alchemyVersion: string;
  readonly provider: string;
  /** Canonical type → alchemy `@category`. Each category becomes a tag on its kinds. */
  readonly categories?: ReadonlyMap<string, string>;
}

/** One `deploymentNode` kind per resource, tagged with its category. */
export const buildSpecification = (resources: readonly AlchemyResource[], opts: BuildOptions): string => {
  const { alchemyVersion, provider, categories } = opts;

  const tags = Object.fromEntries([...new Set(categories?.values() ?? [])].sort().map((c) => [toTag(c), {}]));
  const deployments = Object.fromEntries(
    resources.map((r) => {
      const category = categories?.get(r.type);
      return [toIdentifier(r.type), { notation: r.type, ...(category ? { tags: [toTag(category)] } : {}) }];
    }),
  );

  const built = Builder.forSpecification({ deployments, tags }).builder.build();
  // The Builder assigns each tag a palette colour (`tomato`, `grass`, …) the DSL does not accept.
  // No colour is right anyway: styling is the consumer's.
  for (const tag of Object.values(built.specification.tags)) delete (tag as { color?: string }).color;

  return generated(
    [
      `${resources.length} ${provider} resources, reflected from alchemy@${alchemyVersion}.`,
      "Regenerate with:  alchemy-likec4 spec --project <dir>",
      "",
      "Kinds are alchemy's `.Type`s; tags are its `@category`. Unused kinds are harmless — LikeC4",
      "validates a specification with kinds nothing instantiates, so one shared file serves every repo.",
    ],
    generate(built),
  );
};

/** One `relationship` kind per Worker binding kind, from the Workers API schema. */
export const buildBindingsSpecification = (): string => {
  const kinds = bindingKinds();
  const relationships = Object.fromEntries(kinds.map((b) => [toRelationshipKind(b), { notation: b }]));
  return generated(
    [
      `${kinds.length} Worker binding kinds, from the Workers API schema in @distilled.cloud/cloudflare.`,
      "Regenerate with:  alchemy-likec4 spec --project <dir>",
    ],
    generate(Builder.forSpecification({ relationships }).builder.build()),
  );
};

/** The two container kinds a stack graph needs that no alchemy resource provides. Declared once,
 *  in their own generated file, so several stacks' `.gen.c4` files can share a project. */
const STACK_KINDS = { alchemy_stack: {}, alchemy_namespace: {} } as const;

export const buildStackSpecification = (): string =>
  generated(
    ["The containers a stack graph needs that no alchemy resource provides."],
    generate(Builder.forSpecification({ deployments: STACK_KINDS }).builder.build()),
  );

/** Root id of a stack's deployment nodes. The stage is in it so one file per stage can share a project. */
export const stackId = (graph: Pick<StackGraph, "name" | "stage">): string =>
  toIdentifier(`${graph.name}_${graph.stage}`);

/**
 * Render a stack graph as a `deployment` block: the stack as root node, namespaces nested under it,
 * one node per resource with its canonical type as kind, and one relation per edge. Kinds are
 * referenced, not declared — they live in the generated specification files. A consumer maps
 * nodes onto the logical model with `extend <node> { instanceOf … }` in a hand-written file.
 *
 * Handed to the printer as data; nesting is by dotted id, and its schema validates the shape.
 */
export const buildDeployment = (graph: StackGraph): string => {
  const root = stackId(graph);
  const idOf = (r: StackResource) => [root, ...r.namespace.map(toIdentifier), toIdentifier(r.logicalId)].join(".");
  const byFqn = new Map(graph.resources.map((r) => [r.fqn, idOf(r)]));
  if (new Set(byFqn.values()).size !== byFqn.size) throw new Error("resource ids collide after sanitising");

  // Each namespace once, from the paths the resources sit on.
  const namespaces = new Map<string, string>();
  for (const r of graph.resources)
    for (let i = 0; i < r.namespace.length; i++)
      namespaces.set([root, ...r.namespace.slice(0, i + 1).map(toIdentifier)].join("."), r.namespace[i] as string);

  const elements = [
    { id: root, kind: "alchemy_stack", title: `${graph.name} (${graph.stage})`, metadata: { stage: graph.stage } },
    ...[...namespaces].map(([id, title]) => ({ id, kind: "alchemy_namespace", title })),
    ...graph.resources.map((r) => ({
      id: idOf(r),
      kind: toIdentifier(r.type),
      title: r.logicalId,
      metadata: { fqn: r.fqn, type: r.type, ...(r.name ? { name: r.name } : {}) },
    })),
  ];
  const relations = graph.edges.map((e) => ({
    source: { deployment: byFqn.get(e.from) as string },
    target: { deployment: byFqn.get(e.to) as string },
    title: e.sid ?? "",
    ...(e.kind === "prop" ? {} : { kind: toRelationshipKind(e.kind) }),
  }));

  return generated(
    [
      `Stack ${graph.name}, stage ${graph.stage}: ${graph.resources.length} resources, ${graph.edges.length} edges.`,
      `Regenerate with:  alchemy-likec4 deployment --project <dir> --stage ${graph.stage}`,
      "",
      "Map nodes onto the logical model from a hand-written file:  extend <node> { instanceOf <element> }",
    ],
    generate({ deployments: { elements, relations } } as Parameters<typeof generate>[0]),
  );
};
