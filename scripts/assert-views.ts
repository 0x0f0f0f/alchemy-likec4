#!/usr/bin/env bun
/**
 * Assert the computed model, not the generated text.
 *
 * The generated deployment declares no relationships: LikeC4 inherits them from the logical model
 * through `instanceOf`. That is the load-bearing claim of the whole design, so CI checks it on the
 * model LikeC4 actually computes. It also guards the `.**` trap — the descendants selector drops
 * elements with no relationship, so an isolated bucket would silently vanish from the diagram.
 */
const [path] = process.argv.slice(2);
if (!path) throw new Error("usage: assert-views.ts <likec4 export json output>");

const projects = JSON.parse(await Bun.file(path).text()) as Array<{ views: unknown }>;
const views = projects.flatMap((p) => (Array.isArray(p.views) ? p.views : Object.values(p.views ?? {})));
const view = (id: string) => {
  const found = (views as Array<{ id: string }>).find((v) => v.id === id);
  if (!found) throw new Error(`no view '${id}' in ${path}; found ${(views as Array<{ id: string }>).map((v) => v.id).join(", ")}`);
  return found as { id: string; nodes: unknown[]; edges: Array<{ kind?: string }> };
};

const expected = { nodes: 8, edges: 8 };
for (const id of ["shortener_prod", "shortener_staging"]) {
  const v = view(id);
  if (v.nodes.length !== expected.nodes) throw new Error(`${id}: ${v.nodes.length} nodes, expected ${expected.nodes}`);
  if (v.edges.length !== expected.edges) throw new Error(`${id}: ${v.edges.length} edges, expected ${expected.edges}`);
  const untyped = v.edges.filter((e) => !e.kind);
  if (untyped.length > 0) throw new Error(`${id}: ${untyped.length} edges carry no binding kind`);
  console.log(`  ${id}: ${v.nodes.length} nodes, ${v.edges.length} edges, every edge typed`);
}
// The landscape sees the same relationships, from the same declaration.
const landscape = view("shortener_landscape");
if (landscape.edges.length !== expected.edges)
  throw new Error(`shortener_landscape: ${landscape.edges.length} edges, expected ${expected.edges}`);
console.log(`  shortener_landscape: ${landscape.edges.length} edges, inherited by both stages`);
