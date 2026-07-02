/** Detect pipeline metadata that must never appear as canvas deliverables. */

const INTERNAL_MARKERS =
  /\b(ENTITY|SEARCH_?TERMS|SEARCHTERMS|TYPE|NOTES|COMP CRITERIA|COMP CRITERIA|WEBSITE|FUNDING|TRACTION|SOURCES)\s*:/i;

export function isInternalMetadataOutput(text) {
  const t = (text || "").trim();
  if (!t) return false;
  const markerHits = (t.match(new RegExp(INTERNAL_MARKERS.source, "gi")) || []).length;
  const hasSections = /^#{1,3}\s+\S/m.test(t) || /^##\s/m.test(t);
  if (markerHits >= 2 && !hasSections) return true;
  if (/^ENTITY:/im.test(t) && /SEARCH/i.test(t) && !hasSections) return true;
  return false;
}

export function deliverableRewritePrompt(functionName, functionDescription = "") {
  const contract = functionDescription?.trim() ? `\nDeliverable shape: ${functionDescription}` : "";
  return `Rewrite the draft below as a polished professional deliverable for "${functionName}".${contract}

Rules:
- NO internal metadata (ENTITY, SEARCH_TERMS, TYPE, NOTES, COMP CRITERIA).
- Use clear markdown section headers (##) appropriate to the function.
- Specific, decisive, about the subject — not process narration.
- Return ONLY the finished deliverable.`;
}

export function defaultDeliverLeaf(functionName, functionDescription = "") {
  const desc = functionDescription?.trim() || `Complete ${functionName} on the subject.`;
  return {
    name: "Deliver Final Output",
    description: desc,
    prompt: `Produce the finished "${functionName}" deliverable. ${desc} Use research if provided. Markdown sections. Return ONLY the deliverable.`,
  };
}
