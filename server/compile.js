// Compiles any function tree (no matter how nested) into ONE execution prompt.
// At runtime the entire workflow runs in a single Claude call.

export const EXECUTION_META = `Execute this function in ONE pass on the user's whiteboard material.

How to run:
- Follow every step below internally, in order. Do NOT show intermediate steps.
- Output ONLY the final deliverable — no preamble, no "insufficient data", no process commentary.
- If web search is available and the input names a company, startup, or product: run 1–2 targeted searches, then write the deliverable immediately.
- Stay locked to the original subject. Be fast and decisive.`;

function compileStep(op, opMap, depth = 0) {
  if (!op) return "";
  const indent = "  ".repeat(depth);

  if (op.kind === "pipeline" && op.steps?.length) {
    return op.steps
      .map((sid, i) => {
        const sub = opMap[sid];
        if (!sub) return null;
        const inner = compileStep(sub, opMap, depth + 1);
        const search = sub.research ? " [web search]" : "";
        return `${indent}${i + 1}. ${sub.name}${search}\n${inner}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  const prompt = (op.prompt || "").trim() || `Apply "${op.name}" to the material.`;
  return `${indent}${prompt}`;
}

export function compileOpToPrompt(op, opMap) {
  if (!op) return "Transform the material and return the result.";

  if (op.kind === "pipeline" && op.steps?.length) {
    const workflow = compileStep(op, opMap);
    return `${EXECUTION_META}

FUNCTION: ${op.name}${op.description ? `\nGOAL: ${op.description}` : ""}

WORKFLOW (do all of this internally, then output only the final result):
${workflow}

FINAL OUTPUT: The completed deliverable only.`;
  }

  return `${EXECUTION_META}

FUNCTION: ${op.name}${op.description ? `\nGOAL: ${op.description}` : ""}

INSTRUCTION:
${(op.prompt || "").trim() || `Produce the "${op.name}" deliverable for the material.`}

FINAL OUTPUT: The deliverable only.`;
}

export function opTreeNeedsResearch(op, opMap) {
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
