/** Transform primitive grammar — single source of truth for toolbox + highlighter. */

import { scaleEta } from "./eta.js";

/** Legacy phase overhead before ETA_SCALE (resolve / research). */
const PRIMITIVE_RESOLVE_ETA_MS = 18000;
const PRIMITIVE_RESEARCH_ETA_MS = 42000;

export const PRIMITIVE_SYSTEM = `You are a transform engine on a thinking whiteboard. One step. Readable in ~10–20 seconds.

Rules:
- Return ONLY the transformed text — no preamble, labels, section headers, or process narration.
- Stay locked to the input subject.
- When VERIFIED WEB RESEARCH is provided, ground specifics in those facts.
- Be concise unless the transform naturally needs a little more room (expand, differentiate).`;

export const TRANSFORM_PRIMITIVES = [
  {
    id: "op-compress",
    name: "compress",
    kind: "prompt",
    primitive: true,
    pair: "detail",
    inverse: "expand",
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "sparse",
    researchWhen: "sparse",
    description: "Unfold implications and detail",
    prompt:
      "EXPAND — unfold implications, specifics, and context. Use research facts when available. 2–3 short paragraphs max. Return ONLY the expansion.",
    maxTokens: 1400,
    estimatedMs: 18000,
  },
  {
    id: "op-generalize",
    name: "generalize",
    kind: "prompt",
    primitive: true,
    pair: "scope",
    inverse: "ground",
    resolveWhen: "sparse",
    researchWhen: "sparse",
    description: "Lift instance into a class",
    prompt:
      "GENERALIZE — lift this instance into its broader class or pattern. Use research to understand the instance when needed. One paragraph. Return ONLY the generalization.",
    maxTokens: 800,
    estimatedMs: 15000,
  },
  {
    id: "op-specialize",
    name: "specialize",
    kind: "prompt",
    primitive: true,
    pair: "scope",
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "sparse",
    researchWhen: "sparse",
    description: "Concrete lived instance",
    prompt:
      "GROUND — drop into a concrete, lived instance someone can see and feel. Use research facts for real entities. One vivid paragraph. Return ONLY the grounded instance.",
    maxTokens: 1000,
    estimatedMs: 16000,
  },
  {
    id: "op-differentiate",
    name: "differentiate",
    kind: "prompt",
    primitive: true,
    pair: "structure",
    inverse: "merge",
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "sparse",
    researchWhen: "sparse",
    description: "Recast into another domain",
    prompt:
      "TRANSLATE — recast into ONE other domain's vocabulary (pick the domain where the pattern genuinely lives). One paragraph. Return ONLY the translation.",
    maxTokens: 900,
    estimatedMs: 16000,
  },
  {
    id: "op-harmonize",
    name: "harmonize",
    kind: "prompt",
    primitive: true,
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "never",
    researchWhen: "never",
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
    resolveWhen: "never",
    researchWhen: "never",
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

const SPARSE_CHARS = 500;

export function isSparseMaterial(material) {
  return (material || "").trim().length < SPARSE_CHARS;
}

/** Short notes or named entities that benefit from resolve + research before transforming. */
export function looksLikeEntity(material) {
  const t = (material || "").trim();
  if (!t) return false;
  if (/\b(startup|ai|inc|corp|llc|labs|tech|company|platform|app|sdk|api|saas|vc)\b/i.test(t)) return true;
  return t.split(/\s+/).length <= 8;
}

export function isTransformPrimitive(op) {
  if (!op?.primitive) return false;
  if (op.research || op.role) return false;
  if (op.kind === "pipeline") return false;
  return true;
}

/** @deprecated use isTransformPrimitive */
export function isFastPrimitive(op) {
  return isTransformPrimitive(op);
}

export function primitiveNeedsResolve(op, material) {
  if (!isTransformPrimitive(op)) return false;
  if (op.resolveWhen === "never") return false;
  if (op.resolveWhen === "sparse") return isSparseMaterial(material);
  return false;
}

export function primitiveNeedsResearch(op, material) {
  if (!isTransformPrimitive(op)) return false;
  if (op.researchWhen === "never") return false;
  if (op.researchWhen === "sparse") return isSparseMaterial(material) && looksLikeEntity(material);
  if (op.researchWhen === "always") return true;
  return false;
}

export function estimatePrimitiveMs(op, material) {
  let ms = op.estimatedMs || 15000;
  if (primitiveNeedsResolve(op, material)) ms += PRIMITIVE_RESOLVE_ETA_MS;
  if (primitiveNeedsResearch(op, material)) ms += PRIMITIVE_RESEARCH_ETA_MS;
  return scaleEta(ms);
}

/** Merge saved operators with canonical primitive definitions; keep user role/top functions. */
export function migrateOperatorStore(saved) {
  if (!Array.isArray(saved)) return TRANSFORM_PRIMITIVES.map((p) => ({ ...p }));

  const userOps = saved.filter(
    (o) =>
      (o.move && !o.primitive) ||
      (o.top && !o.move) ||
      o.role ||
      (!o.primitive && !o.move && !LEGACY_DEFAULT_NAMES.has(o.name) && !PRIMITIVE_NAMES.has(o.name))
  );

  return [...TRANSFORM_PRIMITIVES.map((p) => ({ ...p })), ...userOps];
}
