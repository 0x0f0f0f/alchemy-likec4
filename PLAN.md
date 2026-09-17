# alchemy-likec4 — build the model, don't print it

## The two defects this fixes

**1. The package hand-writes what it claims to generate.** Three constants are typed by hand
in a package whose premise is "walk alchemy, derive everything":

| Constant | Where | Reality |
|---|---|---|
| `RELATIONSHIPS` | `src/emit.ts:58` | 12 binding kinds by hand. **Alchemy has 34.** Not just hand-written — wrong and incomplete |
| `BY_CATEGORY` | `src/emit.ts:28` | 15 category→style pairs. Alchemy has no opinion on colour; this is our taste hardcoded as data |
| `NOT_A_PROVIDER` | `src/extract.ts:91` | A 20-name regex of "subpaths that aren't providers", maintained by hand |

**2. It emits strings.** `emit.ts` builds `.c4` by pushing lines into an array. LikeC4 ships a
typed Builder and its own DSL printer, so string templating is both fragile and unnecessary.

## Proved before writing this

```
Builder.forSpecification({...}).build()  →  generate()  →  real .c4 text
```
Ran it. Emits correct `specification` / `model` / `deployment` blocks, and assigns tag colours
itself. `@likec4/generators@1.59.3` added (the printer export is `generate`, not `generateLikeC4`).

Also proved: a `deploymentNode` kind can carry a **tag**, which is what kills `BY_CATEGORY` —
the category is derived from alchemy's `@category`, emitted as a tag, and *styling becomes the
consumer's business*, where it belongs.

## Checklist

### Phase 1 — delete the hardcoded constants (3–4h)

- [ ] **Derive binding kinds.** Scan `Cloudflare/**/*Binding*.ts` + `WorkerAsyncBindings.ts` for
      `type: "<literal>"` declarations. Same source-scraping technique `categories.ts` already
      proves at 241/241. Expect ~34, up from 12.
- [ ] Delete `RELATIONSHIPS` from `src/emit.ts`.
- [ ] **Category → tag.** Emit each `@category` as a LikeC4 tag; tag every `deploymentNode` kind
      with its own. Derived end to end.
- [ ] Delete `BY_CATEGORY` and `iconFor` from `src/emit.ts`.
- [ ] **Derive the provider list.** A provider namespace is a subpath whose module yields
      resources. Import each, keep the ones that do. Delete the `NOT_A_PROVIDER` regex.
- [ ] Snapshot-test the derived counts so an alchemy bump that changes them is visible in review.

### Phase 2 — replace the string emitter with the Builder (2–3h)

- [ ] Rewrite `src/emit.ts` as `src/build.ts`: `Builder.forSpecification(...)` → `.build()`.
- [ ] Render with `generate()` from `@likec4/generators/likec4`.
- [ ] Keep `toIdentifier` — it is a derivation, not a constant.
- [ ] Never emit `group`, `global style`, `global predicate` or `rank`: those four printer
      operators **hard-throw `not implemented`** upstream.
- [ ] Verify byte-for-byte that the generated specs still validate.

### Phase 3 — generate the deployment model (4–6h)

- [ ] Finish wiring `Alchemist.open()`. It needs FileSystem → Scope → `alchemy/Context`;
      I got four of five layers deep. Zero network, works before any deploy.
- [ ] `namespace` chain → nested `deploymentNode`; `resourceType` → kind. That is the join key
      to the generated spec, and it is the same string on both sides.
- [ ] `bindings[]` → typed relations. **Not `downstream`** — it is nearly always empty.
- [ ] Second pass, name-join: `scriptName` / `service` → worker `props.name`. Recovers the
      Durable Object edges alchemy's own graph omits (they carry no FQN).
- [ ] **Drop secret values.** State holds live secrets in plaintext. Filter `secret_text` /
      `plain_text` — they are also ~half of every binding list and pure diagram noise.
- [ ] Emit to `<stack>.gen.c4` via a **partial** payload. Never `writeDSL()` — it is whole-model
      overwrite and would clobber hand-written `.c4`.
- [ ] Provenance as a file header comment, not per-element tags.

### Phase 4 — library + CLI (2–3h)

- [ ] Export the functions first: `extractResources`, `extractDeployment`, `buildSpecification`,
      `buildDeployment`.
- [ ] CLI on `effect/unstable/cli` (`Command` + `Flag`) — alchemy's own shape, zero new deps.
      Thin shell over the library, no logic of its own.

### Phase 5 — assertions (2–3h)

- [ ] `convergence` / `divergence` / `absence` over `LikeC4Model`. `instanceOf` **is** the
      mapping, so this is the Reflexion Model (FSE'95) and the three relations fall out free.
- [ ] Frozen baseline: fail only on *new* violations, so an existing model can adopt it on day one.
- [ ] Vitest matchers as a thin wrapper.

### Phase 6 — tooling (30m)

- [ ] biome + knip, matching the root config.
- [ ] `bun run check` green.

## Not doing

- **Generating the logical model.** Every prior-art failure came from trying. We generate the
  deployment half only — the one level C4's author endorses for generation.
- **Effect Layer tracing.** Effect 4 collapsed `Layer` to an opaque closure; nothing structural
  survives composition. Alchemy also keys providers by type *string*, so a tracing Layer learns
  "someone wanted a Worker", never "A depends on B". Dead end, confirmed.
- **Drift detection as a write.** Read-only. `alchemy drift` already exists.

## Risk

Alchemy is `2.0.0-beta.77` with no schema guarantee. Every derived count gets a snapshot test so
a bump that changes the shape fails loudly instead of silently emitting less.
