/**
 * Render extracted resources as a LikeC4 `specification` block.
 *
 * Identifiers are flat snake_case with the provider kept: `Cloudflare.R2.Bucket` becomes
 * `cloudflare_r2_bucket`. Flat because LikeC4 identifiers cannot contain dots — dots are FQN
 * separators, so a canonical id is not a legal identifier. Provider kept because a bare
 * `bucket` collides across providers, and AWS has one.
 */
import type { AlchemyResource } from "./extract.ts";

/** `Cloudflare.R2.Bucket` → `cloudflare_r2_bucket`. Splits camelCase so `D1Database` reads. */
export const toIdentifier = (type: string): string =>
  type
    .split(".")
    .flatMap((seg) => seg.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[\s_-]+/))
    .filter(Boolean)
    .join("_")
    .toLowerCase();

interface Style {
  readonly shape?: string;
  readonly color?: string;
  readonly icon?: string;
}

/** Style per alchemy `@category`. Fifteen curated groups beat any namespace heuristic, and
 *  they are alchemy's own — a new resource inherits the right look without us touching this. */
const BY_CATEGORY: Readonly<Record<string, Style>> = {
  "Workers & Compute": { shape: "component", color: "amber" },
  "Developer Platform": { shape: "component", color: "amber" },
  "Storage & Databases": { shape: "storage", color: "indigo" },
  AI: { shape: "component", color: "indigo" },
  Media: { shape: "storage", color: "indigo" },
  Email: { shape: "rectangle", color: "green" },
  "Domains & DNS": { shape: "rectangle", color: "green" },
  Network: { shape: "rectangle", color: "green" },
  "Cloudflare One (Zero Trust)": { shape: "rectangle", color: "red" },
  "Application Security": { shape: "rectangle", color: "red" },
  "Account & Identity": { shape: "rectangle", color: "red" },
  "SSL/TLS & Certificates": { shape: "rectangle", color: "red" },
  "Observability & Analytics": { shape: "rectangle", color: "slate" },
  "Performance & Reliability": { shape: "rectangle", color: "slate" },
  "Rules & Configuration": { shape: "rectangle", color: "slate" },
};

/** Icons are sparse — LikeC4 ships a Cloudflare mark and a Workers mark, nothing per service. */
const iconFor = (provider: string, category: string | undefined): string | undefined => {
  if (provider !== "Cloudflare") return undefined;
  return category === "Workers & Compute" || category === "Developer Platform"
    ? "tech:cloudflare-workers"
    : "tech:cloudflare";
};

/** Binding kinds, as relationship kinds. Hand-listed on purpose: alchemy models a binding as a
 *  property on a Worker's `env`, not as a resource, so there is nothing to reflect over.
 *  `Cloudflare.DurableObject` and `Cloudflare.Website.Astro` are the same story — plain factory
 *  functions with no `.Type`. An Astro site IS a `cloudflare_worker` once deployed. */
const RELATIONSHIPS: ReadonlyArray<readonly [string, string, string]> = [
  ["service_binding", "Service binding", "Worker-to-Worker, in-account, no public hop"],
  ["durable_object_binding", "Durable Object", "DO namespace, addressed by getByName"],
  ["r2_binding", "R2", "Native bucket binding"],
  ["d1_binding", "D1", "SQL database binding"],
  ["kv_binding", "KV", "Key-value namespace binding"],
  ["queue_binding", "Queue", "Producer binding"],
  ["workflow_binding", "Workflow", "Workflow instance control"],
  ["container_binding", "Container", "Container application, held by a DO"],
  ["email_binding", "Email", "Cloudflare Email Sending"],
  ["ai_binding", "AI", "Workers AI"],
  ["secret", "Secret", "Encrypted Worker secret"],
  ["var", "Var", "Plain Worker variable"],
];

export interface EmitOptions {
  readonly alchemyVersion: string;
  readonly provider: string;
  /** Canonical type → alchemy `@category`. Absent entries fall back to a default style. */
  readonly categories?: ReadonlyMap<string, string>;
  readonly includeStyles?: boolean;
  /** Binding relationship kinds are Cloudflare-shaped, so only that provider emits them. */
  readonly includeRelationships?: boolean;
}

const indent = (n: number) => "  ".repeat(n);

export const emitSpecification = (resources: readonly AlchemyResource[], opts: EmitOptions): string => {
  const { alchemyVersion, provider, categories, includeStyles = true, includeRelationships = true } = opts;
  const out: string[] = [];

  out.push(
    "// GENERATED — DO NOT EDIT.",
    "//",
    `// ${resources.length} ${provider} resources, reflected from alchemy@${alchemyVersion}.`,
    "// Regenerate with:  bun run generate",
    "//",
    "// Every kind below is a resource alchemy can provision, identified by the `.Type` it",
    "// registers itself under. Unused kinds are harmless — LikeC4 validates a specification",
    "// with kinds nothing instantiates, so one shared file serves every repo.",
    "//",
    "// Factories and bindings are NOT here: `DurableObject`, `Email.SendEmail` and",
    "// `Website.Astro` are plain functions with no `.Type`. An Astro site IS a worker once",
    "// deployed; bindings appear below as relationship kinds.",
    "",
    "specification {",
  );

  // Grouped by category where known, else by namespace — so each header appears exactly once.
  const groupOf = (r: AlchemyResource) => categories?.get(r.type) ?? r.namespace ?? "(root)";
  const grouped = [...resources].sort((a, b) => {
    const g = groupOf(a).localeCompare(groupOf(b));
    return g !== 0 ? g : a.type.localeCompare(b.type);
  });

  let lastGroup: string | undefined;
  for (const r of grouped) {
    const group = groupOf(r);
    if (group !== lastGroup) {
      out.push(`${indent(1)}// ── ${group} ──`);
      lastGroup = group;
    }

    const id = toIdentifier(r.type);
    const shortType = r.type.replace(/^[^.]+\./, "");
    const note = r.exportPath !== shortType ? ` // exported as ${r.exportPath}` : "";

    if (!includeStyles) {
      out.push(`${indent(1)}deploymentNode ${id}${note}`);
      continue;
    }

    const category = categories?.get(r.type);
    const style = (category && BY_CATEGORY[category]) ?? { shape: "rectangle" };
    const icon = iconFor(provider, category);

    out.push(`${indent(1)}deploymentNode ${id} {${note}`);
    out.push(`${indent(2)}notation '${r.type}'`);
    out.push(`${indent(2)}style {`);
    if (style.shape) out.push(`${indent(3)}shape ${style.shape}`);
    if (style.color) out.push(`${indent(3)}color ${style.color}`);
    if (icon) out.push(`${indent(3)}icon ${icon}`);
    out.push(`${indent(2)}}`);
    out.push(`${indent(1)}}`);
  }

  if (includeRelationships) {
    out.push("", `${indent(1)}// ── bindings ──`);
    for (const [id, title, desc] of RELATIONSHIPS) {
      out.push(`${indent(1)}relationship ${id} {`);
      out.push(`${indent(2)}title '${title}'`);
      out.push(`${indent(2)}description '${desc}'`);
      out.push(`${indent(1)}}`);
    }
  }

  out.push("}", "");
  return out.join("\n");
};
