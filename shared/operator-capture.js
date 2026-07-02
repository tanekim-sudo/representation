/** Portable operator abstraction — move refs + structure, not source text bleed. */

import { TRANSFORM_PRIMITIVES, PRIMITIVE_NAMES } from "./transform-primitives.js";

/** Compact move ID for capture, lenses, and recombination. */
export function moveRefFromOp(op) {
  if (!op) return null;
  if (op.primitive) return { kind: "primitive", id: op.id, name: op.name };
  if (op.move) return { kind: "move", id: op.id, name: op.name };
  return { kind: "function", id: op.id, name: op.name };
}

/** Provenance stamped on spawned nodes — enough to distill without copying text. */
export function viaFromOp(op, sourceIds = []) {
  const parentCount = sourceIds?.length || 1;
  const merge =
    parentCount > 1 || op?.needsSelection >= 2 || op?.name === "merge";
  return {
    opId: op.id,
    name: op.name,
    moveRef: moveRefFromOp(op),
    inputShape: merge ? "merge" : "single",
    parentCount,
  };
}

function canonicalPrimitive(name) {
  return TRANSFORM_PRIMITIVES.find((p) => p.name === name) || null;
}

/** Resolve a moveRef to the live operator definition (canonical primitives win). */
export function resolveMoveRef(ref, operators = []) {
  if (!ref) return null;
  const byId = ref.id ? operators.find((o) => o.id === ref.id) : null;
  const byName = operators.find((o) => o.name === ref.name);

  if (ref.kind === "primitive" || PRIMITIVE_NAMES.has(ref.name)) {
    const canon = canonicalPrimitive(ref.name);
    if (canon) return { ...canon, ...(byId || byName || {}) };
  }

  const hit = byId || byName;
  if (hit) return hit;

  if (ref.kind === "primitive") {
    const canon = canonicalPrimitive(ref.name);
    if (canon) return { ...canon };
  }

  return null;
}

/** One abstract pipeline step from a via record — no source-node text. */
export function abstractStepFromVia(via, opMap, operators) {
  const ref =
    via.moveRef ||
    (via.opId
      ? { kind: "function", id: via.opId, name: via.name }
      : { kind: "unknown", name: via.name });

  const resolved =
    resolveMoveRef(ref, operators) ||
    (via.opId && opMap[via.opId]) ||
    operators.find((o) => o.name === via.name);

  if (resolved?.kind === "pipeline" && resolved.steps?.length) {
    return {
      name: resolved.name,
      description: (resolved.description || "").trim() || `${resolved.name} pipeline`,
      moveRef: ref,
      steps: resolved.steps
        .map((sid) => opToAbstractTree(opMap[sid], opMap, operators))
        .filter(Boolean),
    };
  }

  const name = resolved?.name || ref.name || "move";
  const description =
    (resolved?.description || "").trim() ||
    (ref.kind === "move" ? `Perceptual move: ${name}` : `Apply ${name}`);

  return {
    name,
    description,
    moveRef: ref,
    ...(resolved?.research ? { research: true } : {}),
  };
}

/** JSON tree with moveRef stubs instead of copied prompts (primitives + moves). */
export function opToAbstractTree(op, opMap, operators = []) {
  if (!op) return null;
  const base = {
    name: op.name || "function",
    description: (op.description || "").trim(),
  };

  if (op.kind === "pipeline" && op.steps?.length) {
    return {
      ...base,
      steps: op.steps.map((id) => opToAbstractTree(opMap[id], opMap, operators)).filter(Boolean),
    };
  }

  const ref = moveRefFromOp(op);
  const reusable = op.primitive || op.move || op.captured;
  if (reusable && ref) {
    return { ...base, moveRef: ref };
  }

  return { ...base, prompt: (op.prompt || "").trim() };
}

/** Structural metadata for a captured thread — portable across targets. */
export function buildCaptureMetadata(journey, vias, allItems) {
  const moveChain = vias.map(
    (v) => v.moveRef || { id: v.opId, name: v.name, kind: v.opId ? "function" : "unknown" }
  );
  const shapes = vias.map((v) => v.inputShape || "single");
  const convergences = (journey?.steps || [])
    .filter((s) => (s.itemIds?.length || 0) > 1)
    .map((s) => ({
      focusId: s.focusId,
      parentCount: s.itemIds.length - 1,
    }));

  let terminalShape = "single";
  const terminal = allItems?.find((it) => it.id === journey?.nodeId);
  if (terminal) {
    const parents = (terminal.bornFrom || []).filter(Boolean).length;
    if (parents > 1) terminalShape = "merge";
  }

  return {
    provenance: "thread-capture",
    moveChain,
    inputShapes: shapes,
    terminalShape,
    stepCount: vias.length,
    convergences,
  };
}

function hydrateLeaf(op, operators) {
  if (!op || op.kind === "pipeline") return op;
  if ((op.prompt || "").trim()) return op;

  const ref = op.moveRef;
  if (!ref) return op;

  const resolved = resolveMoveRef(ref, operators);
  if (!resolved) {
    return {
      ...op,
      prompt: `${ref.name}.`,
      resolveWhen: "never",
      researchWhen: "never",
    };
  }

  return {
    ...op,
    prompt: (resolved.prompt || `${resolved.name}.`).trim(),
    primitive: resolved.primitive,
    move: resolved.move,
    maxTokens: resolved.maxTokens,
    estimatedMs: resolved.estimatedMs,
    multi: resolved.multi,
    resolveWhen: resolved.resolveWhen,
    researchWhen: resolved.researchWhen,
    needsSelection: resolved.needsSelection,
  };
}

/** Hydrate moveRef-only ops before execution — uses target material, not capture-time text. */
export function hydrateOperatorMap(opMap, operators, rootId) {
  const next = { ...opMap };
  const ids = collectSubtreeIds(rootId, next);
  for (const id of ids) {
    const op = next[id];
    if (!op) continue;
    if (op.kind === "pipeline") continue;
    next[id] = hydrateLeaf(op, operators);
  }
  return next;
}

function collectSubtreeIds(rootId, opMap) {
  const ids = new Set();
  function walk(id) {
    if (!id || ids.has(id)) return;
    ids.add(id);
    const op = opMap[id];
    if (op?.kind === "pipeline" && op.steps) op.steps.forEach(walk);
  }
  walk(rootId);
  return ids;
}
