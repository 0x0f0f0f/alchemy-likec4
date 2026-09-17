/**
 * Generated files go into `<project>/alchemy/`, where `<project>` is a LikeC4 project: a directory
 * holding one of the nine config filenames. LikeC4 picks up every `.c4` under it, so no `include`
 * wiring is needed — and it refuses to write anywhere else, because a bare directory is only an
 * implicit project by accident.
 */
import { readdirSync } from "node:fs";
import * as Data from "effect/Data";
import { isLikeC4Config } from "likec4/config";

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
  if (!entries.some(isLikeC4Config)) throw new NotALikeC4Project({ project });
  return `${project}/alchemy`;
};
