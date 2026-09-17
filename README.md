# alchemy-likec4

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

run this:

```bash
alchemy-likec4 deployment --entrypoint examples/basic/alchemy.run.ts --stage prod   # → MyApp.prod.gen.c4
likec4 export png examples/basic --notation                                        # → index.png
```

with one hand-written view (`examples/basic/basic.c4`):

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

- **Clouds**: Cloudflare, AWS, Fly, Hetzner, Railway. AWS.
- **Data**: D1, R2, KV, Durable Objects, Queues, Hyperdrive, plus PlanetScale, Neon, Prisma, Drizzle, plain SQL.
- **Frontends**: Vite, Astro, Next.js, Nuxt, SvelteKit, TanStack Start, React Router v7, SolidStart, Waku, static sites.
- **Ops**: GitHub, Git, Docker, Kubernetes, Axiom, BetterAuth, a raw Command resource for everything else.
- **CLI**: deploy, plan, destroy, drift, dev with hot reload, logs, state, nuke.

## How to.

Take your existing alchemy project and

Install the package as a dev dependency (we recommend using `bun` for Alchemy.)

```bash
bun add -d alchemy-likec4
```

Generate the [LikeC4 specification](https://likec4.dev/dsl/specification/) for the providers that you use into `specs/<provider>.spec.c4`:

```bash
alchemy-likec4 spec
```

<!-- TODO beside alchemy.run.ts ? bro what -->

Generate the deployment model `<Stack>.prod.gen.c4, beside alchemy.run.ts`

```bash
alchemy-likec4 deployment --stage prod
```

### How to (from a script)

```ts
import { openStack, buildDeployment } from "alchemy-likec4";
await Bun.write(
  "infra.gen.c4",
  buildDeployment(await openStack({ stage: "prod" })),
);
```

---

## Examples

<!-- TODO link -->

See [the `examples/` directory]()

---

## How it works.

### Specification

`alchemy-likec4` generates a specification and a deployment model with LikeC4's own `Builder` AST emitter.

Every alchemy resource carries the canonical id, so each becomes a
`deploymentNode` in the `.c4` specification files.

Alchemy resource names are flattened to snake case: `Cloudflare.R2.Bucket`
`cloudflare_r2_bucket`.

Specifications for all provider resources are auto-derived from alchemy,
Resource Categories become tags in LikeC4 (e.g. `#storage_databases`), and
LikeC4 Relationship kinds (arrows/edges in the diagram, e.g. binding a D1 to a
worker is `d1_binding`) are also derived for Cloudflare bindings.

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
- Alchemy is a beta with no schema guarantee. Every derived list is snapshot-tested so a bump that
  changes shape fails in review instead of silently emitting less.
