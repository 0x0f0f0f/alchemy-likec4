import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotALikeC4Project, projectOutput } from "./project.ts";

const dir = () => mkdtempSync(join(tmpdir(), "alchemy-likec4-"));

describe("projectOutput", () => {
  it("refuses a directory without a LikeC4 config, and says how to make one", () => {
    const d = dir();
    expect(() => projectOutput(d)).toThrow(NotALikeC4Project);
    expect(() => projectOutput(d)).toThrow("not a LikeC4 project");
    expect(() => projectOutput(d)).toThrow(`${d}/likec4.config.json`);
    expect(() => projectOutput(d)).toThrow("https://likec4.dev/dsl/config/");
  });

  it("refuses a directory that does not exist", () => {
    expect(() => projectOutput(join(dir(), "missing"))).toThrow(NotALikeC4Project);
  });

  it("returns <project>/alchemy for any of LikeC4's config filenames", () => {
    for (const name of ["likec4.config.json", ".likec4rc", "likec4.config.ts"]) {
      const d = dir();
      writeFileSync(join(d, name), "{}");
      expect(projectOutput(d)).toBe(`${d}/alchemy`);
    }
  });
});
