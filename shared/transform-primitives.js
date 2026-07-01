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

/**
 * Perceptual moves — the starter set of cognitive transformations.
 * These are ways of seeing, not edits. Great thinkers have recurring moves;
 * these seven are the seed vocabulary users build personal styles from.
 */
export const PERCEPTUAL_MOVES = [
  {
    id: "mv-elevate-overlooked",
    name: "elevate the overlooked",
    kind: "prompt",
    primitive: true,
    move: true,
    resolveWhen: "never",
    researchWhen: "never",
    description: "Find the ignored element and make it central",
    prompt:
      "ELEVATE THE OVERLOOKED — find the element everyone ignores (the background detail, the minor character, the unglamorous part) and re-see the whole with that element as the center of gravity. Name what was overlooked, then show what the whole looks like once it is central. One paragraph. Return ONLY the re-seen whole.",
    maxTokens: 800,
    estimatedMs: 13000,
  },
  {
    id: "mv-hidden-dependency",
    name: "find the hidden dependency",
    kind: "prompt",
    primitive: true,
    move: true,
    resolveWhen: "never",
    researchWhen: "never",
    description: "Expose what this secretly relies on",
    prompt:
      "FIND THE HIDDEN DEPENDENCY — expose the thing this silently relies on to exist or function: the substrate, the maintainer, the assumption, the supply line nobody mentions. Name the dependency precisely, then show how the subject changes once you see it as dependent. One paragraph. Return ONLY the exposed dependency and its consequence.",
    maxTokens: 800,
    estimatedMs: 13000,
  },
  {
    id: "mv-reverse-cause",
    name: "reverse cause and effect",
    kind: "prompt",
    primitive: true,
    move: true,
    resolveWhen: "never",
    researchWhen: "never",
    description: "Swap which is cause and which is effect",
    prompt:
      "REVERSE CAUSE AND EFFECT — take the assumed causal arrow in this and flip it: treat the effect as the cause and the cause as the effect. Take the reversal seriously and show what becomes visible or explicable only under the reversed arrow. One paragraph. Return ONLY the reversed reading.",
    maxTokens: 800,
    estimatedMs: 13000,
  },
  {
    id: "mv-process-organism",
    name: "treat process as organism",
    kind: "prompt",
    primitive: true,
    move: true,
    resolveWhen: "never",
    researchWhen: "never",
    description: "See the process as a living thing",
    prompt:
      "TREAT PROCESS AS ORGANISM — re-see this process, system, or routine as a living organism: it is born, it feeds on something, it grows, it defends itself, it reproduces, it can sicken and die. Identify what it eats, how it defends itself, and what its health or sickness looks like. One paragraph. Return ONLY the organism reading.",
    maxTokens: 850,
    estimatedMs: 13000,
  },
  {
    id: "mv-stewardship",
    name: "search for stewardship",
    kind: "prompt",
    primitive: true,
    move: true,
    resolveWhen: "never",
    researchWhen: "never",
    description: "Ask who tends this, who is entrusted with it",
    prompt:
      "SEARCH FOR STEWARDSHIP — ask of this: who has been entrusted with it, who tends it, who will answer for its condition? Recast the subject from ownership/usage terms into stewardship terms: care, trust, tending, accountability across time. One paragraph. Return ONLY the stewardship reading.",
    maxTokens: 800,
    estimatedMs: 13000,
  },
  {
    id: "mv-collapse-scales",
    name: "collapse scales",
    kind: "prompt",
    primitive: true,
    move: true,
    resolveWhen: "never",
    researchWhen: "never",
    description: "See the same pattern at a much larger or smaller scale",
    prompt:
      "COLLAPSE SCALES — find the scale where this exact pattern repeats: the galaxy in the cell, the city in the ant colony, the family in the ecosystem. Pick ONE other scale (much larger or much smaller), show the correspondence point by point, and let the two scales illuminate each other. One paragraph. Return ONLY the collapsed-scale reading.",
    maxTokens: 850,
    estimatedMs: 13000,
  },
  {
    id: "mv-cultivation",
    name: "translate into cultivation",
    kind: "prompt",
    primitive: true,
    move: true,
    resolveWhen: "never",
    researchWhen: "never",
    description: "Recast as gardening: soil, seasons, pruning, harvest",
    prompt:
      "TRANSLATE INTO CULTIVATION — recast this entirely in the vocabulary of gardening and husbandry: soil, seed, seasons, pruning, grafting, fallow years, harvest. What is the soil here? What season is it in? What needs pruning? What cannot be rushed? One paragraph. Return ONLY the cultivation reading.",
    maxTokens: 850,
    estimatedMs: 13000,
  },
];

TRANSFORM_PRIMITIVES.push(...PERCEPTUAL_MOVES);

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
      o.top ||
      o.role ||
      (!o.primitive && !LEGACY_DEFAULT_NAMES.has(o.name) && !PRIMITIVE_NAMES.has(o.name))
  );

  return [...TRANSFORM_PRIMITIVES.map((p) => ({ ...p })), ...userOps];
}
