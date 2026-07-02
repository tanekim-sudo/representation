/** Standards for function trees — full vs fast creation paths. */

export const FUNCTION_NAMING_RULES = `NAMING: 3–7 words, action-oriented (e.g. "Build Investment Thesis").`;

export const FUNCTION_DESCRIPTION_RULES = `DESCRIPTION: one sentence — input → deliverable shape.`;

export const LEAF_PROMPT_RULES = `LEAF PROMPT: one perceptual instruction OR short labeled sections (GOAL, OUTPUT FORMAT). Keep leaves fast to run — prefer one line when possible.`;

export const FAST_LEAF_PROMPT_RULES = `LEAF PROMPT: one line — a perceptual move (e.g. "Draft thesis sections from research."). No essays.`;

export const FUNCTION_JSON_SHAPE = `JSON: composites {"name","description","steps":[...]} — no prompt on composites. Leaves {"name","description","prompt":"..."}. Optional "research":true on ONE leaf max.`;

export const RECOMMENDED_PIPELINE = `PIPELINE: 1) Identify subject (if sparse) 2) ONE research leaf (research:true) 3) Analyze 4) Draft deliverable.`;

export const FUNCTION_ARCHITECT_STANDARDS = `${FUNCTION_NAMING_RULES}
${FUNCTION_DESCRIPTION_RULES}
${LEAF_PROMPT_RULES}
${FUNCTION_JSON_SHAPE}
${RECOMMENDED_PIPELINE}`;

export const FAST_FUNCTION_ARCHITECT_STANDARDS = `${FUNCTION_NAMING_RULES}
${FUNCTION_DESCRIPTION_RULES}
${FAST_LEAF_PROMPT_RULES}
${FUNCTION_JSON_SHAPE}
${RECOMMENDED_PIPELINE}`;

/** Detect resolve/parse leaves after descriptive renaming. */
export function isResolveLeaf(leaf) {
  if (!leaf) return false;
  const name = (leaf.name || "").toLowerCase();
  const prompt = (leaf.prompt || "").toLowerCase();
  if (/^(parse|identify subject|identify entity|resolve subject|extract subject|extract entity)\b/.test(name)) return true;
  if (/\bidentify (the )?(subject|entity)\b/.test(name)) return true;
  if (/\bentity:\s*|\bsearch_terms:\s*/.test(prompt)) return true;
  if (/\bextract (the )?(subject|entity)\b/.test(prompt)) return true;
  if (/return exactly:\s*\nentity:/i.test(prompt)) return true;
  return false;
}
