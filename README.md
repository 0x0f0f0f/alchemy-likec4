# alchemy-likec4

> [!WARNING]
> **Alchemy is in beta and under active development.** Resource declarations, binding shapes and
> the `alchemy.run.ts` entrypoint contract can change between betas, and so can what this package
> emits. Every release of `alchemy-likec4` targets **one alchemy 2 beta only** and the version says
> which: `0.77.x` is built against `alchemy@2.0.0-beta.77`. Match them, regenerate after every
> alchemy bump, and commit the diff.

## Automatically generate [LikeC4](https://likec4.dev) specs and diagrams from [alchemy](https://alchemy.run) stacks!

**Why?** You have written your infrastructure with
[Alchemy](https://alchemy.run)
([Github](https://github.com/alchemy-run/alchemy)), and you need a good way to
document your software architecture. This package lets you auto-generate [LikeC4](https://github.com/likec4/likec4) diagrams, specifications and deployment models from your alchemy stack.

**What is alchemy?** [Alchemy](https://alchemy.run) is infrastructure as code
written in pure [Effect](https://effect.website). Your cloud is one TypeScript
program: the resources, the code that runs on them, and the wires between them,
all in a single `yield*` chain.

**What is LikeC4?** LikeC4 is a modeling language for describing software
architecture and tools to generate diagrams from the model.

From this stack (`examples/basic/alchemy.run.ts`):

```ts
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "MyApp",
  { providers: Cloudflare.providers(), state: Alchemy.inMemoryState() },
  Effect.gen(function* () {
    const Photos = yield* Cloudflare.R2.Bucket("Photos");
    const Sessions = yield* Cloudflare.KV.Namespace("Sessions");
    const api = yield* Cloudflare.Worker("Api", {
      main: "./src/worker.ts",
      env: { Photos, Sessions },
    });
    return { url: api.url };
  }),
);
```

run this from the repo root, with a LikeC4 project at `examples/basic/docs/architecture`:

```bash
alchemy-likec4 spec       --project examples/basic/docs/architecture --provider Cloudflare
alchemy-likec4 deployment --project examples/basic/docs/architecture --entrypoint examples/basic/alchemy.run.ts --stage prod
likec4 export png examples/basic/docs/architecture --notation
```

add one hand-written view (`examples/basic/docs/architecture/views.c4`):

```likec4
views {
  deployment view index {
    title 'MyApp — production'
    include my_app_prod, my_app_prod.**
    style my_app_prod.photos, my_app_prod.sessions { shape storage; color indigo }
    style my_app_prod.api { color amber }
    autoLayout LeftRight
  }
}
```

and you get this, without deploying anything:

![MyApp — production](screenshot.png)

## Supports

- **Clouds**: Cloudflare, AWS, Fly, Hetzner, Railway.
- **Data**: D1, R2, KV, Durable Objects, Queues, Hyperdrive, plus PlanetScale, Neon, Prisma, Drizzle, plain SQL.
- **Frontends**: Vite, Astro, Next.js, Nuxt, SvelteKit, TanStack Start, React Router v7, SolidStart, Waku, static sites.
- **Ops**: GitHub, Git, Docker, Kubernetes, Axiom, BetterAuth, a raw Command resource for everything else.
- **CLI**: deploy, plan, destroy, drift, dev with hot reload, logs, state, nuke.

## Add a LikeC4 project to your alchemy repo

LikeC4 treats any directory holding a `likec4.config.json` as a project, and every `.c4` under
it, recursively, as part of it. `alchemy-likec4` writes only into such a directory, under
`alchemy/`. Put it anywhere; `docs/architecture` is a good default:

```
docs/architecture/
├─ likec4.config.json     # name, optional styles — this file makes it a project
├─ specification.c4       # your element kinds, tags, relationship kinds
├─ model.c4               # the logical model: systems, services, stores
├─ deployment.c4          # extend <node> { instanceOf <element> } — the mapping
├─ views.c4               # views, including deployment views
└─ alchemy/               # GENERATED — every alchemy-likec4 run rewrites it
   ├─ cloudflare.spec.c4  # one deploymentNode kind per resource alchemy can provision
   ├─ bindings.spec.c4    # one relationship kind per Worker binding kind
   ├─ alchemy.spec.c4     # the alchemy_stack container kind
   └─ MyApp.prod.gen.c4   # your stack: nodes and edges, one file per stage
```

The minimum is the config file:

```bash
mkdir -p docs/architecture && echo '{ "name": "my-app" }' > docs/architecture/likec4.config.json
```

On LikeC4's side:

- [Project configuration](https://likec4.dev/dsl/config/) — `likec4.config.json`, styles, `exclude`
- [Multiple projects](https://likec4.dev/dsl/config/multi-projects) — one per package in a monorepo, `import` between them
- [CLI](https://likec4.dev/tooling/cli) — `likec4 start`, `build`, `export png`, `validate`
- [Editors](https://likec4.dev/tooling/editors/) — the VS Code extension
- [Validate your model](https://likec4.dev/guides/validate-your-model) — Vitest rules against the model
- [likec4/template](https://github.com/likec4/template) — a starter repo

## Generate

```bash
bun add -d alchemy-likec4
alchemy-likec4 spec       --project docs/architecture               # kinds, for every provider alchemy ships
alchemy-likec4 deployment --project docs/architecture --stage prod  # your stack, from ./alchemy.run.ts
```

`--project` is required, and anything that is not a LikeC4 project is refused:

```
docs/architecture is not a LikeC4 project: no likec4.config.* found in it.
Create one:  mkdir -p docs/architecture && echo '{ "name": "my-app" }' > docs/architecture/likec4.config.json
Docs: https://likec4.dev/dsl/config/
```

`spec --provider Cloudflare` limits the kinds to one provider. `deployment --entrypoint
path/to/alchemy.run.ts --stage staging` reads another stack or stage; one file per stage.
Commit `alchemy/`: the diff on an alchemy bump is the review.

From a script:

```ts
import { openStack, buildDeployment } from "alchemy-likec4";
await Bun.write(
  "docs/architecture/alchemy/MyApp.prod.gen.c4",
  buildDeployment(await openStack({ stage: "prod" })),
);
```

## Map resources onto your model

The generated file declares the nodes and the edges alchemy wires. The one thing alchemy cannot
know is which logical element a resource realises. That is one `extend` per resource, in your
own file:

```likec4
deployment {
  extend shortener_prod.api   { instanceOf shortener.api }
  extend shortener_prod.links { instanceOf shortener.links }
}

views {
  deployment view prod {
    include shortener_prod.**
    autoLayout LeftRight
  }
}
```

A deployment view then shows both what you intended (`api -[d1_binding]-> links` in your model)
and what alchemy wired (the generated edge between the instances). A binding in one but not the
other is visible at a glance.

## Examples

- [`examples/basic`](examples/basic) — one Worker, one bucket, one KV namespace, one view. The screenshot above.
- [`examples/link-shortener`](examples/link-shortener) — two stages, a logical model, the mapping,
  model views, deployment views and a dynamic view, in the layout above.

`bun run example` in this repo opens both in LikeC4's UI.

## How it works

### Specification

Every alchemy resource carries a canonical id (`R2.Bucket.Type === "Cloudflare.R2.Bucket"`), so
each becomes a `deploymentNode` kind, flattened to a legal identifier with the provider kept:
`cloudflare_r2_bucket`. Alchemy's `@category` becomes a tag (`#storage_databases`), and the
Workers API binding schema gives one relationship kind per binding (`d1_binding`,
`kv_namespace_binding`, …). All of it is built with LikeC4's own `Builder` and printed with its
own generator.

### The deployment model

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

## Known limits

- Physical identifiers (bucket ids, worker URLs) exist only after a deploy; the compiled stack
  carries names, not ids.
- Only Cloudflare carries `@category` and binding kinds, so other providers emit untagged kinds
  and no relationship kinds.
- `DurableObject`, `Email.SendEmail` and `Website.Astro` are factory functions with no `.Type`, so
  they are not kinds. An Astro site _is_ a `cloudflare_worker` once deployed.
- Deployment views cannot style by tag or kind (likec4 1.59.3). Style by node reference, as in
  the view above. Model views can style by tag.
- Alchemy is a beta with no schema guarantee. Every derived list is snapshot-tested so a bump that
  changes shape fails in review instead of silently emitting less.
