import {
  RESOLVE_PROMPT,
  RESEARCH_SYSTEM,
  researchPrompt,
  SYNTHESIZE_SYSTEM,
  synthesizePrompt,
  outputContractForFunction,
} from "./prompts.js";
import {
  isTransformPrimitive,
  PRIMITIVE_SYSTEM,
  primitiveNeedsResearch,
  primitiveNeedsResolve,
} from "../shared/transform-primitives.js";
import { PHASE_TIMEOUT, synthesizeTimeoutMs } from "../shared/phase-timeouts.js";
import { isResolveLeaf } from "../shared/function-standards.js";

/** One prompt leaf (moves, simple functions) — skip resolve/research orchestration. */
export function isSingleStepPrompt(op, opMap) {
  if (!op || op.research) return false;
  if (op.kind === "pipeline") {
    if (!op.steps?.length || op.steps.length !== 1) return false;
    return isSingleStepPrompt(opMap[op.steps[0]], opMap);
  }
  if (op.kind && op.kind !== "prompt") return false;
  if (isResolveLeaf({ name: op.name, prompt: op.prompt })) return false;
  return Boolean((op.prompt || "").trim());
}

/** Flatten any-depth operator tree to ordered leaves (depth-first). */
export function collectLeaves(op, opMap, out = []) {
  if (!op) return out;
  if (op.kind === "pipeline" && op.steps?.length) {
    for (const sid of op.steps) collectLeaves(opMap[sid], opMap, out);
    return out;
  }
  out.push({
    name: op.name || "step",
    prompt: (op.prompt || "").trim(),
    research: !!op.research,
    description: op.description || "",
  });
  return out;
}

export function opTreeNeedsResearch(op, opMap) {
  if (!op) return false;
  if (op.research) return true;
  if (op.kind === "pipeline" && op.steps?.length) {
    return op.steps.some((sid) => opTreeNeedsResearch(opMap[sid], opMap));
  }
  return false;
}

export function shouldEnableResearch(op, opMap, material) {
  if (isTransformPrimitive(op)) return primitiveNeedsResearch(op, material);
  if (opTreeNeedsResearch(op, opMap)) return true;
  const sparse = (material || "").trim().length < 500;
  const named = /\b(startup|ai|inc|corp|llc|labs|tech|company|platform|app)\b/i.test(material || "");
  if (sparse && (op?.role || named)) return true;
  return false;
}

