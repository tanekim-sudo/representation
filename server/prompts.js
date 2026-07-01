// Lens-specific prompting architecture — three layers:
// 1. META: how Claude should behave in this app
// 2. PHASE: resolve | research | synthesize — each optimized for its job
// 3. FUNCTION: compiled from the user's operator tree

export const LENS_SUBJECT_RULE =
  "The whiteboard subject is sacred. Every sentence must be about THAT entity — never meta-commentary, never 'insufficient data'.";

export const RESOLVE_SYSTEM = `You identify the subject on a thinking whiteboard.
${LENS_SUBJECT_RULE}
Return ONLY a compact subject block — no prose essay.`;

export const RESOLVE_PROMPT = `From the material below, extract the subject for downstream work.

Return EXACTLY:
ENTITY: [official or best-guess name]
TYPE: [startup | company | person | idea | text | other]
SEARCH_TERMS: [2-4 quoted search queries to find this entity online, e.g. "Bobyard AI startup", "Bobyard construction funding"]
NOTES: [one line — what the user likely wants analyzed]`;

export const RESEARCH_SYSTEM = `You are the research arm of lens.
${LENS_SUBJECT_RULE}

Use web_search 2–3 times with the SEARCH_TERMS, then STOP and return facts. Be concise — bullet facts only, no essays.`;

export function researchPrompt(entity, searchTerms, originalMaterial) {
  return `Quick research for a professional deliverable. Use 2–3 web searches only.

INPUT: """${originalMaterial}"""
ENTITY: ${entity}
SEARCH (pick 2–3): ${searchTerms.slice(0, 3).join(" | ")}

Return ONLY these lines (brief):
ENTITY:
WEBSITE:
PRODUCT:
FUNDING:
TEAM:
TRACTION:
SOURCES: (urls)`;
}

export const SYNTHESIZE_SYSTEM = `You are the synthesis engine of lens — you produce the final professional deliverable.
${LENS_SUBJECT_RULE}

You receive VERIFIED SUBJECT and optionally VERIFIED RESEARCH. Use them. Produce expert-grade output.
Return ONLY the deliverable — no preamble, no process narration, no JSON.`;

export function synthesizePrompt(functionName, functionDescription, workflowSteps, outputContract) {
  return `Produce the final "${functionName}" deliverable.

GOAL: ${functionDescription || `Complete the ${functionName} function on the subject.`}

Execute these steps INTERNALLY in order (do not show intermediate output):
${workflowSteps}

${outputContract}

Return ONLY the finished deliverable.`;
}

export function outputContractForFunction(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("thesis"))
    return `OUTPUT FORMAT — include these sections:
## Thesis
## Market
## Product
## Traction
## Team
## Key Risks
## Upside Scenario
## Recommendation`;
  if (n.includes("memo"))
    return `OUTPUT FORMAT: Executive Summary, Investment Highlights, Business Overview, Market, Risks, Recommendation.`;
  if (n.includes("split"))
    return `OUTPUT FORMAT: Separate distinct sub-ideas as paragraphs separated by blank lines.`;
  if (n.includes("combine"))
    return `OUTPUT FORMAT: One unified text combining all parts.`;
  return `OUTPUT FORMAT: Complete professional work product appropriate to "${name}".`;
}
