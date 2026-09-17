/**
 * The environment contract of every auth provider alchemy ships, read from its declarations.
 *
 * Building a provider layer resolves credentials even when nothing will be called, and asking
 * alchemy for the contract (`Alchemist.Provider.checkEnvironment`) builds that same layer. So the
 * contract is read where alchemy declares it — the `environment: [ … ]` block of each
 * `AuthProvider.ts` — the way `categories.ts` reads `@category`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { alchemyDir } from "./extract.ts";

export interface RequiredVariable {
  readonly name: string;
  /** Other names that satisfy the same requirement. */
  readonly alternatives: readonly string[];
}

const authProviderFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) authProviderFiles(path, out);
    else if (entry === "AuthProvider.ts") out.push(path);
  }
  return out;
};

/** Each `{ … }` entry of the `environment: [ … ]` array, as text. */
const entries = (text: string): string[] => {
  const open = "environment: [";
  const start = text.indexOf(open);
  if (start === -1) return [];
  const out: string[] = [];
  let depth = 0;
  let from = -1;
  for (let i = start + open.length; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      if (depth++ === 0) from = i;
    } else if (c === "}") {
      if (--depth === 0) out.push(text.slice(from, i + 1));
    } else if (c === "]" && depth === 0) break;
  }
  return out;
};

/** Every variable some auth provider declares as required. */
export const requiredEnvironment = (alchemy = alchemyDir()): RequiredVariable[] =>
  authProviderFiles(join(alchemy, "src")).flatMap((file) =>
    entries(readFileSync(file, "utf8")).flatMap((entry) => {
      const name = entry.match(/name:\s*"([A-Z0-9_]+)"/)?.[1];
      if (!name || !/required:\s*true/.test(entry)) return [];
      const list = entry.match(/alternatives:\s*\[([^\]]*)\]/)?.[1] ?? "";
      return [{ name, alternatives: [...list.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1] as string) }];
    }),
  );

/** A placeholder for every required variable that is unset, so a provider layer builds. */
export const placeholderEnvironment = (vars = requiredEnvironment()): void => {
  for (const v of vars)
    if (!process.env[v.name] && !v.alternatives.some((a) => process.env[a])) process.env[v.name] = "placeholder";
};
