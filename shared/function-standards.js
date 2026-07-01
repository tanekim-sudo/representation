/** Canonical standards for every function created or edited in lens. */

export const FUNCTION_NAMING_RULES = `NAMING — every node (root, composite, leaf):
- Use 3–7 words: specific, action-oriented, scannable in the toolbox.
- Name the JOB, not a vague label.
- Good: "Build Full Investment Thesis", "Identify Subject Entity", "Gather Verified Company Facts", "Draft Executive Summary Memo"
- Bad: "thesis", "parse", "research", "draft", "analyze"`;

export const FUNCTION_DESCRIPTION_RULES = `DESCRIPTION — required on EVERY node:
- One crisp sentence: input → output, including deliverable shape when relevant.
- Example: "Turns a company name or rough note into a structured investment thesis ending in a clear recommendation."`;

export const LEAF_PROMPT_RULES = `LEAF PROMPT — required on every leaf; hyper-specific about optimal output.
Each leaf "prompt" MUST include ALL of these labeled sections:

GOAL: [one sentence — what this step achieves for the user]
INPUT: [what material this step receives from the prior step or board]
PROCESS:
1. [concrete, ordered instruction]
2. [concrete instruction — be specific about what to extract, compare, or write]
OUTPUT FORMAT:
[Exact structure — markdown section headers, bullet rules, approximate length, tone, mandatory fields, what to omit]
QUALITY BAR: [what excellent output looks like — specificity, evidence, decisiveness]
CONSTRAINTS: Return ONLY this step's output. No preamble. No process narration. Never refuse sparse input — research and infer responsibly.`;

export const FUNCTION_JSON_SHAPE = `JSON SHAPE:
- Composites: {"name":"...","description":"...","steps":[...]} — NO "prompt" on composites.
- Leaves: {"name":"...","description":"...","prompt":"... (with all sections above)"}
- Optional "research": true on exactly ONE leaf per function (the dedicated web-research step).`;

export const RECOMMENDED_PIPELINE = `RECOMMENDED PIPELINE (use descriptive names — adapt to the function):
1. Identify Subject Entity — extract ENTITY + SEARCH_TERMS from sparse board input
2. Gather Verified Facts — exactly ONE leaf with "research": true; structured fact bullets
3. Analyze Using Framework — apply the function's analytical frame to verified facts
4. Draft Final Deliverable — produce the finished work product per OUTPUT FORMAT`;

export const FUNCTION_ARCHITECT_STANDARDS = `${FUNCTION_NAMING_RULES}

${FUNCTION_DESCRIPTION_RULES}

${LEAF_PROMPT_RULES}

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
