import { runPrompt } from "./claude.js";
import { compileOpToPrompt, shouldEnableResearch } from "./compile.js";

function executionSystem(operators, op, originalMaterial, researching) {
  let sys = `You execute one compiled function on a thinking whiteboard. Return ONLY the final deliverable.

- Stay locked to the subject in the material.
- Never refuse or discuss missing data — deliver substantive work product.
- Investment thesis: Thesis, Market, Product, Traction, Team, Risks, Upside, Recommendation.`;

  if (researching) {
    sys += `\n- Web search available: 1–2 quick searches on the entity name, then write.`;
  }
  if (op?.name) sys += `\n\nFunction: "${op.name}"`;
  if (originalMaterial?.trim()) {
    sys += `\n\nSubject: """${originalMaterial.slice(0, 800)}"""`;
  }
  if (operators?.length) {
    const tops = operators.filter((o) => o.top).map((o) => o.name).slice(0, 8);
    if (tops.length) sys += `\n\nUser's toolbox: ${tops.join(", ")}`;
  }
  return sys;
}

export async function runPipeline({ op, opMap, operators, material, image, onStep }) {
  if (!op) {
    const err = new Error("A function 'op' is required.");
    err.status = 400;
    throw err;
  }

  const originalMaterial = material || "";
  const researching = shouldEnableResearch(op, opMap, originalMaterial);
  const compiledPrompt = compileOpToPrompt(op, opMap);

  onStep?.(researching ? `${op.name} · searching` : op.name, 0, 1);

  const { outputs } = await runPrompt({
    prompt: compiledPrompt,
    text: originalMaterial,
    image,
    system: executionSystem(operators, op, originalMaterial, researching),
    maxTokens: 4096,
    research: researching,
  });

  const output = (outputs[0] || "").trim();
  if (!output) {
    const err = new Error("Empty output.");
    err.status = 500;
    throw err;
  }

  return { output, research: researching, compiled: true };
}

// re-export for api
export { shouldEnableResearch } from "./compile.js";
