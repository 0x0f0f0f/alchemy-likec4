import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";

/** A stack that declares one resource only when it deploys, the way an emulator-less resource is. */
export default Alchemy.Stack(
  "LiveOnly",
  { providers: Cloudflare.providers(), state: Alchemy.inMemoryState() },
  Effect.gen(function* () {
    yield* Cloudflare.R2.Bucket("Always");
    if ((yield* Alchemy.ProviderMode.defaultProviderMode) === "live") yield* Cloudflare.KV.Namespace("Deployed");
  }),
);
