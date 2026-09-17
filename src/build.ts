/**
 * Build LikeC4 with LikeC4's own Builder and print it with its own generator.
 *
 * Nothing here is typed by hand: kinds come from alchemy's `.Type`s, tags from its `@category`,
 * technology from its `@product`, relationship kinds from Cloudflare's binding schema, and nodes,
 * edges and descriptions from a compiled stack.
 *
 * Relationships go in the `model`, never in the `deployment`. LikeC4 inherits deployment
 * relationships from the logical model and never the other way, so a binding declared in the
 * model shows up in logical views AND, through `instanceOf`, in deployment views. Declared in the
 * deployment it reaches only deployment views, which is what forced a consumer to write every
 * relationship a second time by hand.
 */
import { Builder } from "@likec4/core/builder";
import { generate } from "@likec4/generators/likec4";
import type { Annotations } from "./annotations.ts";
import { bindingKinds, toRelationshipKind } from "./bindings.ts";
import { iconFor } from "./icons.ts";
import type { StackGraph, StackResource } from "./stack.ts";
import { styleFor } from "./style.ts";

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

// The Builder's parsed model and the generator's input type disagree on whether `project.styles`
// is optional. Same data; one cast.
const print = (model: unknown): string => generate(model as Parameters<typeof generate>[0]);

/** The printer has no comment support, so provenance is a plain prefix. */
const generated = (about: readonly string[], dsl: string): string =>
  ["// GENERATED — DO NOT EDIT.", ...about.map((l) => (l ? `// ${l}` : "//")), "", dsl].join("\n");

/** The container kinds a stack graph needs that no alchemy resource provides. */
const STACK_KIND = "alchemy_stack";
const NAMESPACE_KIND = "alchemy_namespace";

/** Root id of a stack's logical elements. Stage-independent: every stage instantiates these. */
export const modelId = (graph: Pick<StackGraph, "name">): string => toIdentifier(graph.name);

/** Root id of a stack's deployment nodes. The stage is in it so one file per stage can share a project. */
export const stackId = (graph: Pick<StackGraph, "name" | "stage">): string =>
  toIdentifier(`${graph.name}_${graph.stage}`);

/** Path of a resource inside a container, e.g. `shortener.api`. */
const pathOf = (root: string, r: StackResource): string =>
  [root, ...r.namespace.map(toIdentifier), toIdentifier(r.logicalId)].join(".");

/** Namespace container paths a stack's resources sit on, innermost last. */
const namespacesOf = (root: string, resources: readonly StackResource[]): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const r of resources)
    for (let i = 0; i < r.namespace.length; i++)
      out.set([root, ...r.namespace.slice(0, i + 1).map(toIdentifier)].join("."), r.namespace[i] as string);
  return out;
};

export interface BuildOptions {
  readonly alchemyVersion: string;
  /** Canonical types to declare kinds for. A superset of the stack's when `--all-kinds`. */
  readonly kinds: readonly string[];
  /** Canonical type → what its declaring file says: `@category`, `@product`, `@see`. */
  readonly annotations: ReadonlyMap<string, Annotations>;
  /** Logical id → the JSDoc prose above it in the stack. */
  readonly descriptions: ReadonlyMap<string, string>;
  /** Declare every Worker binding kind rather than only the ones this stack wires. */
  readonly allBindings?: boolean;
}

/** What `Builder.build()` returns: the parsed model the printer takes. */
type BuiltModel = { specification: { tags: Record<string, unknown> } };

type ElementHelper = (id: string, props?: object) => { with: (...children: unknown[]) => unknown };
type ModelHelpers = Record<string, ElementHelper> & {
  model: (...children: unknown[]) => unknown;
  rel: (from: string, to: string, props?: object) => unknown;
};

/**
 * The specification and the logical model, in one file: the vocabulary and the stack that uses it.
 *
 * One `element` kind per resource type, styled from its category and given the vendor's icon, plus
 * a `deploymentNode alchemy_stack` for the deployment file's root. Then one element per resource
 * and one relationship per binding.
 */
