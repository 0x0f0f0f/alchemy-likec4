# alchemy-likec4

[LikeC4](https://likec4.dev) from [alchemy](https://alchemy.run). Two halves, nothing typed by hand:

- **The specification** — every resource kind alchemy can provision, reflected from the package.
  1,057 kinds across 13 providers from `alchemy@2.0.0-beta.77`.
- **The deployment model** — a stack's actual resources and bindings, compiled from its
  entrypoint without deploying it. No credentials, no network, no state.

Both are built with LikeC4's own Builder and printed with its own generator.

```bash
bun add -d alchemy-likec4
alchemy-likec4 spec                                        # → specs/<provider>.spec.c4
alchemy-likec4 deployment --stage prod                     # → <Stack>.prod.gen.c4, beside alchemy.run.ts
```

Or from a script:

```ts
import { openStack, buildDeployment } from "alchemy-likec4";
await Bun.write("infra.gen.c4", buildDeployment(await openStack({ stage: "prod" })));
```

## The specification

Every alchemy resource carries the canonical id it registers itself under —
`R2.Bucket.Type === "Cloudflare.R2.Bucket"` — and nothing else in the namespace does. That is
both the predicate and the identity. Each becomes a `deploymentNode` kind, flattened to a legal
identifier with the provider kept: `cloudflare_r2_bucket`.

Three more things are derived, not curated:

| | from | as |
|---|---|---|
| **Tags** | alchemy's `@category` JSDoc (15 groups for Cloudflare) | `#storage_databases` on each kind |
| **Relationship kinds** | the Workers API binding schema in `@distilled.cloud/cloudflare` (40 kinds) | `d1_binding`, `kv_namespace_binding`, … |
| **Providers** | whichever `alchemy/*` subpaths yield resources | one file each |

There are no styles. Styling by tag is the consumer's, in their own `.c4`.

## The deployment model

`alchemy.run.ts` is imported and its body run under placeholder services, so every
`yield* Cloudflare.Worker(...)` is a registry insert. Resources keep symbolic props;
dependencies are recovered by walking them: a prop holding another resource is an edge, and a
Worker's `env` bindings give each edge its kind.

```likec4
deployment {
  shortener_prod = alchemy_stack 'Shortener (prod)' {
    api = cloudflare_worker {
      metadata { fqn 'api'  type 'Cloudflare.Worker'  name 'shortener-api' }
    }
    links = cloudflare_d1_database { … }
  }
  shortener_prod.api -[d1_binding]-> shortener_prod.links 'LINKS'
}
```

Two consequences of deriving edges from references rather than from a list:

- A value binding (`plain_text`, `secret_text`, `json`) references nothing, so it yields no edge
  and its value is never read.
- A Durable Object binding is a plain value naming its host `scriptName`, not a resource, so
  alchemy's own dependency graph omits it. A name-join against each Worker's `name` closes that
  gap — the one edge in the example that alchemy itself does not record.

Building a provider layer resolves credentials even though compiling never calls an API.
Placeholders are set when the Cloudflare variables are absent; real ones are left alone.

## Putting them together

Kinds live in the generated spec, nodes in the generated deployment file, and the one thing that
has to be authored — which logical element a resource realises — in your own file, via `extend`:

```json
// likec4.config.json
{ "name": "my-app", "include": { "paths": ["node_modules/alchemy-likec4/specs"] } }
```

```likec4
model {
  api   = service 'API'
  links = store   'Links'
  api -[d1_binding]-> links 'reads'
}

deployment {
  extend shortener_prod.api   { instanceOf api }
  extend shortener_prod.links { instanceOf links }
}
```

A deployment view then shows both: the edges alchemy wires, between the resources, and the edges
you intended, inherited between the instances inside them. A binding in one but not the other is
visible at a glance.

## Example

`example/` is a link shortener — `alchemy.run.ts` is the stack, `shortener.c4` the logical model,
mapping and six views; `Shortener.<stage>.gen.c4` are generated.

```bash
bun run example:generate     # regenerate both stages
bun run example              # dev server on :5199
bun run example:validate
```

## Known limits

- Physical identifiers (bucket ids, worker URLs) exist only after a deploy; the compiled stack
  carries names, not ids.
- Only Cloudflare carries `@category` and binding kinds, so other providers emit untagged kinds
  and no relationship kinds.
- `DurableObject`, `Email.SendEmail` and `Website.Astro` are factory functions with no `.Type`, so
  they are not kinds. An Astro site *is* a `cloudflare_worker` once deployed.
- Alchemy is a beta with no schema guarantee. Every derived list is snapshot-tested so a bump that
  changes shape fails in review instead of silently emitting less.
