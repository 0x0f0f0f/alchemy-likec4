/**
 * Worker binding kinds, derived from Cloudflare's own API schema.
 *
 * A binding is a property of a Worker's `env`, not a provisioned resource, so there is nothing
 * to reflect over at runtime. The wire vocabulary lives in `@distilled.cloud/cloudflare` —
 * the Cloudflare OpenAPI schema, distilled — as one literal alias per binding kind:
 *
 *   export type …BindingsItemKVNamespaceType = "kv_namespace";
 *
 * Reading those is the same source-scraping `categories.ts` uses, and the list is Cloudflare's,
 * not ours: a kind added upstream appears here without a code change.
 */
import { readFileSync } from "node:fs";

// `=\s*` because long aliases wrap the literal onto the next line.
const ALIAS = /^export type \w*Binding\w*Type =\s*"([a-z0-9_]+)";/gm;

/** Every binding kind the Workers API accepts, sorted. E.g. `d1`, `kv_namespace`, `service`. */
export const bindingKinds = (): string[] => {
  const file = Bun.resolveSync("@distilled.cloud/cloudflare/workers", import.meta.dir);
  const text = readFileSync(file, "utf8");
  return [...new Set([...text.matchAll(ALIAS)].map((m) => m[1] as string))].sort();
};

/** `kv_namespace` → `kv_namespace_binding`: the LikeC4 relationship kind for a binding. */
export const toRelationshipKind = (binding: string): string => `${binding}_binding`;
