/**
 * alchemy-likec4 — LikeC4 from alchemy.
 *
 * Two halves. The specification: every resource kind alchemy can provision, reflected from the
 * package. The deployment model: a stack's actual resources and bindings, compiled from its
 * entrypoint without deploying. Both are built with LikeC4's own Builder and printed with its
 * own generator; nothing is typed by hand.
 *
 *   import { openStack, buildDeployment } from "alchemy-likec4";
 *   await Bun.write("infra.gen.c4", buildDeployment(await openStack({ stage: "prod" })));
 */
export { assertConverges, type Baseline, freeze, newViolations, type Reflexion, reflexion } from "./src/assert.ts";
export { bindingKinds, toRelationshipKind } from "./src/bindings.ts";
export { buildDeployment, buildSpecification, buildStackSpecification, toIdentifier, toTag } from "./src/build.ts";
export { categoriesFor } from "./src/categories.ts";
export { type AlchemyResource, discoverProviders, extractResources } from "./src/extract.ts";
export { type GenerateOptions, type GenerateResult, generateSpecs } from "./src/generate.ts";
export {
  type OpenOptions,
  openStack,
  type StackEdge,
  type StackGraph,
  type StackResource,
  stackGraph,
} from "./src/stack.ts";
