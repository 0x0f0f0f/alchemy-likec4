// The shortener from shortener.c4, as an alchemy stack. `bun run generate deployment` reads this
// and emits shortener.gen.c4 — the deployment half of the model, derived rather than typed.
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

const main = `${import.meta.dirname}/workers/noop.ts`;

export default Alchemy.Stack(
  "Shortener",
  // A state store is mandatory; in-memory keeps the fixture off the disk.
  { providers: Cloudflare.providers(), state: Alchemy.inMemoryState() },
  Effect.gen(function* () {
    /** Read-through cache. A miss costs one D1 read. */
    const hot = yield* Cloudflare.KV.Namespace("hot", { title: "hot-links" });
    /** Canonical slug to URL mapping. */
    const links = yield* Cloudflare.D1.Database("links");
    const clicks = yield* Cloudflare.Queues.Queue("clicks");
    const reports = yield* Cloudflare.R2.Bucket("reports");

    /** Creates links and serves the author dashboard. */
    const api = yield* Cloudflare.Worker("api", {
      main,
      name: "shortener-api",
      env: { LINKS: links, HOT: hot, REGION: "eu" },
    });

    /** The only thing on the request path a visitor waits for. */
    const redirect = yield* Cloudflare.Worker("redirect", {
      main,
      name: "shortener-redirect",
      env: { HOT: hot, LINKS: links, CLICKS: clicks },
    });

    // A Durable Object binding names its host script rather than referencing the Worker, which
    // is exactly the edge alchemy's own dependency graph does not record.
    const analytics = yield* Cloudflare.Worker("analytics", {
      main,
      name: "shortener-analytics",
      env: {
        LINKS: links,
        REPORTS: reports,
        COUNTER: Cloudflare.DurableObject("counter", { className: "Counter", scriptName: "shortener-api" }),
      },
    });

    return { api, redirect, analytics };
  }) as unknown as Effect.Effect<unknown, never, never>,
);