function parseResolveOutput(text) {
  const entity = (text.match(/ENTITY:\s*(.+)/i) || [])[1]?.trim() || "";
  const termsRaw = (text.match(/SEARCH_TERMS:\s*([\s\S]+?)(?:\nNOTES:|$)/i) || [])[1] || "";
  const searchTerms = termsRaw
    .split(/\n/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter((l) => l.length > 2);
  return { entity, searchTerms, raw: text };
}

function compileWorkflowSteps(leaves) {
  return leaves
    .map((leaf, i) => {
      const body = leaf.prompt || `Apply "${leaf.name}" to the subject.`;
      const desc = leaf.description ? `\n   Description: ${leaf.description}` : "";
      return `${i + 1}. ${leaf.name}${desc}\n   ${body}`;
    })
    .join("\n\n");
}

/**
 * Primitives: resolve and/or research when appropriate, then one transform step.
 * Output stays a single coherent result — never multi-portal fan-out.
 */
function compileSimplePlan(op, material) {
  const prompt = (op.prompt || "").trim() || `Apply ${op.name} to the input.`;
  const phases = [];
  const plan = {
    functionName: op.name,
    functionDescription: op.description || "",
    phases,
    fastPath: true,
  };

  if (primitiveNeedsResolve(op, material)) {
    phases.push({
      id: "resolve",
      label: "identify subject",
      timeoutMs: PHASE_TIMEOUT.resolve,
      maxTokens: 1024,
      prompt: RESOLVE_PROMPT,
    });
    plan.resolve = { prompt: RESOLVE_PROMPT };
  }

  if (primitiveNeedsResearch(op, material)) {
    phases.push({
      id: "research",
      label: "research",
      timeoutMs: PHASE_TIMEOUT.research,
      maxTokens: 2048,
      research: true,
      maxSearchUses: 2,
      system: RESEARCH_SYSTEM,
    });
    plan.research = { system: RESEARCH_SYSTEM };
  }

  phases.push({
    id: "synthesize",
    label: op.name,
    timeoutMs: synthesizeTimeoutMs(op.estimatedMs, false),
    maxTokens: op.maxTokens || 1400,
    prompt,
    system: PRIMITIVE_SYSTEM,
  });
  plan.synthesize = { prompt, system: PRIMITIVE_SYSTEM };
  plan.parseResolve = parseResolveOutput;
  return plan;
}

/**
 * Compile an infinitely nested function into a 1–3 phase execution plan.
 * - resolve: fast subject ID (sparse input)
 * - research: dedicated web search pass
 * - synthesize: all quality work in one compiled prompt (uses research context)
 */
export function compileExecutionPlan(op, opMap, material) {
  if (isTransformPrimitive(op) || isSingleStepPrompt(op, opMap)) {
    return compileSimplePlan(op, material);
  }

  const leaves = collectLeaves(op, opMap);
  const sparse = (material || "").trim().length < 500;
  const needsResearch = shouldEnableResearch(op, opMap, material);

  const parseLeaves = leaves.filter(isResolveLeaf);
  const researchLeaves = leaves.filter((l) => l.research);
  const synthesizeLeaves = leaves.filter((l) => !l.research && !isResolveLeaf(l));

  let workflowForSynth =
    synthesizeLeaves.length > 0 ? synthesizeLeaves : leaves.filter((l) => !l.research);
  if (!workflowForSynth.length) workflowForSynth = [...leaves];

  const phases = [];
  const plan = {
    functionName: op?.name || "function",
    functionDescription: op?.description || "",
    phases,
  };

  if (sparse) {
    const resolvePrompt =
      parseLeaves.length > 0
        ? `${parseLeaves.map((l) => l.prompt).join("\n")}\n\n${RESOLVE_PROMPT}`
        : RESOLVE_PROMPT;
    phases.push({
      id: "resolve",
      label: "identify subject",
      timeoutMs: PHASE_TIMEOUT.resolve,
      maxTokens: 1024,
      prompt: resolvePrompt,
    });
    plan.resolve = { prompt: resolvePrompt };
  }

  if (needsResearch) {
    const researchLeafPrompt = researchLeaves.map((l) => l.prompt).filter(Boolean).join("\n");
    phases.push({
      id: "research",
      label: "web research",
      timeoutMs: PHASE_TIMEOUT.research,
      maxTokens: 3072,
      research: true,
      maxSearchUses: 3,
      system: RESEARCH_SYSTEM,
      researchLeafPrompt,
    });
    plan.research = { researchLeafPrompt, system: RESEARCH_SYSTEM };
  }

  const synthPrompt = synthesizePrompt(
    op?.name || "function",
    op?.description || "",
    compileWorkflowSteps(workflowForSynth),
    outputContractForFunction(op?.name, op?.description)
  );

  phases.push({
    id: "synthesize",
    label: op?.name || "deliver",
    timeoutMs: PHASE_TIMEOUT.synthesizeComposite,
    maxTokens: 6144,
    prompt: synthPrompt,
    system: SYNTHESIZE_SYSTEM,
  });
  plan.synthesize = { prompt: synthPrompt, system: SYNTHESIZE_SYSTEM };

  plan.parseResolve = parseResolveOutput;
  return plan;
}

/** Trim input for fast single-step transforms — no verbose wrappers. */
export function buildSimpleMaterial(material) {
  return (material || "").trim();
}

export function buildPhaseMaterial(phaseId, context) {
  const { material, subject, research, resolveRaw } = context;
  const parts = [];

  if (material?.trim()) {
    parts.push(`WHITEBOARD MATERIAL:\n"""\n${material.trim()}\n"""`);
  }
  if (subject?.trim() && subject !== material) {
    parts.push(`RESOLVED SUBJECT:\n"""\n${subject.trim()}\n"""`);
  }
  if (resolveRaw?.trim()) {
    parts.push(`SUBJECT ANALYSIS:\n"""\n${resolveRaw.trim()}\n"""`);
  }
  if (research?.trim() && phaseId === "synthesize") {
    parts.push(`VERIFIED WEB RESEARCH (ground your deliverable in these facts):\n"""\n${research.trim()}\n"""`);
  }

  return parts.join("\n\n");
}

export function buildResearchPrompt(context, plan) {
  const parsed = plan.parseResolve?.(context.resolveRaw || context.subject || "") || {};
  const entity = parsed.entity || context.subject || context.material?.split(/\s+/)[0] || "unknown";
  const terms = parsed.searchTerms?.length
    ? parsed.searchTerms
    : [`"${entity}" startup`, `"${entity}" funding`, `"${entity}" company`];

  let prompt = researchPrompt(entity, terms, context.material || "");
  if (plan.research?.researchLeafPrompt) {
    prompt = `${plan.research.researchLeafPrompt}\n\n---\n${prompt}`;
  }
  return prompt;
}
