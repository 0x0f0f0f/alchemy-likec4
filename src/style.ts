/**
 * Pick a LikeC4 shape and colour for an alchemy resource type.
 *
 * This is the one table in the package, and it cannot be derived: nothing in alchemy knows that
 * LikeC4 has ten shapes. It is keyed on alchemy's own `@category` vocabulary rather than on
 * resource names, so it is 15 rows instead of 1057, and `style.test.ts` fails when alchemy adds a
 * category we have not placed.
 *
 * Only Cloudflare carries `@category`. Every other provider falls back to a suffix rule on the
 * resource name, which is weaker but needs no per-provider curation: a `Bucket` is storage and a
 * `Queue` is a queue whoever ships it.
 */

/** LikeC4's `ElementShapes`, from `@likec4/core`. */
export type Shape =
  | "rectangle"
  | "person"
  | "browser"
  | "mobile"
  | "cylinder"
  | "storage"
  | "queue"
  | "bucket"
  | "document"
  | "component";

/** LikeC4's theme colours. The docs list eight; the grammar accepts these eleven (verified). */
export type Color =
  | "primary"
  | "secondary"
  | "muted"
  | "amber"
  | "gray"
  | "green"
  | "indigo"
  | "red"
  | "sky"
  | "blue"
  | "slate";

export interface Style {
  readonly shape: Shape;
  readonly color: Color;
}

/** alchemy's Cloudflare `@category` values → a shape and colour. Every category has a row. */
export const BY_CATEGORY: Readonly<Record<string, Style>> = {
  "Workers & Compute": { shape: "component", color: "amber" },
  "Storage & Databases": { shape: "storage", color: "indigo" },
  AI: { shape: "component", color: "green" },
  "Developer Platform": { shape: "component", color: "amber" },
  Media: { shape: "document", color: "indigo" },
  Email: { shape: "queue", color: "green" },
  "Domains & DNS": { shape: "rectangle", color: "sky" },
  Network: { shape: "rectangle", color: "secondary" },
  "Performance & Reliability": { shape: "rectangle", color: "green" },
  "Observability & Analytics": { shape: "document", color: "blue" },
  "Application Security": { shape: "rectangle", color: "red" },
  "SSL/TLS & Certificates": { shape: "document", color: "red" },
  "Cloudflare One (Zero Trust)": { shape: "rectangle", color: "red" },
  "Account & Identity": { shape: "rectangle", color: "slate" },
  "Rules & Configuration": { shape: "document", color: "muted" },
};

/** Last resort, when no category and no suffix matches. */
export const DEFAULT_STYLE: Style = { shape: "rectangle", color: "primary" };

/** Suffix of the resource name → a shape. Ordered: the first match wins. */
const BY_SUFFIX: ReadonlyArray<readonly [RegExp, Style]> = [
  [/(Bucket|Object)$/, { shape: "bucket", color: "indigo" }],
  [/(Queue|Topic|Stream|Subscription)$/, { shape: "queue", color: "amber" }],
  [
    /(Database|Table|Cluster|Store|Namespace|Index|Vault|Volume|Disk|Dataset|Branch)$/,
    {
      shape: "storage",
      color: "indigo",
    },
  ],
  [
    /(Function|Worker|Container|Service|App|Machine|Server|Instance|Deployment|Job|Task|Image)$/,
    {
      shape: "component",
      color: "amber",
    },
  ],
  [/(Certificate|Policy|Role|Key|Secret|Token|Grant|Permission)$/, { shape: "document", color: "red" }],
  [
    /(Zone|Record|Domain|Route|Gateway|Endpoint|Network|Firewall|LoadBalancer)$/,
    {
      shape: "rectangle",
      color: "secondary",
    },
  ],
];

/**
 * A shape and colour for a canonical resource type.
 *
 * Shape comes from the resource name and colour from the category, because the two answer
 * different questions. `Storage & Databases` holds buckets, databases and queues, so the category
 * alone would draw a queue as a cylinder; the name alone would colour a bucket the same whichever
 * cloud product it belongs to.
 *
 * @param type canonical id, e.g. `Cloudflare.R2.Bucket`
 * @param category alchemy's `@category` for it, when the provider ships one
 */
export const styleFor = (type: string, category?: string): Style => {
  const byCategory = category ? BY_CATEGORY[category] : undefined;
  const resource = type.split(".").pop() ?? "";
  const bySuffix = BY_SUFFIX.find(([suffix]) => suffix.test(resource))?.[1];
  return {
    shape: bySuffix?.shape ?? byCategory?.shape ?? DEFAULT_STYLE.shape,
    color: byCategory?.color ?? bySuffix?.color ?? DEFAULT_STYLE.color,
  };
};
