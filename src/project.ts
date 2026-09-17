/**
 * Generated files go into `<project>/alchemy/`, where `<project>` is a LikeC4 project: a directory
 * holding one of the nine config filenames. LikeC4 picks up every `.c4` under it, so no `include`
 * wiring is needed — and it refuses to write anywhere else, because a bare directory is only an
 * implicit project by accident.
 */
import { readdirSync } from "node:fs";
import * as Data from "effect/Data";

/** LikeC4's own `ConfigFilenames`, inlined: `@likec4/config` reaches them only through an entry
 *  that needs `bundle-require` and `esbuild` as peers, which is a 10MB install to match 9 strings.
 *  Source: `@likec4/config/src/filenames.ts`. */
const CONFIG_FILENAMES: readonly string[] = [
  ".likec4rc",
  ".likec4.config.json",
  "likec4.config.json",
  "likec4.config.js",
  "likec4.config.cjs",
  "likec4.config.mjs",
  "likec4.config.ts",
  "likec4.config.cts",
  "likec4.config.mts",
];

export class NotALikeC4Project extends Data.TaggedError("NotALikeC4Project")<{ readonly project: string }> {
  override get message(): string {
    return [
      `${this.project} is not a LikeC4 project: no likec4.config.* found in it.`,
      `Create one:  mkdir -p ${this.project} && echo '{ "name": "my-app" }' > ${this.project}/likec4.config.json`,
      "Docs: https://likec4.dev/dsl/config/",
    ].join("\n");
  }
}

/** `<project>/alchemy`, or throw if `project` is not a LikeC4 project. */
export const projectOutput = (project: string): string => {
  let entries: string[];
  try {
    entries = readdirSync(project);
  } catch {
    throw new NotALikeC4Project({ project });
  }
  if (!entries.some((e) => CONFIG_FILENAMES.includes(e))) throw new NotALikeC4Project({ project });
  return `${project}/alchemy`;
};
