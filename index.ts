/**
 * alchemy-likec4 — LikeC4 from alchemy.
 *
 * Two halves. The specification: every resource kind alchemy can provision, reflected from the
 * package. The deployment model: a stack's actual resources and bindings, compiled from its
 * entrypoint without deploying. Both are built with LikeC4's own Builder and printed with its
 * own generator; nothing is typed by hand.
 *
 *   import { openStack, buildDeployment } from "alchemy-likec4";
 *   await writeFile("infra.gen.c4", buildDeployment(await openStack({ stage: "prod" })));
 *
 * The specification is a property of the PROJECT, not of one stack: LikeC4 rejects a kind
 * declared twice, so `generate` writes the union of every stack in the run to one file.
 */

export { type Annotations, annotationsFor, categoriesFor } from "./src/annotations.ts";
export { assertConverges, type Baseline, freeze, newViolations, type Reflexion, reflexion } from "./src/assert.ts";
export { bindingKinds, toRelationshipKind } from "./src/bindings.ts";
export {
  buildCrossStack,
  buildDeployment,
  buildLandscape,
  buildModel,
  buildSpecification,
  buildViews,
  type CrossStack,
  type CrossStackRelation,
  crossStackRelations,
  hasNamespaces,
  type ModelOptions,
  modelId,
  type SpecificationOptions,
  stackId,
  toIdentifier,
  toTag,
} from "./src/build.ts";
export { type AlchemyResource, discoverProviders, extractResources } from "./src/extract.ts";
export {
  type GenerateOptions,
  type GenerateResult,
  generate,
  type StackInput,
  type StackSummary,
  write,
} from "./src/generate.ts";
export {
  type CrossStackEdge,
  type OpenOptions,
  openStack,
  type StackEdge,
  type StackGraph,
  type StackResource,
  stackGraph,
} from "./src/stack.ts";
