/**
 * Build LikeC4 with LikeC4's own Builder and print it with its own generator.
 *
 * Nothing here is typed by hand: kinds come from alchemy's `.Type`s, tags from its `@category`,
 * technology from its `@product`, relationship kinds from Cloudflare's binding schema, and nodes,
 * edges and descriptions from a compiled stack.
 *
 * The specification is built and printed SEPARATELY from the model. LikeC4 rejects a kind declared
 * twice in one project, so a repo with several stacks — alchemy's own shape for an org — cannot
 * have each stack carry its own copy. One `specification.gen.c4` holds the union of every kind the
 * run saw; each `<Stack>.model.gen.c4` is a bare `model { }`.
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
import { toRelationshipKind } from "./bindings.ts";
import type { StackProse } from "./describe.ts";
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

/** Namespace container paths a stack's resources sit on, innermost last. */
const namespacesOf = (root: string, resources: readonly StackResource[]): ReadonlyMap<string, string> => {
  const out = new Map<string, string>();
  for (const r of resources)
    for (let i = 0; i < r.namespace.length; i++)
      out.set([root, ...r.namespace.slice(0, i + 1).map(toIdentifier)].join("."), r.namespace[i] as string);
  return out;
};

/** Whether any of these stacks nests a resource in a namespace. */
export const hasNamespaces = (graphs: ReadonlyArray<Pick<StackGraph, "resources">>): boolean =>
  graphs.some((g) => g.resources.some((r) => r.namespace.length > 0));

/**
 * Path of every resource inside a container, keyed by FQN — e.g. `shortener.api`.
 *
 * Sanitising lowercases, so two logical ids that differ only by case land on one identifier:
 * `Wiki` (an Access application) and `wiki` (the Website in front of it) both become `wiki`. A
 * logical id IS an alchemy state row, so a consumer with deployed state cannot rename either one.
 * The canonical type is what tells them apart and it is stable, so the disambiguated id is too.
 *
 * A namespace container counts as one of the group: alchemy nests a Website's `Command.Build`
 * under a namespace named after the site, and the Worker keeps the site's logical id, so the two
 * land on the same id and the Builder rejects the second as a redeclaration.
 */
const pathsOf = (root: string, resources: readonly StackResource[]): ReadonlyMap<string, string> => {
  const base = (r: StackResource) => [root, ...r.namespace.map(toIdentifier), toIdentifier(r.logicalId)].join(".");
  const shared = new Map<string, number>([...namespacesOf(root, resources).keys()].map((id) => [id, 1]));
  for (const r of resources) shared.set(base(r), (shared.get(base(r)) ?? 0) + 1);

  const out = new Map<string, string>();
  for (const r of resources)
    out.set(r.fqn, (shared.get(base(r)) as number) > 1 ? `${base(r)}_${toIdentifier(r.type)}` : base(r));

  if (new Set(out.values()).size !== out.size) {
    const byId = new Map<string, string[]>();
    for (const [fqn, id] of out) byId.set(id, [...(byId.get(id) ?? []), fqn]);
    const clash = [...byId].filter(([, fqns]) => fqns.length > 1).map(([id, fqns]) => `${id} ← ${fqns.join(", ")}`);
    throw new Error(`resource ids collide after sanitising: ${clash.join("; ")}`);
  }
  return out;
};

type ElementHelper = (id: string, props?: object) => { with: (...children: unknown[]) => unknown };
type ModelHelpers = Record<string, ElementHelper> & {
  model: (...children: unknown[]) => unknown;
  rel: (from: string, to: string, props?: object) => unknown;
};

/** What `Builder.build()` returns: the parsed model the printer takes. */
type BuiltModel = {
  specification: { tags: Record<string, unknown> };
  elements: unknown;
  relations: unknown;
};

/** Compose a Builder into a parsed model. Its helper types are keyed by the kinds declared above,
 *  which are only known at runtime here, so the composition step is cast rather than inferred. */
const compose = (builder: unknown, children: unknown[]): BuiltModel => {
  const b = builder as {
    builder: { with: (input: unknown) => { build: () => BuiltModel } };
    model: ModelHelpers;
  };
  return b.builder.with(b.model.model(...children)).build();
};

export interface SpecificationOptions {
  readonly alchemyVersion: string;
  /** Canonical types to declare kinds for — the union across every stack in the run. */
  readonly kinds: readonly string[];
  /** Canonical type → what its declaring file says: `@category`, `@product`. */
  readonly annotations: ReadonlyMap<string, Annotations>;
  /** Binding kinds to declare as relationship kinds — the union across every stack. */
  readonly bindings: readonly string[];
  /** Whether any stack nests resources in a namespace. */
  readonly namespaces: boolean;
}

