# alchemy-likec4

Generates a [LikeC4](https://likec4.dev) `specification` from [alchemy](https://alchemy.run)'s
resource registry, so the architecture vocabulary cannot drift from the IaC that provisions it.

```bash
bun install
bun run generate        # → cloudflare.spec.c4   (241 kinds from alchemy@2.0.0-beta.77)
bun run validate        # generate, then likec4 validate
bun test
```

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

- **241 `deploymentNode` kinds**, grouped by namespace, each carrying its canonical id as
  `notation` and a shape/colour/icon derived from its namespace.
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

## Known gaps

- `Cloudflare.DurableObject` and `Cloudflare.Email.SendEmail` are **bindings**, not resources,
  so they are relationship kinds rather than deployment nodes.
- `Website.Astro` lives in `@alchemy.run/frontend-frameworks`, a separate package that is not
  scanned yet.
- Only Cloudflare so far. The same reflection works for any alchemy provider — AWS exposes
  ~375 resources by the same `.Type` convention.
