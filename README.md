# alchemy-likec4

Generates a [LikeC4](https://likec4.dev) `specification` from [alchemy](https://alchemy.run)'s
resource registry, so the architecture vocabulary cannot drift from the IaC that provisions it.

```bash
bun install
bun run generate                       # → specs/*.c4, one per provider
bun run generate --provider Cloudflare # just one
bun run validate                       # generate, then likec4 validate
bun test
```

1,057 resources across 13 providers from `alchemy@2.0.0-beta.77` — AWS 715, Cloudflare 241,
Railway 22, Hetzner 16, Fly 13, Prisma 12, and the rest.

## How it finds resources

Runtime reflection, not source scanning. Every alchemy resource carries the canonical id it
registers itself under:

```ts
R2.Bucket.Type === "Cloudflare.R2.Bucket"
```

Nothing else in the namespace does — a `Provider`, an `Error` or a `Binding` has no own
properties at all — so `.Type` is both the predicate and the identity:

```ts
const isResource = (v) => typeof v === "function" && typeof v?.Type === "string";
```

**Why not scan the source.** Resources are declared three different ways
(`Resource<T>("id")`, `export const XTypeId = "id"`, and a bare string literal) and no single
pattern is complete: scanning `src` finds 233, scanning `.d.ts` finds 39, and each misses
resources the other catches. The module object has no such problem.

**The cost.** Importing `alchemy/Cloudflare` pulls the whole effect peer graph, which has to be
version-pinned — see `overrides` in `package.json`. A future alchemy or effect bump may need
re-pinning before the generator runs.

## Naming

LikeC4 identifiers cannot contain dots (dots are FQN separators), so the canonical id is not a
legal identifier. Types are flattened to snake_case with the provider kept:

| alchemy | LikeC4 |
|---|---|
| `Cloudflare.R2.Bucket` | `cloudflare_r2_bucket` |
| `Cloudflare.D1Database` | `cloudflare_d1_database` |
| `Cloudflare.Access.Application` | `cloudflare_access_application` |

The provider prefix stays because a bare `bucket` collides the day a second provider is
generated — and AWS has one.

## What it emits

- **One `deploymentNode` kind per resource**, grouped by alchemy's own `@category` where it has
  one, each carrying its canonical id as `notation` and a shape/colour/icon derived from that
  category.
- **12 `relationship` kinds** for bindings — `service_binding`, `durable_object_binding`,
  `r2_binding`, … These are hand-listed on purpose: alchemy models a binding as a property of a
  Worker's `env`, not as a resource, so there is nothing to reflect over.
- **A provenance header** with the alchemy version and resource count, so a stale file is
  obvious in review.

Unused kinds are harmless — LikeC4 validates a specification containing kinds nothing
instantiates, which is what makes one shared file usable across every repo.

## Using it

```likec4
// your-repo/model.c4
deployment {
  cf_account acct {
    cf_stage prod {
      cloudflare_worker      catalog_api { instanceOf platform.catalog }
      cloudflare_r2_bucket   public_bucket
      cloudflare_d1_database platform_db
    }
  }
}
```

## Styling

Styles come from alchemy's `@category` JSDoc — 15 curated groups for Cloudflare. A resource is
matched to its declaring file by searching for its canonical `.Type` string, not by guessing a
path from the export name: guessing resolves 205/241, finding the declaration resolves 241/241.
Export and file names diverge often enough to matter (`Alerting.NotificationWebhook` declares
`Cloudflare.Alerting.Webhook`).

This is the only place the package reads source instead of reflecting, and it is limited to
decoration. A category that fails to resolve costs a default style; it can never cost a missing
resource. Only Cloudflare uses `@category` today — other providers emit unstyled kinds.

## Ownership across namespaces

Namespaces re-export each other: `alchemy/AWS` exposes the four Kubernetes resources for EKS.
So the namespace a resource is *found* in is not its owner — the canonical type is. Resources
are collected across every namespace, deduplicated globally by `.Type`, then grouped into files
by the provider their type names. Without this, `kubernetes_deployment` is declared twice and
the model does not validate.

## Known gaps

- `DurableObject`, `Email.SendEmail` and `Website.Astro` are plain factory functions with no
  `.Type`, so they are not deployment nodes. Bindings become relationship kinds; an Astro site
  **is** a `cloudflare_worker` once deployed, which is the honest modelling anyway.
- Only Cloudflare carries `@category`, so only Cloudflare gets styled.