export const buildModel = (graph: StackGraph, opts: BuildOptions): string => {
  const { alchemyVersion, kinds, annotations, descriptions, allBindings } = opts;
  const root = modelId(graph);

  const tags = new Set<string>();
  const elements: Record<string, object> = {};
  for (const type of [...kinds].sort()) {
    const a = annotations.get(type);
    const tag = a?.category ? toTag(a.category) : undefined;
    if (tag) tags.add(tag);
    const { shape, color } = styleFor(type, a?.category);
    const icon = iconFor(type);
    elements[toIdentifier(type)] = {
      ...(tag ? { tags: [tag] } : {}),
      ...(a?.product ? { technology: a.product } : {}),
      notation: type,
      style: { shape, color, ...(icon ? { icon } : {}) },
    };
  }
  // A stack is a boundary, not a thing, so it is a faint dashed group.
  elements[STACK_KIND] = { style: { shape: "rectangle", color: "muted", opacity: 10, border: "dashed" } };
  const namespaces = namespacesOf(root, graph.resources);
  if (namespaces.size > 0) elements[NAMESPACE_KIND] = { style: { shape: "rectangle", color: "muted", opacity: 10 } };

  const bindings = allBindings
    ? bindingKinds()
    : [...new Set(graph.edges.filter((e) => e.kind !== "prop").map((e) => e.kind))].sort();
  const relationships = Object.fromEntries(bindings.map((b) => [toRelationshipKind(b), { notation: b }]));

  const b = Builder.forSpecification({
    elements,
    deployments: {
      [STACK_KIND]: { notation: "Alchemy stack" },
      ...(namespaces.size > 0 ? { [NAMESPACE_KIND]: {} } : {}),
    },
    relationships,
    tags: Object.fromEntries([...tags].sort().map((t) => [t, {}])),
  });
  const h = b.model as unknown as ModelHelpers;

  const byFqn = new Map(graph.resources.map((r) => [r.fqn, pathOf(root, r)]));
  if (new Set(byFqn.values()).size !== byFqn.size) throw new Error("resource ids collide after sanitising");

  // Children are declared relative to the container they sit in.
  const local = (path: string) => path.slice(root.length + 1);
  const children: unknown[] = [
    ...[...namespaces].map(([id, title]) => (h[NAMESPACE_KIND] as ElementHelper)(local(id), { title })),
    ...graph.resources.map((r) => {
      const description = descriptions.get(r.logicalId);
      return (h[toIdentifier(r.type)] as ElementHelper)(local(pathOf(root, r)), {
        title: r.logicalId,
        ...(description ? { description } : {}),
        metadata: { fqn: r.fqn, type: r.type },
      });
    }),
    ...graph.edges.map((e) =>
      h.rel(byFqn.get(e.from) as string, byFqn.get(e.to) as string, {
        ...(e.sid ? { title: e.sid } : {}),
        ...(e.kind === "prop" ? {} : { kind: toRelationshipKind(e.kind) }),
      }),
    ),
  ];

  // The Builder's helper types are keyed by the kinds declared above, which are only known at
  // runtime here, so the composition step is cast rather than inferred.
  const compose = b.builder.with as unknown as (input: unknown) => { build: () => BuiltModel };
  const built = compose(
    h.model((h[STACK_KIND] as ElementHelper)(root, { title: graph.name }).with(...children)),
  ).build();
  // The Builder assigns each tag a palette colour (`tomato`, `grass`, …) the DSL does not accept.
  // No colour is right anyway: styling by tag is the consumer's.
  for (const tag of Object.values(built.specification.tags)) delete (tag as { color?: string }).color;

  return generated(
    [
      `Stack ${graph.name}: ${graph.resources.length} resources, ${graph.edges.length} relationships,`,
      `${Object.keys(elements).length} kinds, reflected from alchemy@${alchemyVersion}.`,
      "Regenerate with:  alchemy-likec4 generate --project <dir>",
      "",
      "Relationships live here, not in the deployment: LikeC4 inherits deployment relationships",
      "from the logical model, so these reach deployment views through `instanceOf`.",
      "",
      "Enrich from your own file:  extend <element> { #tag  metadata { … }  link … }",
      "`extend` cannot set a description — write one as JSDoc above the resource in your stack.",
    ],
    print(built),
  );
};

/**
 * A stack's resources as deployed instances of the logical model, one file per stage.
 *
 * No relationships: LikeC4 inherits them from the model through `instanceOf`, and declaring them
 * here as well renders every edge twice, because the model-derived edge joins the instances while
 * a deployment relation joins the nodes.
 *
 * Metadata is repeated from the model element because instance metadata REPLACES it rather than
 * merging, and `assert.ts` reads `fqn` off the deployment node.
 */
export const buildDeployment = (graph: StackGraph): string => {
  const root = stackId(graph);
  const model = modelId(graph);
  const namespaces = namespacesOf(root, graph.resources);

  const elements = [
    { id: root, kind: STACK_KIND, title: `${graph.name} (${graph.stage})`, metadata: { stage: graph.stage } },
    ...[...namespaces].map(([id, title]) => ({ id, kind: NAMESPACE_KIND, title })),
    ...graph.resources.map((r) => ({
      id: pathOf(root, r),
      element: pathOf(model, r),
      metadata: { fqn: r.fqn, type: r.type, ...(r.name ? { name: r.name } : {}) },
    })),
  ];

  return generated(
    [
      `Stack ${graph.name}, stage ${graph.stage}: ${graph.resources.length} resources.`,
      `Regenerate with:  alchemy-likec4 generate --project <dir> --stage ${graph.stage}`,
      "",
      "No relationships here on purpose: they are inherited from the model through `instanceOf`.",
    ],
    print({ deployments: { elements, relations: [] } }),
  );
};

/**
 * A landscape view and one deployment view per stage, so the first run renders something.
 *
 * Templated rather than built: the Builder's `$include` drops `.*` selectors and `$autoLayout`.
 * The selector has to be exactly `.*`, because `.**` silently omits resources that have no
 * relationship — an isolated bucket would vanish from the diagram.
 */
export const buildViews = (graph: Pick<StackGraph, "name">, stages: readonly string[]): string => {
  const model = modelId(graph);
  const body = [
    `  view ${model}_landscape {`,
    `    title '${graph.name}'`,
    `    include ${model}, ${model}.*`,
    "  }",
    ...[...stages].sort().flatMap((stage) => {
      const root = stackId({ name: graph.name, stage });
      return [
        "",
        `  deployment view ${root} {`,
        `    title '${graph.name} / ${stage}'`,
        `    include ${root}, ${root}.*`,
        "    autoLayout LeftRight",
        "  }",
      ];
    }),
  ];
  return generated(
    [
      "The landscape, and one view per stage. Delete this file and write your own.",
      "Regenerate with:  alchemy-likec4 generate --project <dir>",
      "",
      "`.*` rather than `.**`: the descendants selector omits resources with no relationship.",
    ],
    ["views {", ...body, "}", ""].join("\n"),
  );
};
