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
  return found as { id: string; nodes: unknown[]; edges: Array<{ kind?: string; relations?: string[] }> };
};

/** The model relationships an edge was derived from — the join key between the two view kinds. */
const relationsOf = (v: { edges: Array<{ relations?: string[] }> }) =>
  new Set(v.edges.flatMap((e) => e.relations ?? []));

const expected = { nodes: 8, edges: 8 };
for (const id of ["shortener_prod", "shortener_staging"]) {
  const v = view(id);
  if (v.nodes.length !== expected.nodes) throw new Error(`${id}: ${v.nodes.length} nodes, expected ${expected.nodes}`);
  if (v.edges.length !== expected.edges) throw new Error(`${id}: ${v.edges.length} edges, expected ${expected.edges}`);
  const untyped = v.edges.filter((e) => !e.kind);
  if (untyped.length > 0) throw new Error(`${id}: ${untyped.length} edges carry no binding kind`);
  console.log(`  ${id}: ${v.nodes.length} nodes, ${v.edges.length} edges, every edge typed`);
}
// Every relationship a deployment view draws must come from the model, because the deployment
// declares none. Containment, not equality: the stack's view is scoped to it, so `include *` also
// pulls in the actors and neighbours it talks to — edges the deployment has no instance for.
const landscape = view("shortener_landscape");
const inModel = relationsOf(landscape);
for (const id of ["shortener_prod", "shortener_staging"]) {
  const missing = [...relationsOf(view(id))].filter((r) => !inModel.has(r));
  if (missing.length > 0) throw new Error(`${id}: ${missing.length} relationships the model never declared`);
}
console.log(`  shortener_landscape: ${inModel.size} relationships, every deployment edge inherited from them`);
