import { buildModel } from "./src/build.ts"
import { openStack } from "./src/stack.ts"
const g = await openStack({ entrypoint: "examples/basic/alchemy.run.ts", stage: "prod" })
console.log(buildModel(g, { kinds: [...new Set(g.resources.map(r=>r.type))], bindings: [], descriptions: new Map() }).split("\n").slice(8, 20).join("\n"))