/**
 * The vocabulary, in a file of its own: one `element` kind per resource type, styled from its
 * category and given the vendor's icon, plus the container kinds and one `relationship` per
 * binding kind.
 *
 * Written once per project rather than once per stack, because LikeC4 rejects a kind declared
 * twice and a monorepo has as many stacks as it has composition roots.
 */
export const buildSpecification = (opts: SpecificationOptions): string => {
  const { alchemyVersion, kinds, annotations, bindings, namespaces } = opts;

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
  // A stack is drawn twice: as the boundary around its own resources, and — since `buildViews`
  // scopes a view to it — as one closed box in a diagram that spans stacks. Dashed keeps it
  // reading as a boundary; the fill has to stay solid enough that the closed box is not a ghost.
  elements[STACK_KIND] = {
    notation: "Alchemy stack",
    style: { shape: "rectangle", color: "muted", opacity: 30, border: "dashed" },
  };
  if (namespaces)
    elements[NAMESPACE_KIND] = {
      notation: "Nested resources",
      style: { shape: "rectangle", color: "muted", opacity: 20 },
    };

  const b = Builder.forSpecification({
    elements,
    deployments: {
      [STACK_KIND]: { notation: "Alchemy stack" },
      ...(namespaces ? { [NAMESPACE_KIND]: { notation: "Nested resources" } } : {}),
    },
    relationships: Object.fromEntries([...bindings].sort().map((k) => [toRelationshipKind(k), { notation: k }])),
    tags: Object.fromEntries([...tags].sort().map((t) => [t, {}])),
  });
  const built = compose(b, []);
  // The Builder assigns each tag a palette colour (`tomato`, `grass`, …) the DSL does not accept.
  // No colour is right anyway: styling by tag is the consumer's.
  for (const tag of Object.values(built.specification.tags)) delete (tag as { color?: string }).color;

  return generated(
    [
      `${Object.keys(elements).length} kinds and ${bindings.length} binding kinds,`,
      `reflected from alchemy@${alchemyVersion}.`,
      "Regenerate with:  alchemy-likec4 generate --project <dir> --entrypoint <stack> …",
      "",
      "One file for the whole project: LikeC4 rejects a kind declared twice, so the stacks that",
      "use these kinds carry none of their own.",
      "",
      "Enrich from your own file:  extend <element> { #tag  metadata { … }  link … }",
      "`extend` cannot set a description — write one as JSDoc above the resource in your stack.",
    ],
    print({ specification: built.specification }),
  );
};

export interface ModelOptions {
  /** Canonical types this stack uses. They must be declared in the project's specification. */
  readonly kinds: readonly string[];
  /** Binding kinds this stack wires. */
  readonly bindings: readonly string[];
  /** Logical id → the JSDoc prose above it in the stack. */
  readonly descriptions: ReadonlyMap<string, string>;
  /** What the stack says about itself, from the JSDoc above its own declaration. */
  readonly stack?: StackProse;
}

/**
 * One stack as a `model { }` block: one element per resource and one relationship per binding.
 *
 * The Builder is given the kinds STRIPPED of style, tags and technology. It resolves a kind's
 * style onto each element it builds, and the printer emits whatever an element carries — so a
 * styled kind here would inline a redundant `style { … }` on every element. The real declarations
 * live in `buildSpecification`, and the elements reference them by kind name at parse time.
 */
