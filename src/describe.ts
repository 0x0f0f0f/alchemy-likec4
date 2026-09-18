/**
 * Read the user's own prose for each resource from the JSDoc above it in their stack.
 *
 * `extend` cannot add a `description` to an element (verified against likec4 1.59.3: it accepts
 * tags, links, metadata and relationships, and rejects description, technology, title, style and
 * icon). So a generated element's description has to come from the generator, and the only place
 * the user can write it without editing a generated file is next to the resource itself:
 *
 *   /** The only thing on the request path a visitor waits for. *\/
 *   const redirect = yield* Cloudflare.Worker("redirect", { ... });
 *
 * Keyed on the logical id — the first argument — which is the same key the compiled stack uses.
 * Decoration only: a resource with no JSDoc simply has no description.
 *
 * TypeScript is parsed as TypeScript, JSDoc as JSDoc. The regex this replaced knew what neither a
 * comment nor a binding nor a call was, so every shape it did not anticipate — `export const`, a
 * resource in a ternary, a comment terminator inside a fence — was silently wrong rather than loud.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse as parseBlock } from "comment-parser";
import { parseSync } from "oxc-parser";

/** The tags this generator defines. */
const DEFINED = new Set(["icon", "color"]);

/** A JSDoc tag name is an identifier. `@internal` is one; `@rel-int.ai` is an address. */
const TAG_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/;

/** Minimal shape of the ESTree nodes walked here; oxc returns far more than is read. */
interface Node {
  readonly type: string;
  readonly start: number;
  readonly [key: string]: unknown;
}

interface Comment {
  readonly type: string;
  readonly start: number;
  readonly end: number;
}

/**
 * A JSDoc block, split into the prose and the tags this generator defines.
 *
 * Three kinds of `@` line, and they are not the same thing. Ours (`@icon`, `@color`) are metadata.
 * A real JSDoc tag (`@internal`, `@param`) is metadata too — someone else's, and not description.
 * The third is a line that only looks like a tag: `@rel-int.ai addresses only.` is a sentence, and
 * dropping it would delete the author's prose. A tag NAME is an identifier, which is what tells
 * the second from the third.
 */
const read = (raw: string): { description: string; tags: ReadonlyMap<string, string> } => {
  const [block] = parseBlock(raw);
  const tags = new Map<string, string>();
  if (!block) return { description: "", tags };

  const prose = [block.description];
  for (const tag of block.tags) {
    // comment-parser splits a tag's value at the first space, so the value is both halves.
    const value = [tag.name, tag.description].filter(Boolean).join(" ").trim();
    if (DEFINED.has(tag.tag)) tags.set(tag.tag, value);
    else if (!TAG_NAME.test(tag.tag)) prose.push(`@${tag.tag} ${value}`.trim());
  }
  return { description: prose.filter(Boolean).join(" ").replace(/\s+/g, " ").trim(), tags };
};

/**
 * The JSDoc block attached to whatever starts at `start`.
 *
 * "The nearest block comment above, with only whitespace between" — which is what the regex could
 * not express, and why a block above `export default` used to swallow the file down to the next.
 */
const jsdocAt = (start: number, comments: readonly Comment[], src: string): string | undefined => {
  let best: Comment | undefined;
  for (const c of comments)
    if (c.type === "Block" && c.end <= start && (best === undefined || c.end > best.end)) best = c;
  if (!best || src.slice(best.end, start).trim() !== "") return undefined;
  const raw = src.slice(best.start, best.end);
  return raw.startsWith("/**") ? raw : undefined;
};

/**
 * The logical id a resource call names — the innermost call in a callee chain whose first argument
 * is a string literal.
 *
 * `yield* Cloudflare.D1.Database("AuthDb", {}).pipe(RemovalPolicy.retain(…))` yields the `.pipe`
 * call, whose first argument is not a string. The id is one level in.
 */
const logicalIdOf = (node: unknown): string | undefined => {
  let call = node as Node | undefined;
  while (call?.type === "CallExpression") {
    const first = (call.arguments as Array<{ type?: string; value?: unknown }> | undefined)?.[0];
    if (first?.type === "Literal" && typeof first.value === "string") return first.value;
    const callee = call.callee as Node | undefined;
    call = callee?.type === "MemberExpression" ? (callee.object as Node) : undefined;
  }
  return undefined;
};

