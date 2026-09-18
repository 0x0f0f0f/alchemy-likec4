# alchemy-likec4 — agent notes

Two upstreams, both ship a full-text dump. **Read them rather than recalling them** — both move fast
and both have surfaces that do not match their prose.

| When the task touches | Fetch first |
|---|---|
| LikeC4 DSL, views, deployment model, CLI, MCP | https://likec4.dev/llms-full.txt |
| alchemy resources, Stack, state, providers | https://alchemy.run/llms-full.txt |

The LikeC4 DSL also ships an official Claude skill at `likec4/likec4` under `skills/likec4-dsl/`
(SKILL.md + 14 references). Useful, but its reference files contain claims the grammar rejects —
verified: `include **` and bare `_` standalone are documented and invalid; nested `parallel` is
documented as allowed and is a validation error. Check the grammar
(`packages/language-server/src/like-c4.langium`) before trusting a reference page.

## Releasing

- Version is `0.<alchemy beta>.<patch>`: built against `alchemy@2.0.0-beta.77` → publish `0.77.0`.
  First release is `0.77.0`. Bump the minor with every alchemy beta bump; patch for our own fixes.
- README.md is for users only. Contributor and release notes live here, not there.
- Bumping the alchemy beta means editing **four** exact pins together: `peerDependencies.alchemy`,
  `peerDependencies.effect`, `peerDependencies["@effect/platform-node"]` and
  `dependencies["@distilled.cloud/cloudflare"]` (match whatever the new alchemy beta pins), then
  the same versions in the README `overrides` block. Peer ranges are deliberately exact: effect 4
  rc builds break each other, and `>=` resolves a newer rc than the alchemy beta was built for.
- `bun run build` (tsdown → `dist/`, ESM + d.mts, deps external) then `bun run check:pack`
  (publint + are-the-types-wrong on the ESM-only profile). `prepublishOnly` runs both.
- Ship no Bun-only API in `src/`: the package must run on node. `node:fs` everywhere,
  `import.meta.resolve` not `Bun.resolveSync`, `import.meta.dirname` not `import.meta.dir`.
  CI runs the built CLI under node and diffs the output against the committed files.

## Local facts worth not rediscovering

- `likec4 validate --file <path>` with a path that does not match reports **`valid: true`** and
  `filteredFiles: 0`. A CI gate written that way passes vacuously. Omit `--file` in CI.
- Importing `alchemy/Cloudflare` needs the effect peer graph pinned — see `overrides` in
  package.json. Without it you get three different failures in a row.
- `@likec4/icons` ships aws 307, gcp 216, azure 614, tech 2000, bootstrap 2052 icons as
  `<pack>:<kebab-name>`. Cloudflare has only four (`cloudflare`, `cloudflare-icon`,
  `cloudflare-workers`, `cloudflare-workers-icon`), none per service, so Cloudflare resources are
  told apart by shape and colour. `src/icons.gen.ts` is generated from the directory listing by
  `bun run build:icons` — never hand-list icons.
- alchemy's Cloudflare JSDoc carries `@category` (15 values) and `@product` (104 values, the
  `technology` label). No other provider carries either. `@see` is deliberately unread: it is the
  first URL in the file and often names a sub-feature rather than the product.
- `@distilled.cloud/cloudflare/workers` resolves to `.ts` under bun and compiled `.js` under node,
  where the binding type aliases no longer exist. `bindingKinds()` reads the `.d.ts` beside it and
  throws on an empty list, because a silent empty list means a spec with no relationship kinds.
- `@likec4/config` reaches `isLikeC4Config` only through an entry needing `bundle-require` and
  `esbuild` peers, so the nine config filenames are inlined in `src/project.ts` instead.
- **Relationship inheritance is one-way**: LikeC4 inherits deployment relationships from the
  logical model, never the reverse. A relationship in `model` shows in logical views AND in
  deployment views (between the instances); one in `deployment` shows only in deployment views.
  Declaring both renders two parallel edges, because one joins instances and the other joins nodes.
  So every generated binding goes in the model and the deployment carries none.
- `extend` accepts tags, links, metadata, relationships and nested children. It REJECTS
  description, technology, title, style and icon. Element prose therefore comes from the generator
  (JSDoc above the resource in the user's stack), never from the consumer's own file.
- The printer takes a PARTIAL parsed model, which is what makes the spec/model split possible:
  `generate({ specification })` prints `specification { }` alone, `generate({ elements, relations })`
  prints `model { }` alone. Verified against 1.59.3.
- The Builder resolves a kind's style ONTO each element it builds, and the printer emits whatever an
  element carries. So `buildModel` is given the kinds stripped of style, tags and technology —
  otherwise every element inlines a redundant `style { }` and the spec is no longer the one place
  styling is declared.
- A kind declared twice in one project is a hard error (`Duplicate element kind`, also for
  `deploymentNode`, `RelationshipKind` and `tag`). That is why the specification is one file per
  PROJECT, union of every stack in the run, and why `--entrypoint` repeats.
- Two logical ids that differ only by case sanitise to one identifier. Both are alchemy state rows a
  consumer cannot rename, so `pathsOf` appends the sanitised canonical type to each of a colliding
  group — a pure function of `(logicalId, type)`, so the id is stable and both the model and the
  deployment derive the same one. Namespace containers share that id space (a Website's derived
  `Command.Build` sits under a namespace named after the site, whose Worker keeps the site's logical
  id), so `pathsOf` seeds the group counts from `namespacesOf`.
- `Output.upstreamAny` has no `RefExpr` arm, so a binding holding a `Resource.ref` walks to nothing.
  The ref is on the wire all the same: `Cloudflare.WorkerEntrypoint(ref)` lowers to
  `service: PropExpr(RefExpr)`, and `RefExpr` carries `stack`, `resourceId` and
  `stables.Type` — `(stack, logical id, canonical type)` with no deploy. `refsIn` in `stack.ts`
  mirrors `upstream`'s per-kind dispatch: an Expr is a proxy that answers ANY unknown property with
  a PropExpr wrapping itself, so reading `.expr` off an unclassified node never terminates. It also
  mirrors the `isResource` arm that runs BEFORE `isPlainData`: a resource object is a proxy over a
  plain object literal, so without it a resource reads as plain data and every resource binding a
  ref-holding one inherits its refs, transitively.
- The Builder resolves a relationship's ends against the elements it was given and throws
  `Element with id … not found` otherwise, so a cross-stack relation cannot go through it.
  `buildCrossStack` prints text, like `buildViews`.
- A binding's `data.bindings` is absent on a Container / Durable Object binding (`data` is
  `{ durableObjects: { namespaceId } }`), and a binding whose VALUE is an Output arrives as a proxy
  wrapping the whole wire — `wire.type` is then an Output, not a string, and interpolating it throws.
  Both are guarded in `deriveGraph`; neither has a fixture that is not hand-made.