export const buildModel = (graph: StackGraph, opts: ModelOptions): string => {
  const { kinds, bindings, descriptions, stack } = opts;
  const root = modelId(graph);
  const namespaces = namespacesOf(root, graph.resources);

  const b = Builder.forSpecification({
    elements: Object.fromEntries([
      ...kinds.map((type) => [toIdentifier(type), {}] as const),
      [STACK_KIND, {}] as const,
      ...(namespaces.size > 0 ? [[NAMESPACE_KIND, {}] as const] : []),
    ]),
    deployments: {},
    relationships: Object.fromEntries(bindings.map((k) => [toRelationshipKind(k), {}])),
    tags: {},
  });
  const h = b.model as unknown as ModelHelpers;

  const paths = pathsOf(root, graph.resources);
  // Children are declared relative to the container they sit in.
  const local = (path: string) => path.slice(root.length + 1);
  const children: unknown[] = [
    ...[...namespaces].map(([id, title]) => (h[NAMESPACE_KIND] as ElementHelper)(local(id), { title })),
    ...graph.resources.map((r) => {
      const description = descriptions.get(r.logicalId);
      return (h[toIdentifier(r.type)] as ElementHelper)(local(paths.get(r.fqn) as string), {
        title: r.logicalId,
        ...(description ? { description } : {}),
        metadata: { fqn: r.fqn, type: r.type },
      });
    }),
    ...graph.edges.map((e) =>
      h.rel(paths.get(e.from) as string, paths.get(e.to) as string, {
        ...(e.sid ? { title: e.sid } : {}),
        ...(e.kind === "prop" ? {} : { kind: toRelationshipKind(e.kind) }),
      }),
    ),
  ];

  // The stack is a box a reader opens, so it carries its own prose and, when the author said so,
  // its own icon and colour. Resources take styling from their kind; a stack has only one kind, so
  // telling two of them apart has to come from the stack itself.
  const rootProps = {
    title: graph.name,
    ...(stack?.description ? { description: stack.description } : {}),
    ...(stack?.icon || stack?.color
      ? { style: { ...(stack.icon ? { icon: stack.icon } : {}), ...(stack.color ? { color: stack.color } : {}) } }
      : {}),
  };
  const built = compose(b, [(h[STACK_KIND] as ElementHelper)(root, rootProps).with(...children)]);

  return generated(
    [
      `Stack ${graph.name}: ${graph.resources.length} resources, ${graph.edges.length} relationships.`,
      "Kinds are declared once for the whole project, in specification.gen.c4.",
      "Regenerate with:  alchemy-likec4 generate --project <dir> --entrypoint <stack> …",
      "",
      "Relationships live here, not in the deployment: LikeC4 inherits deployment relationships",
      "from the logical model, so these reach deployment views through `instanceOf`.",
    ],
    print({ elements: built.elements, relations: built.relations }),
  );
};

/** A relationship whose two ends are in different stacks' models. */
export interface CrossStackRelation {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly sid: string | undefined;
}

export interface CrossStack {
  readonly relations: readonly CrossStackRelation[];
  /** Refs whose target stack was not in the run, as `<stack>/<resource> → <stack>/<id>`. */
  readonly unresolved: readonly string[];
}

/**
 * Cross-stack edges resolved against the other stacks in the same run.
 *
 * A ref names `(stack, logical id)` rather than referencing a resource, so the element id can only
 * be derived where the target's graph is — nowhere inside the stack that holds the ref. A ref whose
 * target is not in the run is reported, not drawn: an arrow to a box outside the model is worse
 * than no arrow.
 */
export const crossStackRelations = (graphs: readonly StackGraph[]): CrossStack => {
  const index = new Map<string, Map<string, string>>();
  for (const g of graphs) {
    const paths = pathsOf(modelId(g), g.resources);
    const byKey = new Map(g.resources.map((r) => [r.fqn, paths.get(r.fqn) as string]));
    // A ref is given a logical id; a nested resource's FQN carries its namespace too. Answer both,
    // with the FQN winning when a nested resource shares a root resource's logical id.
    for (const r of g.resources) if (!byKey.has(r.logicalId)) byKey.set(r.logicalId, paths.get(r.fqn) as string);
    index.set(g.name, byKey);
  }

  const relations: CrossStackRelation[] = [];
  const unresolved: string[] = [];
  for (const g of graphs)
    for (const e of g.crossEdges) {
      const from = index.get(g.name)?.get(e.from) as string;
      const to = index.get(e.stack)?.get(e.id);
      if (to === undefined) unresolved.push(`${g.name}/${e.from} → ${e.stack}/${e.id}`);
      // A ref that resolves to its own holder is not a relationship, and LikeC4 rejects the
      // self-edge outright ("Invalid parent-child relationship"). `deriveGraph` guards the
      // in-stack edges the same way.
      else if (to !== from) relations.push({ from, to, kind: e.kind, sid: e.sid });
    }
  relations.sort((a, b) => `${a.from}|${a.to}|${a.sid}`.localeCompare(`${b.from}|${b.to}|${b.sid}`));
  return { relations, unresolved };
};

/**
 * The relationships that cross a stack boundary, in a file of their own.
 *
 * Templated rather than built, like the views: LikeC4's Builder resolves a relationship's ends
 * against the elements it was given, and the far end is declared in another stack's file.
 */