const isStatement = (type: string): boolean =>
  type.endsWith("Statement") || type === "VariableDeclaration" || type.startsWith("Export");

/** Walk every node, carrying the innermost enclosing statement — what a JSDoc block attaches to. */
const walk = (node: unknown, stmt: Node | undefined, visit: (n: Node, stmt: Node | undefined) => void): void => {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, stmt, visit);
    return;
  }
  const n = node as Node;
  if (typeof n.type !== "string") return;
  const here = isStatement(n.type) ? n : stmt;
  visit(n, here);
  for (const key of Object.keys(n)) if (key !== "type") walk(n[key], here, visit);
};

/** What a stack says about itself, from the JSDoc above its own declaration. */
export interface StackProse {
  readonly description?: string;
  /** `@icon`, any icon LikeC4 bundles — `tech:cloudflare-workers-icon`. */
  readonly icon?: string;
  /** `@color`, a theme colour or one declared in the consumer's own specification. */
  readonly color?: string;
}

export interface Prose {
  /** Logical id → the prose above its declaration. */
  readonly descriptions: ReadonlyMap<string, string>;
  /** The stack's own prose and styling, from the entrypoint. */
  readonly stack: StackProse;
  /**
   * Files that would not parse, relative to the entrypoint's directory. Their resources lose their
   * prose, which is the silent failure this module exists to stop, so it is reported rather than
   * swallowed.
   */
  readonly unparsed: readonly string[];
}

/** Every `.ts` under `dir`, skipping the places a stack never declares resources. */
const sources = (dir: string): string[] => {
  const out: string[] = [];
  const walkDir = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".alchemy" || entry.startsWith(".")) continue;
      const path = join(d, entry);
      if (statSync(path).isDirectory()) walkDir(path);
      else if (entry.endsWith(".ts")) out.push(path);
    }
  };
  walkDir(dir);
  return out;
};

/**
 * Every resource's prose, and the stack's own.
 *
 * @param entrypoint the stack entrypoint; its whole directory tree is scanned, because alchemy's
 *   own file-layout guidance is one file per resource. Only the entrypoint declares the stack.
 */
export const readProse = (entrypoint: string): Prose => {
  const root = dirname(entrypoint);
  const descriptions = new Map<string, string>();
  const unparsed: string[] = [];
  let stack: StackProse = {};

  for (const path of sources(root)) {
    let src: string;
    try {
      src = readFileSync(path, "utf8");
    } catch {
      unparsed.push(relative(root, path));
      continue;
    }

    const parsed = parseSync(path, src);
    if (parsed.errors.length > 0) {
      unparsed.push(relative(root, path));
      continue;
    }
    const comments = parsed.comments as readonly Comment[];

    walk(parsed.program, undefined, (node, stmt) => {
      // A resource: `yield* Something("<logicalId>", …)`, however it is bound.
      if (node.type === "YieldExpression" && node.delegate === true) {
        const id = logicalIdOf(node.argument);
        // First wins, so a resource declared once keeps its own prose even if an id repeats.
        if (id === undefined || descriptions.has(id) || stmt === undefined) return;
        const raw = jsdocAt(stmt.start, comments, src);
        if (!raw) return;
        const { description } = read(raw);
        if (description) descriptions.set(id, description);
        return;
      }
      // The stack itself is never yielded, so it needs its own arm.
      if (node.type === "ExportDefaultDeclaration" && path === entrypoint) {
        if (logicalIdOf(node.declaration) === undefined) return;
        const raw = jsdocAt(node.start, comments, src);
        if (!raw) return;
        const { description, tags } = read(raw);
        stack = {
          ...(description ? { description } : {}),
          ...(tags.get("icon") ? { icon: tags.get("icon") } : {}),
          ...(tags.get("color") ? { color: tags.get("color") } : {}),
        };
      }
    });
  }

  return { descriptions, stack, unparsed: unparsed.sort() };
};
