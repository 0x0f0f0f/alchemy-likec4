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
