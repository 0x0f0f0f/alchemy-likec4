import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProse } from "./describe.ts";

/**
 * A stack file in a throwaway directory; `readProse` scans the entrypoint's whole tree.
 *
 * The body goes inside `Effect.gen`, because that is where a resource is actually declared and
 * because a parser will not accept `yield*` anywhere else. The regex this replaced matched text in
 * files that were never valid TypeScript.
 */
const stack = (body: string, { raw = false } = {}): string => {
  const dir = mkdtempSync(join(tmpdir(), "alchemy-likec4-describe-"));
  const entrypoint = join(dir, "alchemy.run.ts");
  writeFileSync(
    entrypoint,
    raw ? body : `export default Alchemy.Stack("S", {}, Effect.gen(function* () {\n${body}\n}));`,
  );
  return entrypoint;
};

describe("readProse", () => {
  it("reads the JSDoc above a bound resource", () => {
    const { descriptions } = readProse(
      stack(`/** The only public entrypoint. */\nconst api = yield* Cloudflare.Worker("Api", {});`),
    );
    expect(descriptions.get("Api")).toBe("The only public entrypoint.");
  });

  it("reads it above a resource returned from a branch", () => {
    const { descriptions } = readProse(
      stack(`/** Access in front of /admin only. */\nreturn yield* Cloudflare.Access.Application("AuthAdmin", {});`),
    );
    expect(descriptions.get("AuthAdmin")).toBe("Access in front of /admin only.");
  });

  it("joins a multi-line block and drops a real JSDoc tag", () => {
    const { descriptions } = readProse(
      stack(
        `/**\n * Hub state — notebooks and sessions.\n * There is no database.\n * @internal\n */\nconst b = yield* Cloudflare.R2.Bucket("Hub", {});`,
      ),
    );
    expect(descriptions.get("Hub")).toBe("Hub state — notebooks and sessions. There is no database.");
  });

  it("keeps a line that only looks like a tag, because an address is not metadata", () => {
    // JSDoc parses `@rel-int.ai addresses only.` as a tag; a tag NAME is an identifier, so it is
    // prose. The line split this replaced dropped the sentence without a word.
    const { descriptions } = readProse(
      stack(
        `/**\n * The console admits\n * @rel-int.ai addresses only.\n */\nconst p = yield* Cloudflare.Access.Policy("AllowRelInt", {});`,
      ),
    );
    expect(descriptions.get("AllowRelInt")).toBe("The console admits @rel-int.ai addresses only.");
  });

  it("ignores a call that is not yielded, so a plain function call cannot claim an id", () => {
    const { descriptions } = readProse(stack(`/** Not a resource. */\nconst x = helper("Api");`));
    expect(descriptions.has("Api")).toBe(false);
  });

  it("finds the id through a `.pipe` chain, where the yielded call has no string argument", () => {
    const { descriptions } = readProse(
      stack(
        `/** Every account this issuer owns. */\nconst db = yield* Cloudflare.D1.Database("AuthDb", {}).pipe(Alchemy.RemovalPolicy.retain(true));`,
      ),
    );
    expect(descriptions.get("AuthDb")).toBe("Every account this issuer owns.");
  });

  it("reads a resource the binding list never reached, here behind a ternary", () => {
    // `const x = <cond> ? yield* … : undefined` — the old pattern required `yield*` to follow the
    // `=` directly, so every conditional resource in a stack went undescribed.
    const { descriptions } = readProse(
      stack(
        `/** Only on the stages that have one. */\nconst hub = stage === "prod" ? yield* Cloudflare.Worker("Hub", {}) : undefined;`,
      ),
    );
    expect(descriptions.get("Hub")).toBe("Only on the stages that have one.");
  });

  it("does not let a block above the stack bleed into the resource below it", () => {
    // The 0.77.4 fusion: a lazy body backtracked past the comment terminator when what followed
    // was `export default`, and swallowed the file down to the next block.
    const { descriptions, stack: own } = readProse(
      stack(
        `/**\n * The whole product.\n * @color blue\n */\nexport default Alchemy.Stack("S", {}, Effect.gen(function* () {\n/** Original uploads. */\nconst p = yield* Cloudflare.R2.Bucket("Photos", {});\n}));`,
        { raw: true },
      ),
    );
    expect(descriptions.get("Photos")).toBe("Original uploads.");
    expect(own.description).toBe("The whole product.");
    expect(own.color).toBe("blue");
  });

  it("is not fooled by a comment terminator inside a fenced block", () => {
    const { descriptions } = readProse(
      stack(
        `/**\n * Prose.\n * \`\`\`\n * const a = 1;\n * \`\`\`\n */\nconst q = yield* Cloudflare.Queues.Queue("Clicks", {});`,
      ),
    );
    expect(descriptions.get("Clicks")).toInclude("Prose.");
  });

  it("is not fooled by a string literal containing a yield", () => {
    const { descriptions } = readProse(stack(`/** Prose. */\nconst s = "yield* Cloudflare.Worker(\\"Ghost\\")";`));
    expect(descriptions.has("Ghost")).toBe(false);
  });

  it("takes the stack's own tags, and the value is everything after the tag", () => {
    const { stack: own } = readProse(
      stack(
        `/**\n * The gateway.\n * @icon tech:cloudflare-workers-icon\n * @color blue\n */\nexport default Alchemy.Stack("S", {}, Effect.gen(function* () {}));`,
        { raw: true },
      ),
    );
    expect(own).toMatchObject({ description: "The gateway.", icon: "tech:cloudflare-workers-icon", color: "blue" });
  });

  it("reports a file it cannot parse rather than pretending it had no prose", () => {
    const { unparsed } = readProse(stack(`const broken = (((;`, { raw: true }));
    expect(unparsed).toEqual(["alchemy.run.ts"]);
  });
});
