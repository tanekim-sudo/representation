import { runPrompt } from "./claude.js";

const RESEARCH_SYSTEM = `You are a research analyst with live web search. You MUST use the web_search tool — never guess or rely on memory alone.

RULES:
1. ALWAYS search before answering. Run at least 3 searches with different queries.
2. For company names like "bobyard ai startup", identify the real entity (e.g. Bobyard / Bobyard Inc.) then search: company name, funding, product, founders.
3. Prefer primary sources: company website, press releases, Crunchbase, LinkedIn, TechCrunch, BusinessWire.
4. Return structured findings with facts and source URLs. Never say you cannot find information without searching first.
5. If the input is sparse, treat every word as a potential company/product name and search it.`;

function guessSearchName(raw) {
  const s = (raw || "").trim();
  if (!s) return "";
  // "bobyard ai startup" → "Bobyard"
  const words = s.split(/\s+/).filter((w) => !/^(ai|startup|company|inc|corp|llc|labs|tech|the|a|an)$/i.test(w));
  if (!words.length) return s;
  const primary = words[0];
  return primary.charAt(0).toUpperCase() + primary.slice(1).toLowerCase();
}

export function buildResearchQueries(raw) {
  const name = guessSearchName(raw);
  const full = (raw || "").trim();
  return [
    `"${name}" startup`,
    `"${name}" AI company funding`,
    `${name} construction takeoff`,
    full.length > name.length ? `"${full}"` : `${name} Series A investors`,
  ].filter((q, i, arr) => arr.indexOf(q) === i);
}

const RESEARCH_PROMPT = (raw, queries) => `Research this whiteboard subject using web search. Find everything publicly known about this entity.

SUBJECT INPUT:
"""
${raw}
"""

LIKELY ENTITY NAME: ${guessSearchName(raw)}

Run web searches including these queries (adapt as needed):
${queries.map((q) => `- ${q}`).join("\n")}

Return ONLY this structure (fill every section with facts from search results):

ENTITY: [official company/entity name]
WEBSITE: [url]
ONE_LINE: [what they do in one sentence]
PRODUCT: [product/service details]
MARKET: [market, customers, trades/industry]
TRACTION: [metrics, customers, growth signals if found]
FUNDING: [rounds, amounts, dates, lead investors]
TEAM: [founders, CEO, key hires]
COMPETITORS: [named competitors if found]
RECENT_NEWS: [latest news items with dates]
SOURCES:
- [url 1]
- [url 2]
(list all URLs you used)`;

export function injectResearchIntoMaterial(originalMaterial, researchText) {
  const orig = (originalMaterial || "").trim();
  const findings = (researchText || "").trim();
  if (!findings) return orig;
  return `VERIFIED WEB RESEARCH (use these facts — subject is locked to original input):
"""
${findings}
"""

ORIGINAL SUBJECT (the user wrote this on their whiteboard — all deliverables are ABOUT this):
"""
${orig}
"""`;
}

export async function conductSubjectResearch(originalMaterial) {
  const raw = (originalMaterial || "").trim();
  if (!raw) return "";

  const queries = buildResearchQueries(raw);
  const { outputs } = await runPrompt({
    prompt: RESEARCH_PROMPT(raw, queries),
    text: raw,
    system: RESEARCH_SYSTEM,
    maxTokens: 8192,
    research: true,
    forceSearch: true,
  });

  return (outputs[0] || "").trim();
}
