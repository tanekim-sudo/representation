import {
  RESOLVE_PROMPT,
  RESEARCH_SYSTEM,
  researchPrompt,
  SYNTHESIZE_SYSTEM,
  SYNTHESIZE_SYSTEM_COMPACT,
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
import { defaultDeliverLeaf } from "../shared/deliverable-quality.js";

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

/** Research only when the function tree explicitly marks a research leaf. */
export function shouldEnableResearch(op, opMap, material) {
  if (isTransformPrimitive(op)) return primitiveNeedsResearch(op, material);
  return opTreeNeedsResearch(op, opMap);
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
      const desc = leaf.description ? ` (${leaf.description})` : "";
      return `${i + 1}. ${leaf.name}${desc}: ${body}`;
    })
    .join("\n");
}

/**
 * Primitives and moves: one perceptual LLM call — no resolve/research orchestration.
 */
function compileSimplePlan(op, material) {
  const prompt = (op.prompt || "").trim() || `Apply ${op.name} to the input.`;
  const phases = [
    {
      id: "synthesize",
      label: op.name,
      timeoutMs: synthesizeTimeoutMs(op.estimatedMs, false),
      maxTokens: op.maxTokens || 1400,
      prompt,
      system: PRIMITIVE_SYSTEM,
    },
  ];
  return {
    functionName: op.name,
    functionDescription: op.description || "",
    phases,
    fastPath: true,
    synthesize: { prompt, system: PRIMITIVE_SYSTEM },
    parseResolve: parseResolveOutput,
  };
}

/**
 * Compile a function tree into 1–3 phases (resolve / research / synthesize).
 * Research runs only when a leaf has research:true. Resolve only when sparse + resolve leaves exist.
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
    synthesizeLeaves.length > 0 ? synthesizeLeaves : leaves.filter((l) => !l.research && !isResolveLeaf(l));
  if (!workflowForSynth.length) {
    workflowForSynth = [defaultDeliverLeaf(op?.name || "function", op?.description || "")];
  }

  const phases = [];
  const plan = {
    functionName: op?.name || "function",
    functionDescription: op?.description || "",
    phases,
    fastPath: false,
  };

  if (sparse && parseLeaves.length > 0) {
    const resolvePrompt =
      parseLeaves.length > 0
        ? `${parseLeaves.map((l) => l.prompt).join("\n")}\n\n${RESOLVE_PROMPT}`
        : RESOLVE_PROMPT;
    phases.push({
      id: "resolve",
      label: "identify subject",
      timeoutMs: PHASE_TIMEOUT.resolve,
      maxTokens: 768,
      prompt: resolvePrompt,
    });
    plan.resolve = { prompt: resolvePrompt };
  }

  if (needsResearch) {
    const researchLeafPrompt = researchLeaves.map((l) => l.prompt).filter(Boolean).join("\n");
    phases.push({
      id: "research",
      label: "research",
      timeoutMs: PHASE_TIMEOUT.research,
      maxTokens: 2048,
      research: true,
      maxSearchUses: 2,
      system: RESEARCH_SYSTEM,
      researchLeafPrompt,
    });
    plan.research = { researchLeafPrompt, system: RESEARCH_SYSTEM };
  }

  const leafCount = workflowForSynth.length;
  const synthPrompt = synthesizePrompt(
    op?.name || "function",
    op?.description || "",
    compileWorkflowSteps(workflowForSynth),
    outputContractForFunction(op?.name, op?.description)
  );

  phases.push({
    id: "synthesize",
    label: op?.name || "deliver",
    timeoutMs: synthesizeTimeoutMs(null, leafCount > 2),
    maxTokens: leafCount > 2 ? 6144 : 4096,
    prompt: synthPrompt,
    system: leafCount > 2 ? SYNTHESIZE_SYSTEM : SYNTHESIZE_SYSTEM_COMPACT,
  });
  plan.synthesize = {
    prompt: synthPrompt,
    system: leafCount > 2 ? SYNTHESIZE_SYSTEM : SYNTHESIZE_SYSTEM_COMPACT,
  };

  plan.parseResolve = parseResolveOutput;
  return plan;
}

/** Raw material for single-step perceptual transforms. */
export function buildSimpleMaterial(material) {
  return (material || "").trim();
}

/** Fast synthesize input — includes prior phase context when present. */
export function buildFastMaterial(context) {
  const parts = [];
  const material = (context.material || "").trim();
  if (material) parts.push(material);
  if (context.research?.trim()) {
    parts.push(`Research:\n${context.research.trim()}`);
  }
  if (context.resolveRaw?.trim() && context.resolveRaw.trim() !== material) {
    parts.push(`Subject:\n${context.resolveRaw.trim()}`);
  }
  return parts.join("\n\n");
}

export function buildPhaseMaterial(phaseId, context) {
  const { material, subject, research, resolveRaw } = context;
  const parts = [];

  if (material?.trim()) {
    parts.push(`INPUT:\n${material.trim()}`);
  }
  if (subject?.trim() && subject !== material) {
    parts.push(`SUBJECT: ${subject.trim()}`);
  }
  if (resolveRaw?.trim() && phaseId === "synthesize") {
    parts.push(`ANALYSIS:\n${resolveRaw.trim()}`);
  }
  if (research?.trim() && phaseId === "synthesize") {
    parts.push(`RESEARCH:\n${research.trim()}`);
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
