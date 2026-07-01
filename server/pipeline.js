import { runPrompt } from "./claude.js";
import { conductSubjectResearch, injectResearchIntoMaterial } from "./research.js";

function summarizeLibraryCompact(operators, opMap) {
  if (!operators?.length) return "";
  const tops = operators.filter((o) => o.top);
  const lines = [];
  if (tops.length) {
    lines.push("Functions:");
    for (const t of tops.slice(0, 10)) {
      lines.push(`• ${t.name}${t.description ? ` — ${t.description}` : ""}`);
    }
  }
  const leaves = operators.filter((o) => (o.kind === "prompt" || !o.kind) && o.prompt);
  if (leaves.length) {
    lines.push(`Primitives: ${leaves.map((p) => p.name).slice(0, 24).join(", ")}`);
  }
  return lines.join("\n");
}

function formatPipelineInput(originalMaterial, currentMaterial) {
  const orig = (originalMaterial || "").trim();
  const cur = (currentMaterial || "").trim();
  if (!orig || orig === cur) return cur;
  return `ORIGINAL SUBJECT (never lose track of this — all work is about THIS):\n"""\n${orig}\n"""\n\nPRIOR STEP OUTPUT:\n"""\n${cur}\n"""`;
}

function opTreeNeedsResearch(op, opMap) {
  if (!op) return false;
  if (op.research) return true;
  if (op.kind === "pipeline" && op.steps?.length) {
    return op.steps.some((sid) => opTreeNeedsResearch(opMap[sid], opMap));
  }
  return false;
}

export function shouldEnableResearch(op, opMap, originalMaterial) {
  if (opTreeNeedsResearch(op, opMap)) return true;
  const sparse = (originalMaterial || "").trim().length < 500;
  const named = /\b(startup|ai|inc|corp|llc|labs|tech|company|platform|app)\b/i.test(originalMaterial || "");
  if (sparse && (op?.role || named)) return true;
  return false;
}

function executionSystem(operators, opMap, activeOp, originalMaterial = "", researching = false) {
  const compact = summarizeLibraryCompact(operators, opMap);
  let sys = `You execute a professional workflow on the user's thinking whiteboard. Return ONLY the deliverable — no preamble or meta-commentary.

CRITICAL RULES:
1. ORIGINAL SUBJECT — the user dragged this function onto specific board material. Stay locked to that subject in every sentence.
2. NEVER write about insufficient documentation, information gaps, evaluation process, or meta-risks in deal assessment. Always produce substantive content ABOUT the subject.
3. If input is a company name or short phrase (e.g. "bobyard ai startup"), treat it as the entity to analyze — use the VERIFIED WEB RESEARCH section if present, and web search if enabled.
4. For investment thesis: write an actual thesis ABOUT the named company — include Thesis, Market, Product, Traction, Team, Key Risks, Upside Scenario, Recommendation.
5. When VERIFIED WEB RESEARCH is provided, base your deliverable on those facts. Do not ignore them.`;

  if (researching) {
    sys += `\n\nWEB SEARCH ENABLED: Use web_search to verify and supplement facts about the subject before writing.`;
  }
  if (activeOp?.name) {
    sys += `\n\nActive function: "${activeOp.name}"`;
    if (activeOp.description) sys += ` — ${activeOp.description}`;
  }
  if (originalMaterial?.trim()) {
    sys += `\n\nORIGINAL BOARD MATERIAL (this is the subject — transform THIS):\n"""${originalMaterial.slice(0, 1500)}${originalMaterial.length > 1500 ? "…" : ""}"""`;
  }
  if (compact) {
    sys += `\n\nUser's function library:\n${compact}`;
  }
  return sys;
}

function buildStepInput(op, originalMaterial, material, researchBundle) {
  const orig = (originalMaterial || "").trim();
  const pipelineInput = formatPipelineInput(originalMaterial, material);
  if (op.name === "parse") return orig || material;
  if (op.research) return pipelineInput;
  if (researchBundle) {
    return `${injectResearchIntoMaterial(originalMaterial, researchBundle)}\n\nSTEP INPUT:\n"""\n${pipelineInput}\n"""`;
  }
  return pipelineInput;
}

async function applyOpTree(op, opMap, material, image, ctx = {}) {
  if (!op) return material;
  const { operators = [], originalMaterial = material, researchBundle = "" } = ctx;

  if (op.kind === "pipeline" && op.steps?.length) {
    let cur = material;
    let img = image;
    const total = op.steps.length;
    for (let i = 0; i < op.steps.length; i++) {
      const sub = opMap[op.steps[i]];
      ctx.onStep?.(sub?.name || `step ${i + 1}`, i, total);
      cur = await applyOpTree(sub, opMap, cur, img, { ...ctx, originalMaterial, researchBundle });
      img = null;
    }
    return cur;
  }

  ctx.onStep?.(op.name, 0, 1);
  const leafPrompt =
    (op.prompt || "").trim() || `Produce the "${op.name}" deliverable for the input subject. Return only the result.`;

  const liveSearch = !!op.research;
  const stepInput = buildStepInput(op, originalMaterial, material, researchBundle);

  const { outputs } = await runPrompt({
    prompt: leafPrompt,
    text: stepInput,
    image,
    system: executionSystem(operators, opMap, op, originalMaterial, liveSearch),
    maxTokens: liveSearch ? 8192 : 4096,
    research: liveSearch,
    forceSearch: liveSearch,
  });
  return outputs[0] || "";
}

export async function runPipeline({ op, opMap, operators, material, image, onStep }) {
  if (!op) {
    const err = new Error("A function 'op' is required.");
    err.status = 400;
    throw err;
  }
  const originalMaterial = material || "";
  const pipelineResearch = shouldEnableResearch(op, opMap, originalMaterial);

  let researchBundle = "";

  if (pipelineResearch) {
    onStep?.("web research", 0, 1);
    console.log("[lens] conducting subject research for:", originalMaterial.slice(0, 80));
    researchBundle = await conductSubjectResearch(originalMaterial);
    if (researchBundle) {
      console.log("[lens] research complete:", researchBundle.slice(0, 120).replace(/\n/g, " "));
    } else {
      console.warn("[lens] research returned empty for:", originalMaterial);
    }
  }

  const output = await applyOpTree(op, opMap, originalMaterial, image, {
    operators: operators || [],
    originalMaterial,
    researchBundle,
    onStep,
  });

  if (!output?.trim()) {
    const err = new Error("Pipeline returned empty output.");
    err.status = 500;
    throw err;
  }
  return { output, research: pipelineResearch, researchBundle: researchBundle ? true : false };
}