export const buildCrossStack = ({ relations, unresolved }: CrossStack): string => {
  const arrow = (r: CrossStackRelation) => (r.kind === "prop" ? "->" : `-[${toRelationshipKind(r.kind)}]->`);
  const title = (r: CrossStackRelation) => (r.sid ? ` '${r.sid.replace(/'/g, "\\'")}'` : "");
  return generated(
    [
      `${relations.length} relationship${relations.length === 1 ? "" : "s"} crossing a stack boundary.`,
      "Regenerate with:  alchemy-likec4 generate --project <dir> --entrypoint <stack> …",
      "",
      "A ref names its target's stack and logical id instead of referencing it, so only a run that",
      "holds both stacks can draw the arrow: pass every --entrypoint, or these go missing.",
      // Named rather than dropped: these are the arrows this project is missing, and each one
      // names the --entrypoint that would draw it.
      ...(unresolved.length === 0 ? [] : ["", "Not drawn — the target's stack was not in the run:", ...unresolved]),
    ],
    relations.length === 0
      ? ""
      : ["model {", ...relations.map((r) => `  ${r.from} ${arrow(r)} ${r.to}${title(r)}`), "}", ""].join("\n"),
  );
};

/** `mcp.rel-int.ai` → `https://mcp.rel-int.ai`. A domain may already carry a scheme or a path. */
const urlOf = (domain: string): string => (/^https?:\/\//.test(domain) ? domain : `https://${domain}`);

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
  const here = pathsOf(root, graph.resources);
  const there = pathsOf(model, graph.resources);

  const elements = [
    { id: root, kind: STACK_KIND, title: `${graph.name} (${graph.stage})`, metadata: { stage: graph.stage } },
    ...[...namespaces].map(([id, title]) => ({ id, kind: NAMESPACE_KIND, title })),
    ...graph.resources.map((r) => ({
      id: here.get(r.fqn) as string,
      element: there.get(r.fqn) as string,
      metadata: {
        fqn: r.fqn,
        type: r.type,
        ...(r.name ? { name: r.name } : {}),
        ...(r.domain ? { domain: r.domain } : {}),
      },
      // A door belongs to a stage, not to the element: the same Worker answers on
      // `mcp.rel-int.ai` here and `mcp-staging.rel-int.ai` in the file next door.
      ...(r.domain ? { links: [{ url: urlOf(r.domain), title: graph.stage }] } : {}),
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
 * Every stack in the run, opened, in one view.
 *
 * The per-stack views are scoped, which is what makes a stack a box you click — but a box you
 * click is closed until you click it. This is the other half: the whole estate at once, every
 * resource on screen. It spans stacks, so like the cross-stack relationships it belongs to the
 * run rather than to any one of them.
 *
 * Not named `index`: LikeC4 generates that one when a project defines none, and claiming the name
 * would silently replace whatever the consumer wrote.
 */
export const buildLandscape = (graphs: ReadonlyArray<Pick<StackGraph, "name">>): string => {
  const roots = [...new Set(graphs.map((g) => modelId(g)))].sort();
  return generated(
    [
      `Every resource of ${roots.length} stack${roots.length === 1 ? "" : "s"}, in one view.`,
      "Regenerate with:  alchemy-likec4 generate --project <dir>",
    ],
    [
      "views {",
      "  view landscape {",
      "    title 'Landscape'",
      "    include *,",
      ...roots.map((r, i) => `      ${r}.*, ${r}.**${i === roots.length - 1 ? "" : ","}`),
      "  }",
      "}",
      "",
    ].join("\n"),
  );
};

/**
 * One view OF each stack and one deployment view per stage, so the first run renders something.
 *
 * Templated rather than built: the Builder's `$include` drops `.*` selectors and `$autoLayout`.
 *
 * `of` is load-bearing. A scoped view becomes its element's default, and that is what puts the
 * navigate button on the stack — a box a reader can open, rather than a boundary they can only
 * look at. It also changes what the wildcard means: scoped, `*` is the stack, its resources AND
 * whatever they relate to outside it.
 *
 * `.**` is never written alone. It reaches a resource alchemy nested under a namespace, which the
 * children selector leaves out, but it drops any resource with no relationship. The scoped `*`
 * covers that in the model view; the deployment views have no wildcard, so they keep `.*` too.
 */
export const buildViews = (graph: Pick<StackGraph, "name">, stages: readonly string[]): string => {
  const model = modelId(graph);
  const body = [
    `  view ${model}_overview of ${model} {`,
    `    title '${graph.name} / Overview'`,
    "    order 1",
    `    include *, ${model}.**`,
    "  }",
    ...[...stages].sort().flatMap((stage) => {
      const root = stackId({ name: graph.name, stage });
      return [
        "",
        `  deployment view ${root} {`,
        `    title '${graph.name} / ${stage}'`,
        `    include ${root}, ${root}.*, ${root}.**`,
        "    autoLayout LeftRight",
        "  }",
      ];
    }),
  ];
  return generated(
    [
      "One view of each stack, and one per stage. Delete this file and write your own.",
      "Regenerate with:  alchemy-likec4 generate --project <dir>",
    ],
    ["views {", ...body, "}", ""].join("\n"),
  );
};
