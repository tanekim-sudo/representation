/**
 * Curated function trees for common roles — no resolve-only junk on the canvas.
 * Each function: research leaf (optional) + deliverable leaf with real sections.
 */

export const INVESTOR_FUNCTION_TREES = [
  {
    name: "Build Investment Thesis",
    description: "Company name or note → full thesis ending in a clear recommendation.",
    steps: [
      {
        name: "Gather Verified Company Facts",
        description: "Web research on the subject entity.",
        research: true,
        prompt:
          "Research the subject entity. Return concise bullets: overview, product, market, funding, team, traction, key risks.",
      },
      {
        name: "Draft Investment Thesis",
        description: "Structured thesis deliverable.",
        prompt:
          "Write a complete investment thesis using research. Sections: ## Thesis, ## Market, ## Product, ## Traction, ## Team, ## Key Risks, ## Upside Scenario, ## Recommendation. Specific and decisive.",
      },
    ],
  },
  {
    name: "Map Comparable Companies",
    description: "Subject → comp landscape with positioning and metrics.",
    steps: [
      {
        name: "Research Subject and Comps",
        description: "Find entity and 5–8 comparable companies.",
        research: true,
        prompt:
          "Research the subject and comparable companies in the same sector. Bullet facts: name, positioning, stage, metrics where available.",
      },
      {
        name: "Deliver Comp Analysis",
        description: "Structured comp map.",
        prompt:
          "Output ## Overview, ## Comparable Companies (markdown table: company, positioning, stage, notes), ## Key Takeaways for the subject.",
      },
    ],
  },
  {
    name: "Write IC Investment Memo",
    description: "Sparse input → investment committee memo with recommendation.",
    steps: [
      {
        name: "Research Deal and Market",
        description: "Gather facts for the memo.",
        research: true,
        prompt: "Research the subject for an IC memo: business, market, traction, team, funding, risks.",
      },
      {
        name: "Draft IC Memo",
        description: "Executive memo deliverable.",
        prompt:
          "Write an IC memo: ## Executive Summary, ## Investment Highlights, ## Business Overview, ## Market, ## Risks, ## Recommendation.",
      },
    ],
  },
  {
    name: "Screen Deal Flow Item",
    description: "Quick screen: fit, risks, and pass/invest/learn more.",
    steps: [
      {
        name: "Research Opportunity",
        description: "Fast factual scan.",
        research: true,
        prompt: "Quick research: what they do, stage, traction signals, team, red flags.",
      },
      {
        name: "Deliver Screen Verdict",
        description: "One-page screen output.",
        prompt:
          "Output ## Snapshot, ## Why It Could Work, ## Key Risks, ## Open Questions, ## Verdict (Pass / Learn More / Pursue) with one-line rationale.",
      },
    ],
  },
  {
    name: "Stress Test an Investment Case",
    description: "Challenge assumptions and surface failure modes.",
    steps: [
      {
        name: "Research Assumptions",
        description: "Ground the stress test in facts.",
        research: true,
        prompt: "Research the subject. List load-bearing assumptions an investor would make.",
      },
      {
        name: "Deliver Stress Test",
        description: "Structured downside analysis.",
        prompt:
          "Output ## Core Thesis, ## Load-Bearing Assumptions, ## What Breaks First, ## Downside Scenario, ## Mitigants / Missing Data.",
      },
    ],
  },
];

const ROLE_PATTERNS = [
  { id: "investor", re: /private equity|\bpe\b|venture|vc\b|investor|investment analyst|deal team/i, trees: INVESTOR_FUNCTION_TREES },
];

export function matchRoleTemplate(role) {
  const r = (role || "").trim();
  if (!r) return null;
  for (const p of ROLE_PATTERNS) {
    if (p.re.test(r)) return { id: p.id, trees: p.trees };
  }
  return null;
}

/** Drop user-facing functions that are really internal resolve steps. */
export function isResolveOnlyFunction(op, opMap) {
  if (!op?.top) return false;
  const name = (op.name || "").toLowerCase();
  if (/^(identify|extract|resolve|parse)\b/.test(name) && /(subject|entity|universe|search)/.test(name)) {
    return true;
  }
  if (op.kind === "pipeline" && op.steps?.length === 1) {
    const leaf = opMap[op.steps[0]];
    if (leaf && !leaf.research && (leaf.prompt || "").match(/\bENTITY:\s/i)) return true;
  }
  return false;
}
