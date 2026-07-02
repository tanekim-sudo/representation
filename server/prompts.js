// Prompt layers: META (behavior) → PHASE (resolve|research|synthesize) → FUNCTION (compiled tree)

export const LENS_SUBJECT_RULE =
  "Stay locked to the board subject. No meta-commentary, no refusing sparse input.";

export const RESOLVE_SYSTEM = `Extract the subject from whiteboard material. Return ONLY the block below.`;

export const RESOLVE_PROMPT = `Extract subject for downstream work.

ENTITY: [name]
TYPE: [startup | company | person | idea | text | other]
SEARCH_TERMS: [2-3 quoted queries]
NOTES: [one line]`;

export const RESEARCH_SYSTEM = `Research arm of lens. ${LENS_SUBJECT_RULE} Use web_search 2 times max. Bullet facts only.`;

export function researchPrompt(entity, searchTerms, originalMaterial) {
  return `Research "${entity}" for a deliverable. 2 web searches max.

Input: """${(originalMaterial || "").slice(0, 800)}"""
Search: ${searchTerms.slice(0, 3).join(" | ")}

Return brief bullets:
ENTITY / WEBSITE / PRODUCT / FUNDING / TEAM / TRACTION / SOURCES`;
}

export const SYNTHESIZE_SYSTEM = `Synthesis engine for lens. ${LENS_SUBJECT_RULE}
Use INPUT, SUBJECT, and RESEARCH when provided. Follow workflow + OUTPUT FORMAT exactly.
Return ONLY the finished deliverable.`;

export const SYNTHESIZE_SYSTEM_COMPACT = `Produce the deliverable. ${LENS_SUBJECT_RULE} Use research if provided. Return ONLY the deliverable.`;

export function synthesizePrompt(functionName, functionDescription, workflowSteps, outputContract) {
  return `Deliverable: "${functionName}"
${functionDescription ? `Contract: ${functionDescription}\n` : ""}
Steps (internal — do not show intermediate output):
${workflowSteps}

${outputContract}

Return ONLY the finished deliverable.`;
}

export function outputContractForFunction(name, description = "") {
  const desc = (description || "").trim();
  if (desc.length > 30) {
    return `OUTPUT:\n${desc}`;
  }

  const n = (name || "").toLowerCase();
  if (n.includes("thesis"))
    return `OUTPUT sections: Thesis, Market, Product, Traction, Team, Key Risks, Upside Scenario, Recommendation`;
  if (n.includes("memo"))
    return `OUTPUT: Executive Summary, Investment Highlights, Business Overview, Market, Risks, Recommendation`;
  if (n.includes("comp"))
    return `OUTPUT: Overview, Comparable Companies, Key Takeaways`;
  if (n.includes("differentiate"))
    return `OUTPUT: Distinct parts as paragraphs separated by blank lines.`;
  if (n.includes("merge"))
    return `OUTPUT: One unified text.`;
  if (n.includes("compress") || n.includes("expand") || n.includes("ground") || n.includes("generalize"))
    return `OUTPUT: Plain prose — one coherent result.`;
  return `OUTPUT: Complete work product for "${name}".`;
}
