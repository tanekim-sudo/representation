/** Transform primitive grammar — single source of truth for toolbox + highlighter. */

export const PRIMITIVE_SYSTEM = `You are a transform engine on a thinking whiteboard. One step. Readable in ~10 seconds.

Rules:
- Return ONLY the transformed text — no preamble, labels, section headers, or process narration.
- Stay locked to the input subject.
- Be concise unless the transform naturally needs a little more room (expand, differentiate).`;

export const TRANSFORM_PRIMITIVES = [
  {
    id: "op-compress",
    name: "compress",
    kind: "prompt",
    primitive: true,
    pair: "detail",
    inverse: "expand",
    description: "Smallest invariant core",
    prompt:
      "COMPRESS to the smallest invariant core — the irreducible essence. One tight paragraph max. Return ONLY the core.",
    maxTokens: 600,
    estimatedMs: 12000,
  },
  {
    id: "op-expand",
    name: "expand",
    kind: "prompt",
    primitive: true,
    pair: "detail",
    inverse: "compress",
    description: "Unfold implications and detail",
    prompt:
      "EXPAND — unfold implications, specifics, and context. 2–3 short paragraphs max. Return ONLY the expansion.",
    maxTokens: 1200,
    estimatedMs: 15000,
  },
  {
    id: "op-generalize",
    name: "generalize",
    kind: "prompt",
    primitive: true,
    pair: "scope",
    inverse: "ground",
    description: "Lift instance into a class",
    prompt:
      "GENERALIZE — lift this instance into its broader class or pattern. One paragraph. Return ONLY the generalization.",
    maxTokens: 700,
    estimatedMs: 12000,
  },
  {
    id: "op-specialize",
    name: "specialize",
    kind: "prompt",
    primitive: true,
    pair: "scope",
    description: "Narrow to a sub-category",
    prompt:
      "SPECIALIZE — narrow to a specific sub-category (still abstract, not yet concrete). One paragraph. Return ONLY the specialized form.",
    maxTokens: 700,
    estimatedMs: 12000,
  },
  {
    id: "op-ground",
    name: "ground",
    kind: "prompt",
    primitive: true,
    pair: "scope",
    inverse: "generalize",
    description: "Concrete lived instance",
    prompt:
      "GROUND — drop into a concrete, lived instance someone can see and feel. One vivid paragraph. Return ONLY the grounded instance.",
    maxTokens: 900,
    estimatedMs: 14000,
  },
  {
    id: "op-differentiate",
    name: "differentiate",
    kind: "prompt",
    primitive: true,
    pair: "structure",
    inverse: "merge",
    multi: true,
    description: "Split into distinguished parts",
    prompt:
      "DIFFERENTIATE — split into 2–5 clearly distinguished parts. Separate each part with a blank line. No numbering or labels. Return ONLY the parts.",
    maxTokens: 1200,
    estimatedMs: 16000,
  },
  {
    id: "op-merge",
    name: "merge",
    kind: "prompt",
    primitive: true,
    pair: "structure",
    inverse: "differentiate",
    needsSelection: 2,
    description: "Fuse into one",
    prompt:
      "MERGE — fuse all material into one unified object. Preserve the essence of each part. Return ONLY the merged result.",
    maxTokens: 1000,
    estimatedMs: 14000,
  },
  {
    id: "op-amplify",
    name: "amplify",
    kind: "prompt",
    primitive: true,
    pair: "magnitude",
    inverse: "reduce",
    description: "Turn intensity or scale up",
    prompt:
      "AMPLIFY — turn up intensity, stakes, or scale. Same idea, bigger. One paragraph. Return ONLY the amplified version.",
    maxTokens: 700,
    estimatedMs: 12000,
  },
  {
    id: "op-reduce",
    name: "reduce",
    kind: "prompt",
    primitive: true,
    pair: "magnitude",
    inverse: "amplify",
    description: "Turn intensity or scale down",
    prompt:
      "REDUCE — turn down intensity, stakes, or scale. Same idea, quieter or smaller. One paragraph. Return ONLY the reduced version.",
    maxTokens: 700,
    estimatedMs: 12000,
  },
  {
    id: "op-invert",
    name: "invert",
    kind: "prompt",
    primitive: true,
    description: "Flip polarity or assumption",
    prompt:
      "INVERT — flip the load-bearing polarity, direction, or assumption. If relational, reciprocate (one-way → mutual). One paragraph. Return ONLY the inversion.",
    maxTokens: 700,
    estimatedMs: 12000,
  },
  {
    id: "op-reframe",
    name: "reframe",
    kind: "prompt",
    primitive: true,
    description: "Move the vantage point",
    prompt:
      "REFRAME — hold the content fixed, change the vantage point it's seen from. One paragraph. Return ONLY the reframing.",
    maxTokens: 800,
    estimatedMs: 12000,
  },
  {
    id: "op-translate",
    name: "translate",
    kind: "prompt",
    primitive: true,
    description: "Recast into another domain",
    prompt:
      "TRANSLATE — recast into ONE other domain's vocabulary (pick the domain where the pattern genuinely lives). One paragraph. Return ONLY the translation.",
    maxTokens: 900,
    estimatedMs: 14000,
  },
  {
    id: "op-harmonize",
    name: "harmonize",
    kind: "prompt",
    primitive: true,
    description: "Resonance without fusion",
    prompt:
      "HARMONIZE — bring distinct elements into resonance without fusing them. One paragraph. Return ONLY the harmonized view.",
    maxTokens: 800,
    estimatedMs: 13000,
  },
  {
    id: "op-release",
    name: "release",
    kind: "prompt",
    primitive: true,
    description: "Drop one element",
    prompt:
      "RELEASE — drop one load-bearing element or constraint; keep the rest intact. One paragraph. Return ONLY what's left.",
    maxTokens: 800,
    estimatedMs: 13000,
  },
  {
    id: "op-transcend",
    name: "transcend",
    kind: "prompt",
    primitive: true,
    description: "Ascend past a tension",
    prompt:
      "TRANSCEND — resolve the central tension by ascending to a frame where the opposition dissolves. One paragraph. Return ONLY the transcendent view.",
    maxTokens: 900,
    estimatedMs: 14000,
  },
];

export const PRIMITIVE_NAMES = new Set(TRANSFORM_PRIMITIVES.map((p) => p.name));

const LEGACY_DEFAULT_NAMES = new Set([
  "combine",
  "split",
  "sharpen",
  "expand",
  "counter",
  "simplify",
]);

export function isFastPrimitive(op) {
  if (!op?.primitive) return false;
  if (op.research || op.role) return false;
  if (op.kind === "pipeline") return false;
  return true;
}

/** Merge saved operators with canonical primitive definitions; keep user role/top functions. */
export function migrateOperatorStore(saved) {
  if (!Array.isArray(saved)) return TRANSFORM_PRIMITIVES.map((p) => ({ ...p }));

  const userOps = saved.filter(
    (o) =>
      o.top ||
      o.role ||
      (!o.primitive && !LEGACY_DEFAULT_NAMES.has(o.name) && !PRIMITIVE_NAMES.has(o.name))
  );

  return [...TRANSFORM_PRIMITIVES.map((p) => ({ ...p })), ...userOps];
}
