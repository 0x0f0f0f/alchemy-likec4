/**
 * Pick a LikeC4 icon for an alchemy resource type.
 *
 * LikeC4 bundles five icon packs with ids of the form `<pack>:<kebab-name>`. Four of them are
 * cloud vendors, so the mapping is a lookup, not a curated table: take the service segment of the
 * canonical type (`AWS.DynamoDB.Table` → `DynamoDB`), normalise it to alphanumerics, and look it
 * up in that provider's pack. Measured on alchemy@2.0.0-beta.77: 361 of 715 AWS types hit an
 * `aws:` icon exactly and 55 more hit `tech:aws-*`.
 *
 * Cloudflare is the exception. The whole ecosystem has four icons in `tech:` and none per service,
 * so Cloudflare resources get the Workers logo or the brand mark and are told apart by shape and
 * colour instead. See `style.ts`.
 */
import { ICON_NAMES } from "./icons.gen.ts";

/** `Dynamo-DB` and `DynamoDB` must collide, so names are matched on alphanumerics only. */
const normalise = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Built once, on first lookup: normalised name → the real icon name. First wins, alphabetically. */
const packs = new Map<string, ReadonlyMap<string, string>>();
const pack = (name: string): ReadonlyMap<string, string> => {
  const cached = packs.get(name);
  if (cached) return cached;
  const built = new Map<string, string>();
  for (const icon of ICON_NAMES[name] ?? []) if (!built.has(normalise(icon))) built.set(normalise(icon), icon);
  packs.set(name, built);
  return built;
};

const lookup = (name: string, key: string): string | undefined => {
  const icon = pack(name).get(key);
  return icon ? `${name}:${icon}` : undefined;
};

/** Provider segment → the vendor's own pack, where one exists. */
const VENDOR_PACKS: Record<string, string> = { aws: "aws", gcp: "gcp", google: "gcp", azure: "azure" };

/** Cloudflare has no per-service icons, so compute gets the Workers mark and the rest the brand. */
const CLOUDFLARE_COMPUTE = /worker|container|pages|durable/i;

/**
 * A LikeC4 icon id for a canonical resource type, or undefined when no pack has one.
 *
 * @param type canonical id, e.g. `Cloudflare.R2.Bucket`
 */
export const iconFor = (type: string): string | undefined => {
  const segments = type.split(".");
  const provider = segments[0] ?? "";
  // `Provider.Service.Resource` has a service segment; `Provider.Resource` does not, and treating
  // the resource as a service finds nonsense (`Neon.Branch` → a generic `tech:branch`).
  const service = segments.length > 2 ? (segments[1] as string) : "";
  const p = normalise(provider);
  const s = normalise(service);

  // The `-icon` variants are the mark alone; the plain ones carry a wordmark that renders
  // squashed inside a node.
  if (p === "cloudflare")
    return CLOUDFLARE_COMPUTE.test(type) ? "tech:cloudflare-workers-icon" : "tech:cloudflare-icon";

  const vendor = VENDOR_PACKS[p];
  // The vendor's own pack, by service name: `AWS.S3.Bucket` → `aws:s3`.
  if (vendor && s) {
    const own = lookup(vendor, s);
    if (own) return own;
  }
  // Then the community pack, which prefixes the vendor: `tech:aws-cloudfront`.
  const prefixed = s ? lookup("tech", `${p}${s}`) : undefined;
  if (prefixed) return prefixed;
  // Then the service on its own, for services that are products in their own right:
  // `AWS.Aurora.Cluster` → `tech:aurora`.
  const bare = s ? lookup("tech", s) : undefined;
  if (bare) return bare;
  // Then the provider's brand mark, which is the useful fallback for a whole provider.
  return lookup("tech", p) ?? (vendor ? lookup(vendor, p) : undefined);
};
