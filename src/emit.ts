/**
 * Render extracted resources as a LikeC4 `specification` block.
 *
 * Identifiers are flat snake_case with the provider kept: `Cloudflare.R2.Bucket` becomes
 * `cloudflare_r2_bucket`. Flat because LikeC4 identifiers cannot contain dots — dots are FQN
 * separators, so the canonical id is not a legal identifier. Provider kept because a bare
 * `bucket` collides the day a second provider is generated, and AWS has one.
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

/** Shape and icon by namespace. Deliberately coarse — a wrong-looking box is a cheap problem,
 *  and a per-resource table would be 241 hand-maintained rows, i.e. the thing we are avoiding. */
const STYLE: ReadonlyArray<readonly [RegExp, { shape?: string; icon?: string; color?: string }]> = [
  [/^Cloudflare\.(Worker|Container|Workflow|DynamicWorker)$/, { shape: "component", icon: "tech:cloudflare-workers", color: "amber" }],
  [/^Cloudflare\.Workers\./, { shape: "component", icon: "tech:cloudflare-workers", color: "amber" }],
  [/^Cloudflare\.Workflows?\./, { shape: "component", icon: "tech:cloudflare-workers", color: "amber" }],
  [/^Cloudflare\.R2\./, { shape: "storage", icon: "tech:cloudflare", color: "indigo" }],
  [/^Cloudflare\.KV\./, { shape: "storage", icon: "tech:cloudflare", color: "indigo" }],
  [/^Cloudflare\.D1/, { shape: "storage", icon: "tech:sqlite", color: "indigo" }],
  [/^Cloudflare\.Hyperdrive/, { shape: "storage", icon: "tech:cloudflare", color: "indigo" }],
  [/^Cloudflare\.Queues\./, { shape: "queue", icon: "tech:cloudflare", color: "indigo" }],
  [/^Cloudflare\.(Zone|DNS)\./, { shape: "rectangle", icon: "tech:cloudflare", color: "green" }],
  [/^Cloudflare\.Email\./, { shape: "rectangle", icon: "tech:cloudflare", color: "green" }],
  [/^Cloudflare\.(Access|Gateway|ApiShield|BotManagement|Turnstile)\./, { shape: "rectangle", icon: "tech:cloudflare", color: "red" }],
  [/^Cloudflare\.ApiToken\./, { shape: "rectangle", icon: "tech:cloudflare", color: "red" }],
];

const styleFor = (type: string) =>
  STYLE.find(([re]) => re.test(type))?.[1] ?? { shape: "rectangle", icon: "tech:cloudflare" };

/** Binding kinds, as relationship kinds. Hand-listed, and that is the honest choice: alchemy
 *  models a binding as a property on a Worker's `env`, not as a resource, so there is nothing
 *  to reflect over. Twelve entries that change about once a year beats a fragile scrape. */
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
  /** Version of the package the resources came from — stamped in the header. */
  readonly alchemyVersion: string;
  /** Provider label for the header, e.g. `Cloudflare`. */
  readonly provider: string;
  readonly includeStyles?: boolean;
  readonly includeRelationships?: boolean;
}

const indent = (n: number) => "  ".repeat(n);

export const emitSpecification = (resources: readonly AlchemyResource[], opts: EmitOptions): string => {
  const { alchemyVersion, provider, includeStyles = true, includeRelationships = true } = opts;
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
    "// Bindings are NOT here. alchemy models a binding as a property of a Worker's `env`",
    "// rather than a resource, so `Cloudflare.DurableObject` and `Cloudflare.Email.SendEmail`",
    "// have no `.Type`. They appear below as relationship kinds instead.",
    "",
    "specification {",
  );

  // Group by namespace so each `// ── X ──` header appears exactly once. Sorting by
  // canonical id alone interleaves root-level resources between namespaces.
  const grouped = [...resources].sort((a, b) => {
    const ns = (a.namespace ?? "").localeCompare(b.namespace ?? "");
    return ns !== 0 ? ns : a.name.localeCompare(b.name);
  });

  let lastNs: string | undefined;
  for (const r of grouped) {
    const ns = r.namespace ?? "(root)";
    if (ns !== lastNs) {
      out.push(`${indent(1)}// ── ${ns} ──`);
      lastNs = ns;
    }
    const id = toIdentifier(r.type);
    const alias = r.exportPath !== r.type.replace(/^[^.]+\./, "") ? `  (exported as ${r.exportPath})` : "";
    if (!includeStyles) {
      out.push(`${indent(1)}deploymentNode ${id}${alias ? ` //${alias}` : ""}`);
      continue;
    }
    const s = styleFor(r.type);
    out.push(`${indent(1)}deploymentNode ${id} {${alias ? ` //${alias}` : ""}`);
    out.push(`${indent(2)}notation '${r.type}'`);
    out.push(`${indent(2)}style {`);
    if (s.shape) out.push(`${indent(3)}shape ${s.shape}`);
    if (s.color) out.push(`${indent(3)}color ${s.color}`);
    if (s.icon) out.push(`${indent(3)}icon ${s.icon}`);
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