- `include <root>.**` silently drops elements with no relationship; `include <root>.*` keeps them,
  but only direct children — a resource alchemy nested under a namespace needs `.**`. Generated
  views therefore pair them and never use `.**` alone: the stack's own view is scoped, so the
  wildcard covers the children (`include *, <root>.**`), and the deployment views, which have no
  wildcard, spell out all three (`include <root>, <root>.*, <root>.**`). Dropping the `.*` there
  silently loses a stack whose resources have no relationships between them.
- A resource's `domain` prop survives compiling as a plain string — it is a pure function of the
  stage in every stack that uses one — so the door a service answers on needs no deploy. `worker.url`
  does NOT: it is an Output and stays unresolved. The domain goes on the DEPLOYED INSTANCE, never on
  the logical element: `mcp.rel-int.ai` and `mcp-staging.rel-int.ai` are the same element on two
  stages, and `modelId` is deliberately stage-free. It may carry a path (`auth.rel-int.ai/admin`),
  so it is `domain`, alchemy's own name, not `host`. A deployment instance accepts `link`,
  `technology`, `icon`, `style` and `metadata` (verified, 1.59.3); the printer wants
  `links: [{ url, title }]`.
- `describe.ts` parses: `oxc-parser` for the TypeScript, `comment-parser` for the JSDoc. No regex
  reads source. A resource is a `YieldExpression` with `delegate: true`; its logical id is the
  INNERMOST call in the callee chain whose first argument is a string literal, because
  `yield* D1.Database("AuthDb", {}).pipe(…)` yields the `.pipe` call. The stack is the entrypoint's
  `ExportDefaultDeclaration` — it is never yielded, so it needs its own arm. JSDoc attaches as "the
  nearest block comment above, with only whitespace between".
- Three kinds of `@` line, and they differ. `@icon`/`@color` are ours. `@internal`/`@param` are real
  JSDoc tags — metadata, not description. `@rel-int.ai addresses only.` only looks like one: a tag
  NAME is an identifier (`/^[a-zA-Z][a-zA-Z0-9]*$/`), so that line goes back into the prose. Dropping
  every tag deletes the author's sentence; keeping every tag resurrects `@internal`.
- `comment-parser` splits a tag value at the first space into `name` + `description` — join both.
- A parser only accepts valid TypeScript. `yield*` needs a generator body, so a test fixture has to
  live inside `Effect.gen(function* () { … })`; the old regex happily matched files that were never
  valid TS. And `export const x = yield* …` cannot exist — `export` is module-level, `yield*` is not.
- Per-element `style { color, icon }` and `technology` all print fine from `buildModel`; only KIND
  styling is stripped there.
- `landscape.gen.c4` is the run-level counterpart to the scoped per-stack views: every stack opened
  in one view. It is NOT named `index` — LikeC4 generates that itself when a project defines none,
  so taking the name would silently replace the consumer's own.
- A view declared `of <element>` becomes that element's DEFAULT view, which is what puts the
  navigate ("zoom in") button on it everywhere it is drawn. Nothing else turns the button on;
  `implicitViews: true` in `likec4.config.json` is the blanket alternative and mints one view per
  element. `buildViews` scopes each stack's view for exactly this.
- A `/` in a view's title makes a folder in the UI sidebar, and `order <n>` sorts within it
  (properties must precede predicates). Generated titles are `<Stack> / Overview` and
  `<Stack> / <stage>`, so a stack's views sit together.
- `icon` must sit inside `style { }` in a specification kind body. Bare `icon` is model-elements only.
- A named instance (`api = instanceOf x.api`) is one node inheriting the element's shape, colour,
  icon and technology. `deployment.nodes()` does NOT return instances — walk `deployment.instances()`.
- Instance `metadata` REPLACES the element's rather than merging; tags combine.
- An `element` kind and a `deploymentNode` kind may share a name. The same kind declared twice in
  one project is a hard error, so generated kind names must not collide with the consumer's.
- The Builder's `$include` drops `.*` selectors and `$autoLayout`, so views are templated text.
- Theme colours: the docs list 8, the grammar accepts 11 (adds `sky`, `blue`, `slate`).
- Deployment views reject `style element.tag = …` / `element.kind = …` (likec4 1.59.3: "element kind
  and tag expressions are not supported in deployment view rules"). Style by node reference instead.
- Alchemy state (`.alchemy/state/<stack>/<stage>/<id>.json`) carries `resourceType`,
  `bindings[].data.bindings[]` as `{type,name}`, and `downstream`. That is the whole deployment
  graph, on disk, no credentials needed.

---

---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
