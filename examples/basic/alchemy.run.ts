import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

/**
 * Photos in, sessions out: the whole product, on four Cloudflare resources.
 *
 * @icon tech:cloudflare-workers-icon
 * @color blue
 */
export default Alchemy.Stack(
  "MyApp",
  { providers: Cloudflare.providers(), state: Alchemy.inMemoryState() },
  Effect.gen(function* () {
    /** Original uploads, never served directly. */
    const Photos = yield* Cloudflare.R2.Bucket("Photos");

    /** Signed-in sessions, read on every request. */
    const Sessions = yield* Cloudflare.KV.Namespace("Sessions");

    /** The only public entrypoint. Reads photos, writes sessions. */
    const api = yield* Cloudflare.Worker("Api", {
      main: "./src/worker.ts",
      env: { Photos, Sessions },
    });

    /** The marketing site and dashboard, server-rendered at the edge. */
    const site = yield* Cloudflare.Website.Astro("Site", {
      env: { API: api },
    });

    return { url: site.url };
  }),
);
