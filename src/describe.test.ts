import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { descriptionsFor } from "./describe.ts";

/** A stack file in a throwaway directory; `descriptionsFor` scans the entrypoint's whole tree. */
const stack = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "alchemy-likec4-describe-"));
  const entrypoint = join(dir, "alchemy.run.ts");
  writeFileSync(entrypoint, body);
  return entrypoint;
};

describe("descriptionsFor", () => {
  it("reads the JSDoc above a bound resource", () => {
    const map = descriptionsFor(
      stack(`/** The only public entrypoint. */\nconst api = yield* Cloudflare.Worker("Api", {});`),
    );
    expect(map.get("Api")).toBe("The only public entrypoint.");
  });

  it("reads it above a resource returned from a branch", () => {
    // `return yield* …` is how a conditionally declared resource reaches the stack.
    const map = descriptionsFor(
      stack(`/** Access in front of /admin only. */\n  return yield* Cloudflare.Access.Application("AuthAdmin", {});`),
    );
    expect(map.get("AuthAdmin")).toBe("Access in front of /admin only.");
  });

  it("joins a multi-line block and drops its tag lines", () => {
    const map = descriptionsFor(
      stack(
        `/**\n * Hub state — notebooks and sessions.\n * There is no database.\n * @internal\n */\nconst b = yield* Cloudflare.R2.Bucket("Hub", {});`,
      ),
    );
    expect(map.get("Hub")).toBe("Hub state — notebooks and sessions. There is no database.");
  });

  it("ignores a call that is not yielded, so a plain function call cannot claim an id", () => {
    const map = descriptionsFor(stack(`/** Not a resource. */\nconst x = helper("Api");`));
    expect(map.has("Api")).toBe(false);
  });
});
