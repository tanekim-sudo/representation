import { runExecutionPlan } from "./executor.js";

export { compileExecutionPlan, shouldEnableResearch } from "./plan.js";

export async function runPipeline(opts) {
  return runExecutionPlan(opts);
}
