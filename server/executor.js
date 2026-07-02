import { runPrompt } from "./claude.js";
import {
  compileExecutionPlan,
  buildPhaseMaterial,
  buildSimpleMaterial,
  buildResearchPrompt,
} from "./plan.js";
import { RESOLVE_SYSTEM, RESEARCH_SYSTEM, SYNTHESIZE_SYSTEM } from "./prompts.js";

export { compileExecutionPlan, shouldEnableResearch } from "./plan.js";

export async function runPhase(phaseId, plan, context, { operators, op, image, onStep } = {}) {
  const phase = plan.phases.find((p) => p.id === phaseId);
  if (!phase) {
    const err = new Error(`Unknown phase: ${phaseId}`);
    err.status = 400;
    throw err;
  }

  onStep?.(phase.label, plan.phases.indexOf(phase), plan.phases.length);

  if (phaseId === "resolve") {
    const { outputs } = await runPrompt({
      prompt: phase.prompt,
      text: buildPhaseMaterial("resolve", context),
      image,
      system: RESOLVE_SYSTEM,
      maxTokens: phase.maxTokens,
      timeoutMs: phase.timeoutMs,
    });
    const raw = outputs[0] || "";
    const parsed = plan.parseResolve?.(raw) || {};
    return {
      output: raw,
      subject: parsed.entity || context.material,
      resolveRaw: raw,
    };
  }

  if (phaseId === "research") {
    const prompt = buildResearchPrompt(context, plan);
    const { outputs } = await runPrompt({
      prompt,
      text: buildPhaseMaterial("research", context),
      image: null,
      system: phase.system || RESEARCH_SYSTEM,
      maxTokens: phase.maxTokens,
      timeoutMs: phase.timeoutMs,
      research: true,
      maxSearchUses: phase.maxSearchUses || 6,
    });
    return { output: outputs[0] || "", research: outputs[0] || "" };
  }

  if (phaseId === "synthesize") {
    const fast = plan.fastPath;
    let sys = phase.system || SYNTHESIZE_SYSTEM;
    if (!fast) {
      if (op?.name) sys += `\n\nFunction: "${op.name}"`;
      if (context.material?.trim()) {
        sys += `\n\nOriginal subject: """${context.material.slice(0, 1000)}"""`;
      }
      if (operators?.length) {
        const tops = operators.filter((o) => o.top).map((o) => o.name).slice(0, 8);
        if (tops.length) sys += `\n\nUser toolbox: ${tops.join(", ")}`;
      }
    }

    const fallbackSearch = !fast && !!context.researchFallback && !context.research?.trim();
    if (fallbackSearch) {
      sys += `\n\nWeb search available: run 1–2 quick searches on the entity, then write the deliverable.`;
    }

    const text = fast ? buildSimpleMaterial(context.material) : buildPhaseMaterial("synthesize", context);
    const { outputs } = await runPrompt({
      prompt: phase.prompt,
      text,
      image,
      system: sys,
      maxTokens: phase.maxTokens,
      timeoutMs: phase.timeoutMs,
      research: fallbackSearch,
      maxSearchUses: 2,
      temperature: fast ? 0.35 : undefined,
    });
    return { output: outputs[0] || "" };
  }

  const err = new Error(`Unhandled phase: ${phaseId}`);
  err.status = 400;
  throw err;
}

/** Run full compiled plan — used when client wants one server round-trip. */
export async function runExecutionPlan({ op, opMap, operators, material, image, onStep }) {
  const plan = compileExecutionPlan(op, opMap, material);
  const context = {
    material: material || "",
    subject: material || "",
    research: "",
    resolveRaw: "",
  };

  for (const phase of plan.phases) {
    try {
      const result = await runPhase(phase.id, plan, context, { operators, op, image, onStep });
      if (phase.id === "resolve") {
        context.subject = result.subject || context.subject;
        context.resolveRaw = result.resolveRaw || result.output;
      }
      if (phase.id === "research") {
        context.research = result.research || result.output;
      }
      if (phase.id === "synthesize") {
        const output = (result.output || "").trim();
        if (!output) throw Object.assign(new Error("Empty deliverable."), { status: 500 });
        return { output, plan, phasesRun: plan.phases.map((p) => p.id) };
      }
    } catch (err) {
      if (phase.id === "research") {
        console.warn("[lens] research phase failed, continuing with synthesize fallback:", err?.message);
        context.research = "";
        context.researchFallback = true;
        continue;
      }
      throw err;
    }
  }

  throw Object.assign(new Error("Plan completed without synthesize phase."), { status: 500 });
}
