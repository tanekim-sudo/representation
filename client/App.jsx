import React, { useEffect, useMemo, useRef, useState } from "react";
import { jsonrepair } from "jsonrepair";
import {
  TRANSFORM_PRIMITIVES,
  migrateOperatorStore,
  isTransformPrimitive,
  estimatePrimitiveMs,
} from "../shared/transform-primitives.js";
import { scaleEta, ETA } from "../shared/eta.js";
import { phaseClientAbortMs } from "../shared/phase-timeouts.js";
import { FUNCTION_ARCHITECT_STANDARDS } from "../shared/function-standards.js";

const ITEMS_KEY = "lens.board.items.v1";
const CAMERA_KEY = "lens.board.camera.v1";
const OPERATORS_KEY = "lens.board.operators.v2";
const LEGACY_OPERATORS_KEY = "lens.board.operators.v1";
const STRUCTURES_KEY = "lens.structures.v1";
const STRUCTSEQ_KEY = "lens.structseq.v1";
const OLD_NODES_KEY = "lens.savednodes.v1";
const ARTIFACT_KEY = "lens.artifact.v1";
const OLD_SEEDS_KEY = "lens.seeds.v2";
const OP_MIME = "application/lens-op";
const STRUCT_MIME = "application/lens-structure";
const SEL_MIME = "application/lens-selection";
const PATHS_KEY = "lens.paths.v1";
const RAIL_W = 280;
const COMBINE_THRESHOLD = 14; // px moved before drop-on-item triggers combine

const INK = "#20201d";
const PEN_W = 2.4; // world units
const MARKER_W = 16;
const HIGHLIGHT_INK = "#F2D04E";
const HIGHLIGHT_W = 14;

/** Six hex directions for branching — angles from +x axis, counter-clockwise from east; we use standard math angles. */
const EXPAND_DIRS = [
  { id: "n", label: "↑", angle: -Math.PI / 2 },
  { id: "ne", label: "↗", angle: -Math.PI / 6 },
  { id: "se", label: "↘", angle: Math.PI / 6 },
  { id: "s", label: "↓", angle: Math.PI / 2 },
  { id: "sw", label: "↙", angle: 5 * Math.PI / 6 },
  { id: "nw", label: "↖", angle: -5 * Math.PI / 6 },
];
const BRANCH_DIST = 240;

/**
 * Path verbs — the units of shared seeing. A path is not information;
 * it's a reproducible sequence of attention: where to look, how to hold it.
 */
const PATH_VERBS = [
  { id: "notice", label: "notice", glyph: "✦", hint: "Notice this." },
  { id: "attend", label: "attend", glyph: "◉", hint: "Attend here. Stay with it." },
  { id: "compare", label: "compare", glyph: "⇄", hint: "Hold these together. Feel the tension." },
  { id: "linger", label: "linger", glyph: "◷", hint: "Linger here. Don't move on yet." },
  { id: "release", label: "let go", glyph: "⊘", hint: "Let this go. It's not the point." },
  { id: "look", label: "look again", glyph: "↺", hint: "Look again — it changed." },
];

function pathVerb(kind) {
  return PATH_VERBS.find((v) => v.id === kind) || PATH_VERBS[0];
}

function isNoteItem(it) {
  return it && (it.type === "text" || it.type === "image");
}

function noteCenter(it) {
  if (!isNoteItem(it)) return null;
  const bb = itemWorldBBox(it);
  if (!bb) return { x: it.x || 0, y: it.y || 0 };
  return { x: (bb.minx + bb.maxx) / 2, y: (bb.miny + bb.maxy) / 2 };
}

function branchAnchor(it, dirId) {
  const c = noteCenter(it);
  if (!c) return { x: 0, y: 0 };
  const bb = itemWorldBBox(it);
  const dir = EXPAND_DIRS.find((d) => d.id === dirId) || EXPAND_DIRS[0];
  const hw = bb ? (bb.maxx - bb.minx) / 2 : 40;
  const hh = bb ? (bb.maxy - bb.miny) / 2 : 24;
  const pad = 8;
  return {
    x: c.x + Math.cos(dir.angle) * (hw + pad),
    y: c.y + Math.sin(dir.angle) * (hh + pad),
  };
}

function linkEndpoint(it, toward) {
  const c = noteCenter(it);
  if (!c || !toward) return c || { x: 0, y: 0 };
  const bb = itemWorldBBox(it);
  if (!bb) return c;
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (!dx && !dy) return c;
  const angle = Math.atan2(dy, dx);
  const hw = Math.max(20, (bb.maxx - bb.minx) / 2);
  const hh = Math.max(16, (bb.maxy - bb.miny) / 2);
  const denom = Math.sqrt((Math.cos(angle) / hw) ** 2 + (Math.sin(angle) / hh) ** 2) || 1;
  const dist = 1 / denom + 2;
  return { x: c.x + Math.cos(angle) * dist, y: c.y + Math.sin(angle) * dist };
}

function inferLinkDir(from, to) {
  const a = noteCenter(from);
  const b = noteCenter(to);
  if (!a || !b) return EXPAND_DIRS[1].id;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  let best = EXPAND_DIRS[0];
  let bestDiff = Infinity;
  for (const d of EXPAND_DIRS) {
    const diff = Math.abs(Math.atan2(Math.sin(angle - d.angle), Math.cos(angle - d.angle)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = d;
    }
  }
  return best.id;
}

function linkCurvePath(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const bend = Math.min(52, dist * 0.24);
  const cx = (from.x + to.x) / 2 + (-dy / dist) * bend;
  const cy = (from.y + to.y) / 2 + (dx / dist) * bend;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

const TOOL_GROUPS = [
  { id: "think", label: "think" },
  { id: "canvas", label: "canvas" },
  { id: "input", label: "input" },
  { id: "draw", label: "draw" },
  { id: "edit", label: "edit" },
];

const CANVAS_TOOLS = {
  highlight: {
    id: "highlight",
    group: "think",
    label: "Highlighter",
    icon: "▬",
    hint: "Draw over text to transform · scribble to erase · circle to select inside",
    swatch: HIGHLIGHT_INK,
  },
  select: {
    id: "select",
    group: "canvas",
    label: "Select",
    icon: "↖",
    hint: "Double-tap a note to branch · drag a nub to draw an arrow · drag notes to move",
  },
  hand: {
    id: "hand",
    group: "canvas",
    label: "Pan",
    icon: "✋",
    hint: "Drag to move the canvas.",
  },
  text: {
    id: "text",
    group: "input",
    label: "Text",
    icon: "T",
    hint: "Click to place text. Double-click empty space to write quickly.",
  },
  image: {
    id: "image",
    group: "input",
    label: "Image",
    icon: "▢",
    hint: "Pick an image, then click the canvas to place it.",
  },
  pen: {
    id: "pen",
    group: "draw",
    label: "Pen",
    icon: "✎",
    hint: "Precise ink lines.",
    swatch: INK,
  },
  marker: {
    id: "marker",
    group: "draw",
    label: "Marker",
    icon: "▔",
    hint: "Wide translucent strokes.",
    swatch: INK,
    swatchOpacity: 0.35,
  },
  eraser: {
    id: "eraser",
    group: "edit",
    label: "Eraser",
    icon: "⌫",
    hint: "Click or drag over strokes and objects to remove.",
  },
};

const RESEARCH_STEP_PROMPT =
  "Quick web search: find the entity name, product, funding, and team. Use 1–2 searches max. Then continue to analyze and draft the final deliverable in the same response.";

function migrateOperators(ops) {
  if (!Array.isArray(ops)) return ops;
  return ops.map((o) => {
    if (o.name === "research" && (o.kind === "prompt" || !o.kind || o.kind === "pipeline")) {
      const prompt = o.prompt?.toLowerCase().includes("web_search") || o.prompt?.toLowerCase().includes("web search")
        ? o.prompt
        : RESEARCH_STEP_PROMPT;
      return { ...o, research: true, prompt };
    }
    return o;
  });
}

const ONBOARDED_KEY = "lens.onboarded.v1";

const ROLES = [
  "investor",
  "founder",
  "tutor",
  "artist",
  "researcher",
  "writer",
  "designer",
  "therapist",
  "student",
  "strategist",
];

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function extractBalancedJSON(s, open, close) {
  const start = s.indexOf(open);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (inStr) {
      if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

function normalizeJSONText(s) {
  return s
    .replace(/^\uFEFF/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function tryParseJSONCandidate(candidate) {
  const c = normalizeJSONText(candidate.trim());
  if (!c) return null;
  try {
    return JSON.parse(c);
  } catch {
    try {
      return JSON.parse(jsonrepair(c));
    } catch {
      return null;
    }
  }
}

function parseJSON(raw) {
  const text = (raw || "").trim();
  if (!text) throw new Error("Empty AI response. Try again.");

  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const obj = extractBalancedJSON(text, "{", "}");
  if (obj) candidates.push(obj);
  const arr = extractBalancedJSON(text, "[", "]");
  if (arr) candidates.push(arr);
  candidates.push(text);

  const seen = new Set();
  for (const candidate of candidates) {
    const key = candidate.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const parsed = tryParseJSONCandidate(key);
    if (parsed != null) return parsed;
  }

  throw new Error("AI returned invalid JSON. Tap ↻ to rebuild, or try again.");
}

// The master system prompt — teaches Claude how to architect lens functions.
const LENS_SYSTEM = `You are the function-architect for "lens" — an infinite thinking whiteboard where users drag FUNCTIONS onto sparse notes and get professional deliverables.

LENS EXECUTION ARCHITECTURE (design functions for this)
Functions can have infinite nested sub-steps in the UI, but at runtime a PLAN COMPILER flattens them into 1–3 PHASES:

PHASE 1 — RESOLVE: Identify the subject entity from sparse input. Output: ENTITY, SEARCH_TERMS.
PHASE 2 — RESEARCH (if needed): Dedicated web_search pass using SEARCH_TERMS. Mark ONE leaf with "research": true.
PHASE 3 — SYNTHESIZE: ALL remaining steps compiled into one prompt. Uses research findings. Outputs final deliverable.

Design implications:
- Sub-steps are organizational — write leaf prompts as instructions that will be MERGED into the synthesize phase.
- Only ONE "research" leaf per function — it powers the research phase.
- Resolve step: name it descriptively (e.g. "Identify Subject Entity"); prompt must extract ENTITY and SEARCH_TERMS.
- Analyze/draft steps: leaf prompts must specify exact OUTPUT FORMAT — they run in synthesize phase.
- NEVER design functions that refuse, discuss missing data, or meta-comment on the process.

${FUNCTION_ARCHITECT_STANDARDS}

Return ONLY valid JSON.`;

// summarize the user's personal library so Claude can tailor every prompt
function summarizeLibrary(operators, opMap, { compact = false } = {}) {
  if (!operators?.length) return "";
  const tops = operators.filter((o) => o.top);
  const lines = [];

  if (tops.length) {
    lines.push(compact ? "Functions:" : "Top-level functions:");
    for (const t of tops.slice(0, compact ? 10 : 20)) {
      let line = `• ${t.name}${t.description ? ` — ${t.description}` : ""}`;
      if (!compact && t.kind === "pipeline" && t.steps?.length) {
        const subs = t.steps.map((id) => opMap[id]?.name).filter(Boolean);
        if (subs.length) line += `\n  steps: ${subs.join(" → ")}`;
      }
      lines.push(line);
    }
  }

  const leaves = operators.filter((o) => (o.kind === "prompt" || !o.kind) && o.prompt);
  if (leaves.length && !compact) {
    lines.push("\nPrimitive transformation patterns:");
    for (const p of leaves.slice(0, 30)) {
      const snippet = p.prompt.slice(0, 110);
      lines.push(`• "${p.name}": ${snippet}${p.prompt.length > 110 ? "…" : ""}`);
    }
  } else if (leaves.length && compact) {
    lines.push(`Primitives: ${leaves.map((p) => p.name).slice(0, 24).join(", ")}`);
  }

  return lines.join("\n");
}

function librarySystem(operators, opMap) {
  const summary = summarizeLibrary(operators, opMap);
  if (!summary) return LENS_SYSTEM;
  return `${LENS_SYSTEM}

---
THE USER'S PERSONAL LIBRARY — tailor every function, decomposition, and leaf prompt to this library.
• Reuse its vocabulary, tone, and level of specificity.
• Complement what already exists — do not duplicate names or purposes.
• New primitives should feel like they belong alongside the patterns below.
• When editing, preserve consistency with the rest of the library.

${summary}`;
}

function executionSystem(operators, opMap, activeOp, originalMaterial = "", researching = false) {
  const compact = summarizeLibrary(operators, opMap, { compact: true });
  let sys = `You execute a professional workflow on the user's thinking whiteboard. Return ONLY the deliverable — no preamble or meta-commentary.

CRITICAL RULES:
1. ORIGINAL SUBJECT — the user dragged this function onto specific board material. Stay locked to that subject in every sentence.
2. NEVER write about insufficient documentation, information gaps, evaluation process, or meta-risks in deal assessment. Always produce substantive content ABOUT the subject.
3. If input is a company name or short phrase (e.g. "efference ai startup"), treat it as the entity to analyze — use web search to research it and deliver a complete professional output.
4. Follow the OUTPUT FORMAT in the workflow exactly — include every required section with specific, evidence-backed content.
5. Match the function description's deliverable shape precisely — this is the quality bar.`;

  if (researching) {
    sys += `\n\nWEB SEARCH ENABLED: Research the subject thoroughly using current web sources before writing your deliverable. Cite key facts you find.`;
  }
  if (activeOp?.name) {
    sys += `\n\nActive function: "${activeOp.name}"`;
    if (activeOp.description) sys += `\nDeliverable contract: ${activeOp.description}`;
  }
  if (originalMaterial?.trim()) {
    sys += `\n\nORIGINAL BOARD MATERIAL (this is the subject — transform THIS):\n"""${originalMaterial.slice(0, 1500)}${originalMaterial.length > 1500 ? "…" : ""}"""`;
  }
  if (compact) {
    sys += `\n\nUser's function library:\n${compact}`;
  }
  return sys;
}

function boardSystem(operators, opMap) {
  const compact = summarizeLibrary(operators, opMap, { compact: true });
  let sys =
    "You operate on selected material from the user's thinking whiteboard. Return ONLY the requested result. Work with whatever is given — fragments, keywords, rough notes. NEVER refuse, NEVER say insufficient data, NEVER ask for more information.";
  if (compact) {
    sys += `\n\nThis user's personal library of functions and transformations — align your output with their established patterns:\n${compact}`;
  }
  return sys;
}

// role/profession -> the most valuable cognitive functions to automate
async function generateFunctionList(role, operators, opMap) {
  const hasLib = operators?.length > 0;
  const prompt = `The user is a: ${role}.

Design the 10 most valuable FUNCTIONS for their lens whiteboard. Each function must work on SPARSE input (a company name, one-line note) and produce a FULL professional deliverable using web research.

${hasLib ? "Complement existing library — no duplicate names or purposes.\n" : ""}
For each function:
- "name": 3–7 words — specific and descriptive (e.g. "Build Full Investment Thesis", "Write IC Investment Memo", "Map Comparable Companies")
- "description": one sentence stating input → exact deliverable shape (sections, format, decision output)

Investor examples:
- "Build Full Investment Thesis" → structured thesis with Thesis, Market, Product, Traction, Team, Risks, Upside, Recommendation
- "Write IC Investment Memo" → executive summary, highlights, business overview, risks, recommendation
- "Map Comparable Companies" → table of comps with positioning and metrics

Return ONLY JSON: {"functions":[{"name":"...","description":"..."}]} — exactly 10, ordered by frequency. No markdown, no commentary outside the JSON object.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 2000 });
  const j = parseJSON(out);
  if (Array.isArray(j.functions) && j.functions.length) return j.functions.slice(0, 10);
  if (Array.isArray(j) && j.length) return j.slice(0, 10);
  return [];
}

// decompose one function into a deep tree of sub-functions ending in primitives
async function decomposeFunction(role, fn, operators, opMap) {
  const prompt = `The user is a: ${role}.

Decompose this function for lens's 3-phase runtime: resolve → research → synthesize.
Apply the FUNCTION ARCHITECT STANDARDS from system context to every node.

FUNCTION: ${fn.name}
${fn.description ? `Description: ${fn.description}` : ""}

Pipeline (use these descriptive step names — adapt to the function):
1. Identify Subject Entity — extract ENTITY + SEARCH_TERMS from sparse input like "bobyard ai startup"
2. Gather Verified Facts — exactly ONE leaf with "research": true; hyper-specific prompt with OUTPUT FORMAT for fact bullets
3. Analyze Using Framework — apply the function's analytical frame; leaf prompt must specify exact sections to produce
4. Draft Final Deliverable — compile the finished work product; leaf prompt must specify exact OUTPUT FORMAT (all sections, tone, length)

For investment thesis functions, final OUTPUT FORMAT must include: ## Thesis, ## Market, ## Product, ## Traction, ## Team, ## Key Risks, ## Upside Scenario, ## Recommendation

Every leaf prompt must include GOAL, INPUT, PROCESS, OUTPUT FORMAT, QUALITY BAR, CONSTRAINTS sections.

Return ONLY JSON:
{"name":"...","description":"...","steps":[{"name":"Identify Subject Entity","description":"...","prompt":"..."},{"name":"Gather Verified Facts","research":true,"description":"...","prompt":"..."},...]}

Escape quotes and newlines inside all string values. No markdown fences.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 8000 });
  try {
    return parseJSON(out);
  } catch {
    const retry = await runClaude(
      `${prompt}\n\nYour previous reply was not valid JSON. Return ONLY a single minified JSON object. Escape all quotes inside strings with backslash.`,
      "",
      { system: librarySystem(operators, opMap), maxTokens: 8000 }
    );
    return parseJSON(retry);
  }
}

// fallback leaf prompt when Claude omits one — still follows standards
function buildDefaultLeafPrompt(name, description) {
  const desc = (description || "").trim() || `Complete the "${name}" step on the subject material.`;
  return `GOAL: ${desc}
INPUT: Prior step output or whiteboard material about the subject.
PROCESS:
1. Read the input carefully and stay locked to the subject entity.
2. Execute "${name}" with professional specificity — use verified facts when available.
OUTPUT FORMAT:
Return the finished result for this step only. Match the deliverable shape implied by: ${desc}
QUALITY BAR: Specific, decisive, expert-grade — no vague generalities.
CONSTRAINTS: Return ONLY the step output. No preamble. No meta-commentary. Never refuse sparse input.`;
}

// flatten a decomposition tree into flat operators; returns the root id
function materializeTree(node, role, top, out) {
  const id = uid();
  const name = (node.name || "function").trim();
  const description = (node.description || "").trim();
  if (Array.isArray(node.steps) && node.steps.length) {
    const steps = node.steps.map((s) => materializeTree(s, role, false, out));
    out.push({ id, name, description, kind: "pipeline", steps, role, top });
  } else {
    const prompt = (node.prompt || "").trim() || buildDefaultLeafPrompt(name, description);
    const research = !!node.research;
    out.push({ id, name, description, kind: "prompt", prompt, role, top, research });
  }
  return id;
}

function opTreeNeedsResearch(op, opMap) {
  if (!op) return false;
  if (op.research) return true;
  if (op.kind === "pipeline" && op.steps?.length) {
    return op.steps.some((sid) => opTreeNeedsResearch(opMap[sid], opMap));
  }
  return false;
}

function shouldEnableResearch(op, opMap, originalMaterial) {
  if (isTransformPrimitive(op)) return false; // plan compiler handles primitive research
  if (opTreeNeedsResearch(op, opMap)) return true;
  const sparse = (originalMaterial || "").trim().length < 500;
  const named = /\b(startup|ai|inc|corp|llc|labs|tech|company|platform|app)\b/i.test(originalMaterial || "");
  if (sparse && (op?.role || named)) return true;
  return false;
}

function formatPipelineInput(originalMaterial, currentMaterial) {
  const orig = (originalMaterial || "").trim();
  const cur = (currentMaterial || "").trim();
  if (!orig || orig === cur) return cur;
  return `ORIGINAL SUBJECT (never lose track of this — all work is about THIS):\n"""\n${orig}\n"""\n\nPRIOR STEP OUTPUT:\n"""\n${cur}\n"""`;
}

// human-readable tree for Claude context when editing in prose
function serializeTree(node, opMap, depth = 0) {
  if (!node) return "";
  const pad = "  ".repeat(depth);
  let line = `${pad}• ${node.name}`;
  if (node.description) line += ` — ${node.description}`;
  if (node.kind === "prompt" && node.prompt) {
    line += `\n${pad}  prompt: ${node.prompt.slice(0, 220)}${node.prompt.length > 220 ? "…" : ""}`;
  }
  const lines = [line];
  if (node.kind === "pipeline" && node.steps?.length) {
    for (const sid of node.steps) lines.push(serializeTree(opMap[sid], opMap, depth + 1));
  }
  return lines.filter(Boolean).join("\n");
}

function opToJsonTree(op, opMap) {
  if (!op) return null;
  const base = { name: op.name || "function", description: op.description || "" };
  if (op.kind === "pipeline" && op.steps?.length) {
    return {
      ...base,
      steps: op.steps.map((id) => opToJsonTree(opMap[id], opMap)).filter(Boolean),
    };
  }
  return { ...base, prompt: op.prompt || "" };
}

function collectDraftOps(rootOp, opMap) {
  if (!rootOp) return [];
  const ids = collectSubtreeIds(rootOp.id, opMap);
  return [...ids].map((id) => ({ ...opMap[id] }));
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

// create a full function from the user's plain-English description
async function createFunctionFromProse(description, operators, opMap) {
  const prompt = `The user wants to CREATE a new function for their lens whiteboard toolbox.
Tailor it to their personal library (see system context) — complement existing functions, reuse their vocabulary and prompt style.
Apply FUNCTION ARCHITECT STANDARDS from system context to EVERY node.

They described it in their own words:
"""
${description}
"""

Design a complete function tree: ordered sub-functions ending in leaves with hyper-specific prompts (pipeline where each step's output feeds the next).

Requirements:
- Root name: 3–7 words, descriptive. Root description: input → deliverable shape.
- Break into 2–5 ordered sub-functions with descriptive names and descriptions at every level.
- Recurse 2–4 layers until every leaf is one atomic step with a full prompt (GOAL, INPUT, PROCESS, OUTPUT FORMAT, QUALITY BAR, CONSTRAINTS).
- Composites have "steps" and NO "prompt". Leaves have hyper-specific "prompt" only.
- Do not duplicate functions already in their library unless the user explicitly asks to recreate one.

Return ONLY JSON:
{"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}

Escape quotes and newlines inside strings. No markdown fences.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 8000 });
  try {
    return parseJSON(out);
  } catch {
    const retry = await runClaude(
      `${prompt}\n\nPrevious reply was invalid JSON. Return ONLY one minified JSON object.`,
      "",
      { system: librarySystem(operators, opMap), maxTokens: 8000 }
    );
    return parseJSON(retry);
  }
}

// edit an existing function tree from the user's prose instruction
async function editFunctionWithProse(op, opMap, instruction, operators) {
  const current = serializeTree(op, opMap);
  const prompt = `The user is EDITING an existing function on their lens whiteboard.
Keep it consistent with their personal library (see system context) — same vocabulary, style, and transformation patterns.
Apply FUNCTION ARCHITECT STANDARDS from system context to EVERY node you touch or add.

CURRENT FUNCTION (tree — composites have steps, leaves have prompts):
${current}

The user wants these changes (in their own words):
"""
${instruction}
"""

Apply their request. Preserve anything they didn't ask to change. You may rename, re-describe, re-prompt, reorder, add, remove, or split steps.
- Every name: 3–7 words, descriptive.
- Every node: required description (input → output).
- Every leaf: hyper-specific prompt with GOAL, INPUT, PROCESS, OUTPUT FORMAT, QUALITY BAR, CONSTRAINTS.

Return ONLY JSON for the COMPLETE updated function (same shape as create):
{"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}

If this should become a single leaf with no sub-steps, return:
{"name":"...","description":"...","prompt":"..."}

Escape quotes and newlines inside strings. No markdown fences.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 8000 });
  try {
    return parseJSON(out);
  } catch {
    const retry = await runClaude(
      `${prompt}\n\nPrevious reply was invalid JSON. Return ONLY one minified JSON object.`,
      "",
      { system: librarySystem(operators, opMap), maxTokens: 8000 }
    );
    return parseJSON(retry);
  }
}

// turn a Claude JSON node into flat operators; returns root id
function treeToOperators(node, opts = {}) {
  const { role = null, top = false } = opts;
  const out = [];
  const rootId = materializeTree(node, role, top, out);
  return { rootId, ops: out };
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function stripMd(s) {
  return (s || "")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/[*_`>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .trim();
}

function normalizeItem(it) {
  if (!it) return it;
  if (it.type === "link") {
    return { id: it.id, type: "link", fromId: it.fromId, toId: it.toId, fromDir: it.fromDir || null };
  }
  const base = { rotation: 0, scale: 1, ...it };
  if (base.type === "text" && !base.w) base.w = 360;
  if (base.type === "image" && !base.h && base.w) base.h = Math.round(base.w * 0.75);
  return base;
}

function migrateFromArtifact() {
  const art = load(ARTIFACT_KEY, null);
  if (!art) return [];
  const items = [];
  let y = 0;
  if (art.text?.trim()) {
    items.push({ id: uid(), type: "text", x: 0, y, text: art.text.trim(), w: 420, rotation: 0, scale: 1 });
    y += 120;
  }
  for (const obj of art.objects || []) {
    if (obj.kind === "text" && obj.content?.trim()) {
      items.push({ id: uid(), type: "text", x: 0, y, text: obj.content.trim(), w: 360, rotation: 0, scale: 1 });
      y += 80;
    } else if (obj.kind === "image" && obj.src) {
      items.push({ id: uid(), type: "image", x: 0, y, w: obj.w || 220, h: Math.round((obj.w || 220) * 0.75), src: obj.src, rotation: 0, scale: 1 });
      y += (obj.w || 220) + 40;
    }
  }
  return items;
}

function itemWorldBBox(it) {
  if (it.type === "stroke") {
    if (!it.points?.length) return null;
    const xs = it.points.map((p) => p.x);
    const ys = it.points.map((p) => p.y);
    return { minx: Math.min(...xs), miny: Math.min(...ys), maxx: Math.max(...xs), maxy: Math.max(...ys) };
  }
  if (it.type === "image") {
    const w = it.w || 200;
    const h = it.h || Math.round(w * 0.75);
    return { minx: it.x, miny: it.y, maxx: it.x + w, maxy: it.y + h };
  }
  if (it.type === "text") {
    const w = it.w || 360;
    const h = itemHeight(it);
    return { minx: it.x, miny: it.y, maxx: it.x + w, maxy: it.y + h };
  }
  return null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// rasterize strokes + images in a selection for Claude vision
async function compositeItemsToImage(items) {
  const visuals = items.filter((it) => it.type === "stroke" || it.type === "image");
  if (!visuals.length) return null;

  const boxes = visuals.map(itemWorldBBox).filter(Boolean);
  if (!boxes.length) return null;

  const pad = 24;
  const minx = Math.min(...boxes.map((b) => b.minx)) - pad;
  const miny = Math.min(...boxes.map((b) => b.miny)) - pad;
  const maxx = Math.max(...boxes.map((b) => b.maxx)) + pad;
  const maxy = Math.max(...boxes.map((b) => b.maxy)) + pad;
  const w = Math.max(64, Math.ceil(maxx - minx));
  const h = Math.max(64, Math.ceil(maxy - miny));

  const canvas = document.createElement("canvas");
  canvas.width = Math.min(w * 2, 2048);
  canvas.height = Math.min(h * 2, 2048);
  const scale = canvas.width / w;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f1e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-minx, -miny);

  for (const it of visuals) {
    if (it.type === "stroke" && it.points?.length > 1) {
      ctx.beginPath();
      ctx.moveTo(it.points[0].x, it.points[0].y);
      for (let i = 1; i < it.points.length; i++) ctx.lineTo(it.points[i].x, it.points[i].y);
      ctx.strokeStyle = it.highlight ? HIGHLIGHT_INK : it.color || INK;
      ctx.lineWidth = it.width || PEN_W;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalAlpha = it.highlight ? 0.72 : it.marker ? 0.35 : 0.95;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (it.type === "image" && it.src) {
      try {
        const img = await loadImage(it.src);
        ctx.drawImage(img, it.x, it.y, it.w || img.width, it.h || img.height);
      } catch {
        /* skip broken image */
      }
    }
  }

  return canvas.toDataURL("image/jpeg", 0.88);
}

// gather all material from board items (text + vision for images/drawings)
async function gatherMaterialFromItems(itemList) {
  const texts = itemList
    .filter((it) => it.type === "text" && it.text?.trim())
    .map((it) => it.text.trim());
  const text = texts.length > 1 ? texts.map((t, i) => `[part ${i + 1}]\n${t}`).join("\n\n———\n\n") : texts.join("\n\n———\n\n");

  const images = itemList.filter((it) => it.type === "image" && it.src);
  const strokes = itemList.filter((it) => it.type === "stroke");
  let image = null;

  if (images.length === 1 && !strokes.length) {
    image = images[0].src;
  } else if (images.length || strokes.length) {
    image = await compositeItemsToImage(itemList);
  }

  if (!text && image && strokes.length && !images.length) {
    return { text: "[hand-drawn sketch on the whiteboard — interpret the attached image]", image, preview: "sketch" };
  }
  if (!text && image) {
    return { text: "[image on the whiteboard — interpret the attached image]", image, preview: "image" };
  }

  const preview = text.slice(0, 1200) || (image ? "visual material" : "");
  return { text, image, preview };
}

function itemWidth(it) {
  if (it.type === "image") return it.w || 200;
  if (it.type === "text") return it.w || 360;
  return 0;
}

function itemHeight(it) {
  if (it.type === "image") return it.h || Math.round((it.w || 200) * 0.75);
  if (it.type === "text") {
    const lines = Math.max(1, (it.text || "").split("\n").length);
    const chars = (it.text || "").length;
    return Math.max(28, lines * 26 + Math.floor(chars / 42) * 26);
  }
  return 0;
}

function itemStyle(it) {
  const style = {
    left: it.x,
    top: it.y,
  };
  if (it.type === "text") style.width = it.w || 360;
  const rot = it.rotation || 0;
  const sc = it.scale ?? 1;
  if (rot || sc !== 1) {
    const w = itemWidth(it);
    const h = itemHeight(it);
    style.transform = `rotate(${rot}deg) scale(${sc})`;
    style.transformOrigin = `${w / 2}px ${h / 2}px`;
  }
  return style;
}

function cornerWorld(it, corner) {
  const w = itemWidth(it) * (it.scale ?? 1);
  const h = itemHeight(it) * (it.scale ?? 1);
  const cx = it.x + w / 2;
  const cy = it.y + h / 2;
  const rad = ((it.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const lx = corner.includes("w") ? -w / 2 : w / 2;
  const ly = corner.includes("n") ? -h / 2 : h / 2;
  return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
}

// one-time migration: bring ideas from the old node canvas onto the new board
function migrateOldSeeds() {
  const seeds = load(OLD_SEEDS_KEY, null);
  if (!Array.isArray(seeds) || !seeds.length) return [];
  return seeds
    .map((s) => {
      if (s.type === "image" && s.image) {
        return { id: uid(), type: "image", x: s.x || 0, y: s.y || 0, w: 220, src: s.image };
      }
      const text = stripMd(s.title || s.text || "");
      if (!text) return null;
      return { id: uid(), type: "text", x: (s.x || 0) - 90, y: (s.y || 0) - 14, text };
    })
    .filter(Boolean);
}

function migrateOldSavedNodes() {
  const old = load(OLD_NODES_KEY, null);
  if (!Array.isArray(old) || !old.length) return [];
  return old
    .map((n) => {
      const items = [];
      if (n.type === "image" && n.image) {
        items.push(normalizeItem({ type: "image", x: 0, y: 0, w: 220, h: 165, src: n.image }));
      } else if (n.text?.trim()) {
        items.push(normalizeItem({ type: "text", x: 0, y: 0, text: n.text.trim(), w: 360 }));
      }
      for (const s of n.strokes || []) {
        if (s.points?.length) items.push(normalizeItem({ type: "stroke", ...s }));
      }
      if (!items.length) return null;
      return {
        id: n.id || uid(),
        title: n.title || n.text?.trim().split("\n")[0].slice(0, 48) || "untitled",
        kind: n.kind || "idea",
        structNum: n.struct || null,
        items,
        savedAt: n.savedAt || Date.now(),
      };
    })
    .filter(Boolean);
}

function nextStructNumber() {
  const cur = parseInt(localStorage.getItem(STRUCTSEQ_KEY) || "283", 10) || 283;
  const n = cur + 1;
  localStorage.setItem(STRUCTSEQ_KEY, String(n));
  return n;
}

function samenessPrompt(labels) {
  const body = labels.map((t, i) => `(${i + 1}) ${t}`).join("\n");
  return `Find the HIDDEN SAMENESS — the deep structural isomorphism shared by these ${labels.length} things. Ignore surface similarity.

${body}

Return EXACTLY:
NAME: <2-4 word name for the structure>
STRUCTURE: <1-2 sentences stating the shared deep pattern>
WHY: <one sentence on what this unlocks>`;
}

function parseSameness(out) {
  const name = (out.match(/NAME:\s*(.+)/i) || [])[1]?.trim() || "pattern";
  const structure = (out.match(/STRUCTURE:\s*([\s\S]+?)(?:\nWHY:|$)/i) || [])[1]?.trim() || out.trim();
  return { name, body: structure };
}

function structurePreview(struct) {
  const texts = (struct.items || []).filter((it) => it.type === "text" && it.text?.trim()).map((it) => it.text.trim());
  if (texts.length) return texts[0].split("\n")[0].slice(0, 60);
  const imgs = (struct.items || []).filter((it) => it.type === "image").length;
  const strokes = (struct.items || []).filter((it) => it.type === "stroke").length;
  const parts = [];
  if (texts.length) parts.push(`${texts.length} text`);
  if (imgs) parts.push(`${imgs} image`);
  if (strokes) parts.push(`${strokes} stroke`);
  return parts.join(" · ") || struct.title || "empty";
}

function parseApiResponse(res, raw) {
  if (res.status === 504 || /FUNCTION_INVOCATION_TIMEOUT|timed out/i.test(raw)) {
    throw new Error("Phase timed out on the server — continuing if possible.");
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const snippet = raw.trim().slice(0, 80);
    if (snippet.startsWith("<!") || snippet.toLowerCase().startsWith("<html")) {
      throw new Error("Could not reach the API server. Refresh and try again.");
    }
    try {
      data = JSON.parse(jsonrepair(raw));
    } catch {
      throw new Error("Server returned invalid JSON. The request may have timed out — try again.");
    }
  }
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function estimatePlanMs(plan) {
  if (!plan?.phases?.length) return ETA.default;
  const raw = plan.phases.reduce((sum, p) => sum + (p.timeoutMs || 55000) + 5000, 8000);
  return scaleEta(raw);
}

function parseHighlightPortals(out) {
  const blocks = out
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b.length > 8);
  const portals = blocks.map((block) => {
    const tagged = block.match(/^\[([^\]]+)\]\s*\n([\s\S]+)$/);
    if (tagged) return { domain: tagged[1].trim(), body: tagged[2].trim() };
    const inline = block.match(/^\[([^\]]+)\]\s*(.+)$/s);
    if (inline) return { domain: inline[1].trim(), body: inline[2].trim() };
    return {
      domain: null,
      body: block.replace(/^\s*(?:\[[^\]]+\]|[-*•]|\d+[.)])\s*/m, "").trim(),
    };
  });
  return portals.filter((p) => p.body.length > 8);
}

function portalDisplayText(portal) {
  if (portal.domain) return `[${portal.domain}]\n${portal.body}`;
  return portal.body;
}

function pointNearRect(px, py, rect, pad = 6) {
  return (
    px >= rect.left - pad &&
    px <= rect.right + pad &&
    py >= rect.top - pad &&
    py <= rect.bottom + pad
  );
}

function strokeWorldBBox(points, pad = 0) {
  if (!points?.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minx: Math.min(...xs) - pad,
    miny: Math.min(...ys) - pad,
    maxx: Math.max(...xs) + pad,
    maxy: Math.max(...ys) + pad,
  };
}

function bboxesOverlap(a, b) {
  if (!a || !b) return false;
  return a.minx <= b.maxx && a.maxx >= b.minx && a.miny <= b.maxy && a.maxy >= b.miny;
}

function sampleStrokePoints(points) {
  const samples = [];
  for (let i = 0; i < points.length; i++) {
    samples.push(points[i]);
    if (i + 1 < points.length) {
      const a = points[i];
      const b = points[i + 1];
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
      for (let s = 1; s < steps; s++) {
        samples.push({
          x: a.x + ((b.x - a.x) * s) / steps,
          y: a.y + ((b.y - a.y) * s) / steps,
        });
      }
    }
  }
  return samples;
}

function strokePathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

function isClosedHighlightLoop(points) {
  if (points.length < 10) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const closeDist = Math.hypot(last.x - first.x, last.y - first.y);
  const pathLen = strokePathLength(points);
  if (closeDist > Math.max(36, pathLen * 0.2)) return false;
  const bb = strokeWorldBBox(points, HIGHLIGHT_W * 0.5);
  if (!bb) return false;
  return bb.maxx - bb.minx > 48 && bb.maxy - bb.miny > 48;
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const denom = yj - yi || 1e-9;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / denom + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function clientBoundsForItem(it, worldToClient) {
  if (it.type === "stroke") {
    if (!it.points?.length) return null;
    const xs = it.points.map((p) => worldToClient(p.x, p.y).x);
    const ys = it.points.map((p) => worldToClient(p.x, p.y).y);
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    };
  }
  const scale = it.scale ?? 1;
  const tl = worldToClient(it.x, it.y);
  if (it.type === "image") {
    const w = (it.w || 200) * scale;
    const h = (it.h || Math.round((it.w || 200) * 0.75)) * scale;
    return { left: tl.x, top: tl.y, right: tl.x + w, bottom: tl.y + h };
  }
  if (it.type === "text") {
    const w = (it.w || 360) * scale;
    const h = itemHeight(it) * scale;
    return { left: tl.x, top: tl.y, right: tl.x + w, bottom: tl.y + h };
  }
  return null;
}

function brushHitsItem(it, cx, cy, lastCx, lastCy, brush, worldToClient) {
  if (it.type === "text") return false;
  if (it.type === "stroke") {
    for (let k = 1; k < it.points.length; k++) {
      const a = worldToClient(it.points[k - 1].x, it.points[k - 1].y);
      const b = worldToClient(it.points[k].x, it.points[k].y);
      if (Math.hypot(cx - a.x, cy - a.y) <= brush || Math.hypot(cx - b.x, cy - b.y) <= brush) return true;
      if (distToSeg(cx, cy, a.x, a.y, b.x, b.y) <= brush) return true;
      if (lastCx != null && distToSeg(lastCx, lastCy, a.x, a.y, b.x, b.y) <= brush) return true;
    }
    return false;
  }
  const bb = clientBoundsForItem(it, worldToClient);
  if (!bb) return false;
  const pad = brush;
  const inRect = (x, y) =>
    x >= bb.left - pad && x <= bb.right + pad && y >= bb.top - pad && y <= bb.bottom + pad;
  if (inRect(cx, cy)) return true;
  if (lastCx != null) {
    for (let t = 0; t <= 1; t += 0.25) {
      const x = lastCx + (cx - lastCx) * t;
      const y = lastCy + (cy - lastCy) * t;
      if (inRect(x, y)) return true;
    }
  }
  return false;
}

function highlightErasureHits(items, cx, cy, lastCx, lastCy, scale, worldToClient, skipIds) {
  const brush = Math.max(14, HIGHLIGHT_W * scale * 0.52);
  const hits = [];
  for (const it of items) {
    if (skipIds?.has(it.id)) continue;
    if (brushHitsItem(it, cx, cy, lastCx, lastCy, brush, worldToClient)) hits.push(it.id);
  }
  return hits;
}

function itemsInsideHighlightLoop(points, itemList) {
  if (points.length < 3) return [];
  const ids = [];
  for (const it of itemList) {
    const bb = itemWorldBBox(it);
    if (!bb) continue;
    const cx = (bb.minx + bb.maxx) / 2;
    const cy = (bb.miny + bb.maxy) / 2;
    const corners = [
      { x: bb.minx, y: bb.miny },
      { x: bb.maxx, y: bb.miny },
      { x: bb.maxx, y: bb.maxy },
      { x: bb.minx, y: bb.maxy },
    ];
    if (pointInPolygon(cx, cy, points) || corners.some((c) => pointInPolygon(c.x, c.y, points))) {
      ids.push(it.id);
    }
  }
  return [...new Set(ids)];
}

function extractTextFromHighlightStroke(points, strokeWidth, itemList, worldToClient) {
  const bb = strokeWorldBBox(points, strokeWidth * 0.65);
  const textItems = itemList.filter(
    (it) => it.type === "text" && it.text?.trim() && bboxesOverlap(itemWorldBBox(it), bb)
  );
  if (!textItems.length) return null;

  const samples = sampleStrokePoints(points).map((p) => worldToClient(p.x, p.y));
  const pad = Math.max(10, strokeWidth * 0.55);

  for (const item of textItems) {
    const el = document.querySelector(`[data-item="${item.id}"].board-text`);
    if (!el) continue;
    const full = el.innerText || item.text;
    const textNode = el.firstChild;
    const charHits = new Set();

    if (textNode?.nodeType === Node.TEXT_NODE) {
      for (let i = 0; i < full.length; i++) {
        try {
          const range = document.createRange();
          range.setStart(textNode, i);
          range.setEnd(textNode, Math.min(i + 1, textNode.length));
          const cr = range.getBoundingClientRect();
          if (!cr.width && !cr.height) continue;
          if (samples.some((s) => pointNearRect(s.x, s.y, cr, pad))) charHits.add(i);
        } catch {
          /* skip bad range */
        }
      }
    }

    if (!charHits.size) {
      const er = el.getBoundingClientRect();
      if (samples.some((s) => pointNearRect(s.x, s.y, er, pad))) {
        for (let i = 0; i < full.length; i++) charHits.add(i);
      } else {
        continue;
      }
    }

    const hitOffsets = [...charHits].sort((a, b) => a - b);
    let start = hitOffsets[0];
    let end = hitOffsets[hitOffsets.length - 1] + 1;
    while (start > 0 && /\S/.test(full[start - 1])) start--;
    while (end < full.length && /\S/.test(full[end])) end++;
    const quote = full.slice(start, end).trim();
    if (quote.length < 2) continue;

    let rect;
    try {
      const textNode = el.firstChild;
      if (textNode?.nodeType === Node.TEXT_NODE) {
        const tr = document.createRange();
        tr.setStart(textNode, Math.min(start, textNode.length));
        tr.setEnd(textNode, Math.min(end, textNode.length));
        const r = tr.getBoundingClientRect();
        if (r.width || r.height) {
          rect = {
            left: r.left,
            top: r.top,
            bottom: r.bottom,
            right: r.right,
            width: r.width,
            height: r.height,
          };
        }
      }
    } catch {
      /* fall through */
    }
    if (!rect) {
      const r = el.getBoundingClientRect();
      rect = { left: r.left, top: r.top, bottom: r.bottom, right: r.right, width: r.width, height: r.height };
    }

    return { itemId: item.id, quote, context: item.text, rect };
  }

  return null;
}

function formatJobEta(ms) {
  if (ms <= 0) return "finishing…";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `~${s}s remaining`;
  return `~${Math.ceil(s / 60)}m remaining`;
}

async function fetchExecutionPlan(op, opMap, material) {
  const ids = collectSubtreeIds(op.id, opMap);
  const subset = {};
  for (const id of ids) subset[id] = opMap[id];
  const planRes = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, opMap: subset, material }),
  });
  const { plan } = parseApiResponse(planRes, await planRes.text());
  return { plan, opMap: subset };
}

async function runExecutionOnServer({ op, opMap, operators, material, image, onProgress, plan: planIn }) {
  let plan = planIn;
  let subset;
  if (!plan) {
    const fetched = await fetchExecutionPlan(op, opMap, material);
    plan = fetched.plan;
    subset = fetched.opMap;
  } else {
    const ids = collectSubtreeIds(op.id, opMap);
    subset = {};
    for (const id of ids) subset[id] = opMap[id];
  }

  const context = { material, subject: material, research: "", resolveRaw: "" };
  const phases = plan.phases || [];
  let output = "";

  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const timeoutMs = phaseClientAbortMs(phase);
    onProgress?.(`${phase.label} (${i + 1}/${phases.length})`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("/api/phase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phaseId: phase.id,
          plan,
          op,
          opMap: subset,
          operators,
          context,
          image: phase.id === "synthesize" ? image : null,
        }),
        signal: controller.signal,
      });
      const data = parseApiResponse(res, await res.text());
      if (phase.id === "resolve") {
        context.subject = data.subject || data.output || context.subject;
        context.resolveRaw = data.resolveRaw || data.output || "";
      }
      if (phase.id === "research") {
        context.research = data.research || data.output || "";
      }
      if (phase.id === "synthesize") {
        output = data.output || "";
      }
    } catch (err) {
      if (phase.id === "research") {
        context.research = "";
        context.researchFallback = true;
        onProgress?.("research skipped — synthesizing");
        continue;
      }
      if (err.name === "AbortError") {
        throw new Error(`${phase.label} timed out — try again.`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return output;
}

async function runClaude(prompt, text, opts = {}) {
  const { image = null, system = null, maxTokens = null, research = false } = opts;
  const controller = new AbortController();
  const timeoutMs = phaseClientAbortMs({ timeoutMs: 180000 });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, text, count: 1, image, system, maxTokens, research }),
      signal: controller.signal,
    });
    const raw = await res.text();
    const data = parseApiResponse(res, raw);
    return (data.outputs || [])[0] || "";
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Request timed out — try again.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function fileToImage(file, max = 1100) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const type = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve({ src: canvas.toDataURL(type, 0.86), w, h });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// distance from point to a segment (screen space)
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export default function App() {
  const [items, setItems] = useState(() => {
    const saved = load(ITEMS_KEY, null);
    if (Array.isArray(saved) && saved.length) return saved.map(normalizeItem);
    const fromArtifact = migrateFromArtifact();
    if (fromArtifact.length) return fromArtifact;
    return migrateOldSeeds().map(normalizeItem);
  });
  const [camera, setCamera] = useState(() => load(CAMERA_KEY, { x: 0, y: 0, scale: 1 }));
  const [operators, setOperators] = useState(() => {
    const saved = load(OPERATORS_KEY, null) || load(LEGACY_OPERATORS_KEY, null);
    return migrateOperators(migrateOperatorStore(saved));
  });
  const [structures, setStructures] = useState(() => {
    const saved = load(STRUCTURES_KEY, null);
    if (Array.isArray(saved) && saved.length) return saved;
    return migrateOldSavedNodes();
  });
  const [paths, setPaths] = useState(() => load(PATHS_KEY, []));
  // recording: { pathId, title, steps: [...], branchOf: {pathId, stepIndex} | null }
  const [recording, setRecording] = useState(null);
  // walking: { pathId, stepIndex }
  const [walking, setWalking] = useState(null);

  const [tool, setTool] = useState("highlight"); // highlight | select | text | pen | marker | eraser | hand
  const [selection, setSelection] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [lasso, setLasso] = useState(null);
  const [jobs, setJobs] = useState([]); // background operations
  const [toast, setToast] = useState(null);
  const [opEditor, setOpEditor] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [dropReady, setDropReady] = useState(false);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [highlight, setHighlight] = useState(null); // { itemId, quote, context, rect, strokeId? }
  const [gesturing, setGesturing] = useState(false);
  const [imageArmed, setImageArmed] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [railTab, setRailTab] = useState("functions"); // functions | structures | paths
  const [railDropOver, setRailDropOver] = useState(false);
  const [onboard, setOnboard] = useState(() => (localStorage.getItem(ONBOARDED_KEY) ? null : { step: "role" }));
  const [expandPulse, setExpandPulse] = useState(null); // item id — compass enlarged after double-tap
  const [linkDraft, setLinkDraft] = useState(null); // { fromX, fromY, toX, toY }
  const [hoverId, setHoverId] = useState(null); // note under cursor — its tendrils wake up

  const viewportRef = useRef(null);
  const inputLayerRef = useRef(null);
  const gesture = useRef(null);
  const camRef = useRef(camera);
  const itemsRef = useRef(items);
  const toolRef = useRef(tool);
  const selRef = useRef(selection);
  const editingRef = useRef(editing);
  const combineRef = useRef(null);
  const showToastRef = useRef(() => {});
  const pendingImageRef = useRef(null);
  const lastPointerRef = useRef(null);
  const eraseAtPointerRef = useRef(() => false);
  const historyRef = useRef({ past: [], future: [] });
  const pushHistoryRef = useRef(() => {});
  const spawnBranchRef = useRef(() => {});
  const recordStepRef = useRef(() => {});
  const hoverIdRef = useRef(null);
  const hoverRafRef = useRef(null);
  hoverIdRef.current = hoverId;
  camRef.current = camera;
  itemsRef.current = items;
  toolRef.current = tool;
  selRef.current = selection;
  editingRef.current = editing;

  useEffect(() => localStorage.setItem(ITEMS_KEY, JSON.stringify(items)), [items]);
  useEffect(() => localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)), [camera]);
  useEffect(() => localStorage.setItem(OPERATORS_KEY, JSON.stringify(operators)), [operators]);
  useEffect(() => localStorage.setItem(STRUCTURES_KEY, JSON.stringify(structures)), [structures]);
  useEffect(() => localStorage.setItem(PATHS_KEY, JSON.stringify(paths)), [paths]);

  useEffect(() => {
    if (!["select", "highlight"].includes(tool)) setHighlight(null);
  }, [tool]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }
  showToastRef.current = showToast;

  function pushHistory() {
    const snap = JSON.stringify(itemsRef.current);
    const { past } = historyRef.current;
    if (past.length && past[past.length - 1] === snap) return;
    past.push(snap);
    if (past.length > 50) past.shift();
    historyRef.current.future = [];
    setCanRedo(false);
    setCanUndo(true);
  }
  pushHistoryRef.current = pushHistory;

  function undo() {
    const { past, future } = historyRef.current;
    if (!past.length) return;
    future.push(JSON.stringify(itemsRef.current));
    setItems(JSON.parse(past.pop()));
    setCanUndo(past.length > 0);
    setCanRedo(future.length > 0);
    setHighlight(null);
    setSelection([]);
    setEditing(null);
    showToast("undone");
  }

  function redo() {
    const { past, future } = historyRef.current;
    if (!future.length) return;
    past.push(JSON.stringify(itemsRef.current));
    setItems(JSON.parse(future.pop()));
    setCanUndo(true);
    setCanRedo(future.length > 0);
    setHighlight(null);
    setSelection([]);
    setEditing(null);
    showToast("redone");
  }

  function removeHighlightStroke(strokeId) {
    if (!strokeId) return;
    setItems((arr) => arr.filter((it) => it.id !== strokeId));
  }

  function pushJob(job) {
    const id = job.id || uid();
    setJobs((arr) => [{ ...job, id }, ...arr].slice(0, 12));
    return id;
  }
  function patchJob(id, patch) {
    setJobs((arr) => arr.map((j) => (j.id === id ? { ...j, ...patch } : j)));
  }
  function finishJob(id, status, message) {
    patchJob(id, { status, step: message, progress: status === "done" ? 1 : undefined });
    setTimeout(() => setJobs((arr) => arr.filter((j) => j.id !== id)), status === "error" ? 8000 : 4000);
  }

  // ---- camera math: all world coords are relative to the viewport (not the window) ----
  function vpRect() {
    return viewportRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function vpLocal(clientX, clientY) {
    const r = vpRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function clientToWorld(clientX, clientY) {
    const l = vpLocal(clientX, clientY);
    const c = camRef.current;
    return { x: (l.x - c.x) / c.scale, y: (l.y - c.y) / c.scale };
  }

  function worldToLocal(wx, wy) {
    const c = camRef.current;
    return { x: wx * c.scale + c.x, y: wy * c.scale + c.y };
  }

  function worldToClient(wx, wy) {
    const l = worldToLocal(wx, wy);
    const r = vpRect();
    return { x: l.x + r.left, y: l.y + r.top };
  }

  function viewportCenterWorld() {
    const r = vpRect();
    return clientToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  function zoomCamera(c, factor) {
    const r = vpRect();
    const lx = r.width / 2;
    const ly = r.height / 2;
    const scale = clamp(c.scale * factor, 0.12, 4.5);
    const wx = (lx - c.x) / c.scale;
    const wy = (ly - c.y) / c.scale;
    return { scale, x: lx - wx * scale, y: ly - wy * scale };
  }

  function finishEditing() {
    const id = editingRef.current;
    if (!id) return;
    const el = document.querySelector(`[data-item="${id}"].editing`);
    if (el?.isContentEditable) {
      commitEdit(id, el.innerText ?? "");
    } else {
      setEditing(null);
    }
  }

  const setGesturingRef = useRef(setGesturing);
  setGesturingRef.current = setGesturing;

  // global pointer move/up so gestures work across canvas items
  useEffect(() => {
    function onMove(e) {
      const g = gesture.current;
      lastPointerRef.current = { cx: e.clientX, cy: e.clientY };
      if (!g) return;
      const cx = e.clientX;
      const cy = e.clientY;

      if (g.mode === "pan") {
        setCamera({ ...g.cam, x: g.cam.x + (cx - g.cx), y: g.cam.y + (cy - g.cy) });
      } else if (g.mode === "draw") {
        const w = clientToWorld(cx, cy);
        if (g.highlight) {
          const erased = highlightErasureHits(
            itemsRef.current,
            cx,
            cy,
            g.lastCx,
            g.lastCy,
            camRef.current.scale,
            worldToClient,
            g.deletedIds
          );
          if (erased.length) {
            if (!g.deletedIds) g.deletedIds = new Set();
            erased.forEach((id) => g.deletedIds.add(id));
            setItems((arr) => arr.filter((it) => !g.deletedIds.has(it.id)));
            setHighlight((hl) => {
              if (hl && g.deletedIds.has(hl.itemId)) return null;
              return hl;
            });
          }
          g.lastCx = cx;
          g.lastCy = cy;
        }
        g.points.push(w);
        const loop = g.highlight && g.points.length > 8 && isClosedHighlightLoop(g.points);
        setDraft({ points: g.points.slice(), marker: g.marker, highlight: g.highlight, loop });
      } else if (g.mode === "erase") {
        const hit = itemAtPoint(cx, cy);
        if (hit) setItems((arr) => arr.filter((it) => it.id !== hit.id));
      } else if (g.mode === "move") {
        g.lastCx = cx;
        g.lastCy = cy;
        const dx = (cx - g.cx) / camRef.current.scale;
        const dy = (cy - g.cy) / camRef.current.scale;
        g.cx = cx;
        g.cy = cy;
        g.moved += Math.abs(dx) + Math.abs(dy);
        const ids = new Set(g.ids);
        setItems((arr) =>
          arr.map((it) => {
            if (!ids.has(it.id)) return it;
            if (it.type === "stroke") return { ...it, points: it.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
            return { ...it, x: it.x + dx, y: it.y + dy };
          })
        );
      } else if (g.mode === "pending") {
        const dist = Math.hypot(cx - g.cx, cy - g.cy);
        if (dist > 4) {
          pushHistoryRef.current();
          g.mode = "move";
          g.moved = 0;
          g.lastCx = cx;
          g.lastCy = cy;
        }
      } else if (g.mode === "lasso") {
        const lp = vpLocal(cx, cy);
        g.x1 = lp.x;
        g.y1 = lp.y;
        setLasso({ x0: g.x0, y0: g.y0, x1: lp.x, y1: lp.y });
      } else if (g.mode === "rotate") {
        const it = itemsRef.current.find((i) => i.id === g.id);
        if (!it) return;
        const c = worldToClient(g.cx0, g.cy0);
        const a1 = Math.atan2(cy - c.y, cx - c.x);
        const deg = g.startRot + ((a1 - g.startAngle) * 180) / Math.PI;
        updateItem(g.id, { rotation: deg });
      } else if (g.mode === "resize") {
        const it = itemsRef.current.find((i) => i.id === g.id);
        if (!it) return;
        const dw = (cx - g.cx) / camRef.current.scale;
        const dh = (cy - g.cy) / camRef.current.scale;
        if (it.type === "image") {
          let nw = Math.max(40, g.startW + (g.corner.includes("w") ? -dw : dw));
          let nh = Math.max(30, g.startH + (g.corner.includes("n") ? -dh : dh));
          if (g.aspect) nh = Math.round(nw * (g.startH / g.startW));
          let nx = g.startX ?? it.x;
          let ny = g.startY ?? it.y;
          if (g.corner.includes("w")) nx = (g.startX ?? it.x) + g.startW - nw;
          if (g.corner.includes("n")) ny = (g.startY ?? it.y) + g.startH - nh;
          updateItem(g.id, { w: Math.round(nw), h: Math.round(nh), x: Math.round(nx), y: Math.round(ny) });
        } else if (it.type === "text") {
          updateItem(g.id, { w: Math.max(120, Math.round(g.startW + dw)) });
        }
      } else if (g.mode === "scale") {
        const it = itemsRef.current.find((i) => i.id === g.id);
        if (!it) return;
        const dw = (cx - g.cx) / camRef.current.scale;
        const factor = Math.max(0.25, g.startScale + dw / 200);
        updateItem(g.id, { scale: factor });
      } else if (g.mode === "connect") {
        g.lastCx = cx;
        g.lastCy = cy;
        const w = clientToWorld(cx, cy);
        setLinkDraft({ fromX: g.fromX, fromY: g.fromY, toX: w.x, toY: w.y });
      }
    }

    function onUp() {
      setGesturingRef.current(false);
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;

      if (g.mode === "draw") {
        if (g.points.length > 1) {
          const isHighlight = !!g.highlight;
          if (isHighlight) {
            const pts = g.points.slice();
            if (isClosedHighlightLoop(pts)) {
              const inside = itemsInsideHighlightLoop(pts, itemsRef.current);
              if (inside.length) {
                setSelection(inside);
                showToastRef.current(`selected ${inside.length} item${inside.length > 1 ? "s" : ""}`);
              } else {
                showToastRef.current("nothing inside the circle");
              }
              setHighlight(null);
            } else {
              const strokeId = uid();
              setItems((arr) => [
                ...arr,
                {
                  id: strokeId,
                  type: "stroke",
                  points: pts,
                  color: HIGHLIGHT_INK,
                  width: HIGHLIGHT_W,
                  marker: true,
                  highlight: true,
                  ephemeral: true,
                },
              ]);
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  const extracted = extractTextFromHighlightStroke(
                    pts,
                    HIGHLIGHT_W,
                    itemsRef.current.filter((it) => it.id !== strokeId),
                    worldToClient
                  );
                  if (extracted) {
                    setHighlight({ ...extracted, strokeId });
                  } else {
                    setItems((arr) => arr.filter((it) => it.id !== strokeId));
                    if (!g.deletedIds?.size) {
                      showToastRef.current("scribble to erase · circle to select · draw over text to think");
                    }
                  }
                });
              });
            }
          } else {
            setItems((arr) => [
              ...arr,
              {
                id: uid(),
                type: "stroke",
                points: g.points,
                color: INK,
                width: g.marker ? MARKER_W : PEN_W,
                marker: g.marker,
                highlight: false,
              },
            ]);
          }
        }
        setDraft(null);
      } else if (g.mode === "lasso") {
        setLasso(null);
        const r = vpRect();
        const L = Math.min(g.x0, g.x1) + r.left;
        const R = Math.max(g.x0, g.x1) + r.left;
        const T = Math.min(g.y0, g.y1) + r.top;
        const B = Math.max(g.y0, g.y1) + r.top;
        if (Math.abs(R - L) >= 4 || Math.abs(B - T) >= 4) {
          const picked = itemsRef.current
            .filter((it) => {
              const bb = itemScreenBBox(it);
              return bb.left < R && bb.right > L && bb.top < B && bb.bottom > T;
            })
            .map((it) => it.id);
          setSelection(picked);
        }
      } else if (g.mode === "pending") {
        /* click only — selection already set */
      } else if (g.mode === "move") {
        if (g.ids?.length === 1 && (g.moved || 0) > COMBINE_THRESHOLD) {
          const exclude = new Set(g.ids);
          const target = itemAtPoint(g.lastCx ?? g.cx, g.lastCy ?? g.cy, exclude);
          if (target) combineRef.current?.(g.ids, [target.id]);
        }
      } else if (g.mode === "connect") {
        setLinkDraft(null);
        const endCx = g.lastCx ?? g.cx;
        const endCy = g.lastCy ?? g.cy;
        const w = clientToWorld(endCx, endCy);
        const moved = Math.hypot(endCx - g.cx, endCy - g.cy);
        const exclude = new Set([g.fromId]);
        const hit = itemAtPoint(endCx, endCy, exclude);
        if (hit && isNoteItem(hit)) {
          pushHistoryRef.current();
          const dup = itemsRef.current.some(
            (it) => it.type === "link" && it.fromId === g.fromId && it.toId === hit.id
          );
          if (!dup) {
            setItems((arr) => [
              ...arr,
              normalizeItem({
                id: uid(),
                type: "link",
                fromId: g.fromId,
                toId: hit.id,
                fromDir: g.fromDir,
              }),
            ]);
          }
          setSelection([hit.id]);
          // while recording a path, a drawn connection is itself a "compare" moment
          recordStepRef.current("compare", [g.fromId, hit.id]);
        } else if (moved > 8 || Math.hypot(w.x - g.fromX, w.y - g.fromY) > 28) {
          pushHistoryRef.current();
          const id = uid();
          const noteW = 320;
          setItems((arr) => [
            ...arr,
            normalizeItem({
              id,
              type: "text",
              x: w.x - noteW / 2,
              y: w.y - 48,
              text: "",
              w: noteW,
              bornFrom: [g.fromId],
            }),
            normalizeItem({
              id: uid(),
              type: "link",
              fromId: g.fromId,
              toId: id,
              fromDir: g.fromDir,
            }),
          ]);
          setSelection([id]);
          setEditing(id);
          // every continuation is a branch — recording captures it as a step
          recordStepRef.current("notice", [g.fromId, id]);
        } else {
          spawnBranchRef.current(g.fromId, g.fromDir);
        }
        setExpandPulse(null);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // wheel: pan; cmd/ctrl+wheel: zoom toward cursor
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0016);
        const local = vpLocal(e.clientX, e.clientY);
        setCamera((c) => {
          const scale = clamp(c.scale * factor, 0.12, 4.5);
          const wx = (local.x - c.x) / c.scale;
          const wy = (local.y - c.y) / c.scale;
          return { scale, x: local.x - wx * scale, y: local.y - wy * scale };
        });
      } else {
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }));
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // keyboard: escape, delete while not typing in a field
  useEffect(() => {
    function down(e) {
      const typing = e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName || "");
      if (typing) return;
      if (e.key === "Escape") {
        finishEditing();
        setSelection([]);
        setLasso(null);
        setExpandPulse(null);
        setLinkDraft(null);
        gesture.current = null;
        setHighlight((hl) => {
          if (hl?.strokeId) {
            setItems((arr) => arr.filter((it) => it.id !== hl.strokeId));
          }
          return null;
        });
        pendingImageRef.current = null;
        setImageArmed(false);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selRef.current.length) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.key === "Enter" && selRef.current.length === 1 && !e.metaKey && !e.ctrlKey) {
        const it = itemsRef.current.find((i) => i.id === selRef.current[0]);
        if (it?.type === "text" && !editingRef.current) {
          e.preventDefault();
          setEditing(it.id);
        }
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        toolRef.current === "highlight" &&
        lastPointerRef.current
      ) {
        e.preventDefault();
        eraseAtPointerRef.current(lastPointerRef.current.cx, lastPointerRef.current.cy);
      }
    }
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  // paste image or text
  useEffect(() => {
    function onPaste(e) {
      const typing = e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName || "");
      if (typing) return;
      const clipItems = e.clipboardData?.items || [];
      for (const it of clipItems) {
        if (it.type?.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            addImage(f);
            return;
          }
        }
      }
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (text) {
        e.preventDefault();
        const center = viewportCenterWorld();
        const id = uid();
        setItems((arr) => [...arr, normalizeItem({ id, type: "text", x: center.x, y: center.y, text, w: 360 })]);
        setSelection([id]);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  // ---- item helpers ----
  function updateItem(id, patch) {
    setItems((arr) => arr.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function deleteSelection() {
    pushHistory();
    const ids = new Set(selRef.current);
    setItems((arr) =>
      arr.filter((it) => {
        if (ids.has(it.id)) return false;
        if (it.type === "link" && (ids.has(it.fromId) || ids.has(it.toId))) return false;
        return true;
      })
    );
    setSelection([]);
    setExpandPulse(null);
    setLinkDraft(null);
  }

  function spawnBranchInDir(fromId, dirId) {
    const from = itemsRef.current.find((i) => i.id === fromId);
    if (!from || !isNoteItem(from)) return;
    pushHistory();
    const dir = EXPAND_DIRS.find((d) => d.id === dirId) || EXPAND_DIRS[0];
    const c = noteCenter(from);
    const noteW = 320;
    const x = c.x + Math.cos(dir.angle) * BRANCH_DIST - noteW / 2;
    const y = c.y + Math.sin(dir.angle) * BRANCH_DIST - 48;
    const id = uid();
    setItems((arr) => [
      ...arr,
      normalizeItem({ id, type: "text", x, y, text: "", w: noteW, bornFrom: [fromId] }),
      normalizeItem({ id: uid(), type: "link", fromId, toId: id, fromDir: dirId }),
    ]);
    setSelection([id]);
    setEditing(id);
    setExpandPulse(null);
  }
  spawnBranchRef.current = spawnBranchInDir;

  function startBranchDrag(e, fromId, dirId) {
    e.stopPropagation();
    e.preventDefault();
    const from = itemsRef.current.find((i) => i.id === fromId);
    if (!from) return;
    const ap = branchAnchor(from, dirId);
    gesture.current = {
      mode: "connect",
      fromId,
      fromDir: dirId,
      fromX: ap.x,
      fromY: ap.y,
      cx: e.clientX,
      cy: e.clientY,
      lastCx: e.clientX,
      lastCy: e.clientY,
    };
    setLinkDraft({ fromX: ap.x, fromY: ap.y, toX: ap.x, toY: ap.y });
    setGesturing(true);
    try {
      inputLayerRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // ---- composed operators (functions made of functions) ----
  const opMap = useMemo(() => Object.fromEntries(operators.map((o) => [o.id, o])), [operators]);

  function spawnPortalObjects(portals, sourceIds, atWorld) {
    const idSet = new Set(sourceIds || []);
    const sel = itemsRef.current.filter((it) => idSet.has(it.id));
    const boxes = sel.map(itemWorldBBox).filter(Boolean);
    const cx = atWorld?.x ?? (boxes.length ? Math.max(...boxes.map((b) => b.maxx)) + 48 : viewportCenterWorld().x);
    const cy = atWorld?.y ?? (boxes.length ? Math.min(...boxes.map((b) => b.miny)) : viewportCenterWorld().y);
    const n = portals.length;
    const radius = 100 + n * 18;
    const newIds = [];
    const newItems = [];
    for (let i = 0; i < n; i++) {
      const portal = portals[i];
      const text = portalDisplayText(portal);
      const clean = stripMd(text).trim();
      if (!clean) continue;
      const spread = Math.min(Math.PI * 0.85, Math.max(Math.PI / 3, n * 0.28));
      const angle = -spread / 2 + (n === 1 ? 0 : (i / (n - 1)) * spread);
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius + i * 8;
      const id = uid();
      newIds.push(id);
      const w = Math.min(480, Math.max(240, Math.round(clean.length * 0.45 + 180)));
      newItems.push(
        normalizeItem({
          id,
          type: "text",
          x,
          y,
          text: clean,
          w,
          bornFrom: sourceIds || [],
          portal: !!portal.domain,
        })
      );
    }
    if (newItems.length) {
      setItems((arr) => [...arr, ...newItems]);
      setSelection(newIds);
    }
    return newIds;
  }

  function spawnMultipleObjects(texts, sourceIds, atWorld) {
    const idSet = new Set(sourceIds || []);
    const sel = itemsRef.current.filter((it) => idSet.has(it.id));
    const boxes = sel.map(itemWorldBBox).filter(Boolean);
    let x = atWorld?.x ?? (boxes.length ? Math.max(...boxes.map((b) => b.maxx)) + 48 : viewportCenterWorld().x);
    let y = atWorld?.y ?? (boxes.length ? Math.min(...boxes.map((b) => b.miny)) : viewportCenterWorld().y);
    const newIds = [];
    const newItems = [];
    for (const t of texts) {
      const clean = stripMd(t).trim();
      if (!clean) continue;
      const id = uid();
      newIds.push(id);
      const w = Math.min(520, Math.max(260, Math.round(clean.length * 0.5 + 180)));
      newItems.push(normalizeItem({ id, type: "text", x, y, text: clean, w, bornFrom: sourceIds || [] }));
      y += Math.max(80, Math.min(200, clean.length * 0.3 + 60));
    }
    if (newItems.length) {
      setItems((arr) => [...arr, ...newItems]);
      setSelection(newIds);
    }
    return newIds;
  }

  async function executeOperatorJob(jobId, op, targetIds, atClient, opts = {}) {
    const idSet = new Set(targetIds);
    const itemList = itemsRef.current.filter((it) => idSet.has(it.id));
    patchJob(jobId, { step: "reading material…" });
    const gathered = await gatherMaterialFromItems(itemList);
    let text = gathered.text;
    const { image } = gathered;
    if (!text?.trim() && !image) throw new Error("no readable content");

    if (opts.highlightQuote) {
      text = `HIGHLIGHTED:\n"""\n${opts.highlightQuote.trim()}\n"""\n\nFULL TEXT:\n"""\n${(opts.highlightContext || text).trim()}\n"""`;
    }

    let out;
    const { plan } = await fetchExecutionPlan(op, opMap, text);
    const estimatedMs = estimatePlanMs(plan);
    patchJob(jobId, {
      step: plan.phases?.[0]?.label || op.name,
      startedAt: Date.now(),
      estimatedMs,
    });
    const onProgress = (step) => patchJob(jobId, { step });
    out = await runExecutionOnServer({
      op,
      opMap,
      operators,
      material: text,
      image,
      onProgress,
      plan,
    });

    if (op.multi || op.name === "differentiate") {
      const parts = out
        .split(/\n{2,}/)
        .map((p) => p.replace(/^\s*(?:\[[^\]]+\]|[-*•]|\d+[.)])\s*/m, "").trim())
        .filter((p) => p.length > 3);
      if (parts.length < 2) {
        const lines = out.split(/\n+/).map((l) => l.trim()).filter((l) => l.length > 3);
        if (lines.length >= 2) {
          const atWorld = atClient ? clientToWorld(atClient.x, atClient.y) : null;
          pushHistory();
          spawnMultipleObjects(lines, targetIds, atWorld);
          return;
        }
        throw new Error(`${op.name} produced only one part`);
      }
      const atWorld = atClient ? clientToWorld(atClient.x, atClient.y) : null;
      pushHistory();
      spawnMultipleObjects(parts, targetIds, atWorld);
      return;
    }

    if (!out?.trim()) throw new Error("empty output");
    patchJob(jobId, { step: "spawning object…", progress: 0.98 });
    const atWorld = atClient ? clientToWorld(atClient.x, atClient.y) : null;
    applyTransformResult(out, targetIds, atWorld);
  }

  function runOperator(op, targetIds, opts = {}) {
    const atClient = opts.atClient;
    let ids = targetIds?.length ? targetIds : resolveTargetIds(atClient);
    if (!ids.length) {
      showToast("drop onto an idea");
      return;
    }
    if ((op.needsSelection >= 2 || op.name === "merge") && ids.length < 2) {
      showToast("merge: select 2+ ideas, or highlight with another selected");
      return;
    }
    setSelection(ids);
    const jobId = pushJob({
      id: uid(),
      label: op.name,
      type: "operator",
      status: "running",
      step: "starting…",
      progress: 0,
      startedAt: Date.now(),
      estimatedMs: isTransformPrimitive(op) ? estimatePrimitiveMs(op, "") : ETA.default,
    });
    executeOperatorJob(jobId, op, ids, atClient, opts)
      .then(() => finishJob(jobId, "done", `done · ${op.name}`))
      .catch((err) => {
        finishJob(jobId, "error", err.message || "failed");
        showToast(err.message || "failed");
      });
  }

  function applyOpDrop(opId, atClient) {
    if (!atClient) return;
    const op = opMap[opId];
    if (!op) return;
    const ids = resolveTargetIds(atClient);
    if (!ids.length) {
      showToast("drop onto text, image, or drawing");
      return;
    }
    setDropTargetId(null);
    runOperator(op, ids, { atClient });
  }

  // ---- saved idea structures ----
  async function runOnboarding(role) {
    localStorage.setItem(ONBOARDED_KEY, "1");
    setOnboard(null);
    const jobId = pushJob({
      id: uid(),
      label: `building ${role} toolbox`,
      type: "onboard",
      status: "running",
      step: "imagining functions…",
      startedAt: Date.now(),
      estimatedMs: ETA.onboarding,
    });
    try {
      const list = await generateFunctionList(role, operators, opMap);
      if (!list.length) throw new Error("Could not imagine functions. Try again.");
      patchJob(jobId, { step: `designing 0 / ${list.length} functions…` });
      let done = 0;
      const trees = await Promise.all(
        list.map(async (fn) => {
          let tree;
          try {
            tree = await decomposeFunction(role, fn, operators, opMap);
          } catch {
            tree = {
              name: fn.name,
              description: fn.description,
              prompt: buildDefaultLeafPrompt(fn.name, fn.description),
            };
          }
          done += 1;
          patchJob(jobId, { step: `designing ${done} / ${list.length} functions…` });
          return tree;
        })
      );
      const newOps = [];
      trees.forEach((t) => materializeTree(t, role, true, newOps));
      setOperators((prev) => [...prev, ...newOps]);
      finishJob(jobId, "done", `${trees.length} functions ready`);
      showToast(`${trees.length} functions ready for ${role}`);
    } catch (err) {
      finishJob(jobId, "error", err.message || "failed");
      showToast(err.message || "Something went wrong.");
    }
  }

  function skipOnboarding() {
    localStorage.setItem(ONBOARDED_KEY, "1");
    setOnboard(null);
  }

  function openCreateFunction() {
    setOpEditor({ mode: "create" });
  }

  function openEditFunction(op) {
    setOpEditor({ mode: "edit", op });
  }

  function saveFunctionTree(oldRootId, newOps) {
    setOperators((arr) => {
      let next = arr;
      const newRootId = newOps.length ? newOps.find((o) => o.top || o.kind === "pipeline")?.id || newOps[0]?.id : null;
      if (oldRootId) {
        const map = Object.fromEntries(arr.map((o) => [o.id, o]));
        const removeIds = collectSubtreeIds(oldRootId, map);
        next = arr.filter((o) => !removeIds.has(o.id));
        if (newRootId && newRootId !== oldRootId) {
          next = next.map((o) => {
            if (o.kind === "pipeline" && o.steps?.includes(oldRootId)) {
              return { ...o, steps: o.steps.map((sid) => (sid === oldRootId ? newRootId : sid)) };
            }
            return o;
          });
        }
      }
      return [...next, ...newOps];
    });
    setOpEditor(null);
    showToast(oldRootId ? "function updated" : "function created");
  }

  function saveManualOp(op) {
    setOperators((arr) => {
      const exists = arr.some((o) => o.id === op.id);
      const normalized = {
        ...op,
        kind: op.kind || "prompt",
        name: (op.name || "").trim(),
        description: (op.description || "").trim(),
        prompt: (op.prompt || "").trim(),
      };
      if (!normalized.prompt && normalized.kind === "prompt") return arr;
      return exists ? arr.map((o) => (o.id === op.id ? normalized : o)) : [...arr, normalized];
    });
    setOpEditor(null);
    showToast("saved");
  }

  function deleteFunction(rootId) {
    const map = Object.fromEntries(operators.map((o) => [o.id, o]));
    const removeIds = collectSubtreeIds(rootId, map);
    setOperators((arr) => arr.filter((o) => !removeIds.has(o.id)));
    setOpEditor(null);
    showToast("function deleted");
  }

  // ---- paths: the medium of shared seeing ----
  // A path preserves the generative sequence of attention, not the artifact.
  // Recording captures moments of seeing; walking replays them; walkers can
  // branch mid-path, so the path evolves.

  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  const walkingRef = useRef(walking);
  walkingRef.current = walking;
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const camAnimRef = useRef(null);

  function animateCameraTo(targetWorld, targetScale, ms = 850) {
    if (camAnimRef.current) cancelAnimationFrame(camAnimRef.current);
    const r = vpRect();
    const from = { ...camRef.current };
    const scale = clamp(targetScale ?? from.scale, 0.12, 4.5);
    const to = {
      scale,
      x: r.width / 2 - targetWorld.x * scale,
      y: r.height / 2 - targetWorld.y * scale,
    };
    const t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const k = ease(t);
      setCamera({
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        scale: from.scale + (to.scale - from.scale) * k,
      });
      if (t < 1) camAnimRef.current = requestAnimationFrame(tick);
      else camAnimRef.current = null;
    };
    camAnimRef.current = requestAnimationFrame(tick);
  }

  function stepFocusCenter(step) {
    const ids = new Set(step.itemIds || []);
    const targets = itemsRef.current.filter((it) => ids.has(it.id));
    if (!targets.length) return step.fallbackCenter || null;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const it of targets) {
      const bb = itemWorldBBox(it);
      if (!bb) continue;
      minx = Math.min(minx, bb.minx);
      miny = Math.min(miny, bb.miny);
      maxx = Math.max(maxx, bb.maxx);
      maxy = Math.max(maxy, bb.maxy);
    }
    if (minx === Infinity) return step.fallbackCenter || null;
    return { x: (minx + maxx) / 2, y: (miny + maxy) / 2, w: maxx - minx, h: maxy - miny };
  }

  function stepFocusScale(focus) {
    if (!focus?.w) return camRef.current.scale;
    const r = vpRect();
    const pad = 220;
    const fit = Math.min((r.width - pad) / Math.max(focus.w, 80), (r.height - pad) / Math.max(focus.h, 60));
    return clamp(Math.min(fit, 1.6), 0.25, 1.8);
  }

  function beginRecordingPath(branchOf = null) {
    finishEditing();
    setWalking(null);
    setRecording({
      pathId: uid(),
      title: "",
      steps: branchOf?.inheritedSteps || [],
      branchOf: branchOf ? { pathId: branchOf.pathId, stepIndex: branchOf.stepIndex } : null,
    });
    setRailTab("paths");
    showToast(branchOf ? "branching — keep walking your own way" : "recording your path — mark moments of seeing");
  }

  function recordStep(kind, itemIds, caption = "") {
    const rec = recordingRef.current;
    if (!rec) return;
    const ids = (itemIds || []).filter((id) => {
      const it = itemsRef.current.find((i) => i.id === id);
      return it && it.type !== "link";
    });
    if (!ids.length) {
      showToast("select or touch something first");
      return;
    }
    const center = viewportCenterWorld();
    const step = {
      id: uid(),
      kind,
      itemIds: ids,
      caption: caption.trim(),
      fallbackCenter: center,
      // snapshot text so the step survives later edits/deletions
      snapshot: ids
        .map((id) => {
          const it = itemsRef.current.find((i) => i.id === id);
          if (it?.type === "text") return (it.text || "").slice(0, 300);
          if (it?.type === "image") return "[image]";
          if (it?.type === "stroke") return "[drawing]";
          return "";
        })
        .filter(Boolean),
      ts: Date.now(),
    };
    setRecording((r) => (r ? { ...r, steps: [...r.steps, step] } : r));
    showToast(`${pathVerb(kind).glyph} ${pathVerb(kind).label} · step ${rec.steps.length + 1}`);
  }
  recordStepRef.current = recordStep;

  function updateRecordedStep(stepId, patch) {
    setRecording((r) =>
      r ? { ...r, steps: r.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) } : r
    );
  }

  function removeRecordedStep(stepId) {
    setRecording((r) => (r ? { ...r, steps: r.steps.filter((s) => s.id !== stepId) } : r));
  }

  function finishRecordingPath(title) {
    const rec = recordingRef.current;
    if (!rec) return;
    if (!rec.steps.length) {
      setRecording(null);
      showToast("path discarded — no steps");
      return;
    }
    const firstText = rec.steps.flatMap((s) => s.snapshot || []).find((t) => t && !t.startsWith("["));
    const path = {
      id: rec.pathId,
      title: (title || "").trim() || (firstText ? firstText.split("\n")[0].slice(0, 44) : "untitled path"),
      steps: rec.steps,
      branchOf: rec.branchOf,
      createdAt: Date.now(),
      walks: 0,
    };
    setPaths((arr) => [path, ...arr]);
    setRecording(null);
    setRailTab("paths");
    showToast(`path saved · ${path.steps.length} steps`);
  }

  function discardRecording() {
    setRecording(null);
    showToast("recording discarded");
  }

  function deletePath(id) {
    setPaths((arr) => arr.filter((p) => p.id !== id));
    if (walkingRef.current?.pathId === id) setWalking(null);
  }

  function beginWalk(pathId) {
    const path = pathsRef.current.find((p) => p.id === pathId);
    if (!path?.steps?.length) return;
    finishEditing();
    setSelection([]);
    setRecording(null);
    setPaths((arr) => arr.map((p) => (p.id === pathId ? { ...p, walks: (p.walks || 0) + 1 } : p)));
    setWalking({ pathId, stepIndex: 0 });
  }

  function walkTo(stepIndex) {
    const w = walkingRef.current;
    if (!w) return;
    const path = pathsRef.current.find((p) => p.id === w.pathId);
    if (!path) return;
    const idx = clamp(stepIndex, 0, path.steps.length - 1);
    setWalking({ ...w, stepIndex: idx });
  }

  function endWalk() {
    setWalking(null);
  }

  function branchFromWalk() {
    const w = walkingRef.current;
    if (!w) return;
    const path = pathsRef.current.find((p) => p.id === w.pathId);
    if (!path) return;
    const inherited = path.steps.slice(0, w.stepIndex + 1).map((s) => ({ ...s, id: uid() }));
    setWalking(null);
    beginRecordingPath({ pathId: path.id, stepIndex: w.stepIndex, inheritedSteps: inherited });
  }

  // camera follows the walk
  useEffect(() => {
    if (!walking) return;
    const path = paths.find((p) => p.id === walking.pathId);
    const step = path?.steps?.[walking.stepIndex];
    if (!step) return;
    const focus = stepFocusCenter(step);
    if (focus) animateCameraTo(focus, stepFocusScale(focus));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walking?.pathId, walking?.stepIndex]);

  // keyboard navigation while walking
  useEffect(() => {
    if (!walking) return;
    function onKey(e) {
      const typing = e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName || "");
      if (typing) return;
      if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") {
        e.preventDefault();
        const path = pathsRef.current.find((p) => p.id === walkingRef.current?.pathId);
        const w = walkingRef.current;
        if (path && w && w.stepIndex >= path.steps.length - 1) endWalk();
        else walkTo((w?.stepIndex ?? 0) + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        walkTo((walkingRef.current?.stepIndex ?? 0) - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        endWalk();
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        branchFromWalk();
      }
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!walking]);

  function exportPath(path) {
    const blob = JSON.stringify({ kind: "lens-path", version: 1, path, items: itemsRef.current.filter((it) => path.steps.some((s) => s.itemIds?.includes(it.id))) }, null, 2);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([blob], { type: "application/json" }));
    a.download = `path-${(path.title || "untitled").replace(/\s+/g, "-").slice(0, 32)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("path exported — send someone your seeing");
  }

  function importPath(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (data?.kind !== "lens-path" || !data.path?.steps?.length) throw new Error("not a path");
        const idMap = {};
        const newItems = (data.items || [])
          .filter((it) => !itemsRef.current.some((ex) => ex.id === it.id))
          .map((it) => {
            const nid = uid();
            idMap[it.id] = nid;
            return normalizeItem({ ...it, id: nid });
          });
        // remap step item ids to the newly planted copies (keep ids that already exist)
        const steps = data.path.steps.map((s) => ({
          ...s,
          id: uid(),
          itemIds: (s.itemIds || []).map((id) => idMap[id] || id),
        }));
        if (newItems.length) setItems((arr) => [...arr, ...newItems]);
        const path = { ...data.path, id: uid(), steps, importedAt: Date.now(), walks: 0 };
        setPaths((arr) => [path, ...arr]);
        setRailTab("paths");
        showToast(`path received · ${steps.length} steps — walk it`);
      } catch {
        showToast("could not read that path file");
      }
    };
    reader.readAsText(file);
  }

  // ---- saved idea structures ----
  function saveSelectionByIds(ids, extra = {}) {
    if (!ids?.length) {
      showToast("select material to save");
      return null;
    }
    const idSet = new Set(ids);
    const sel = itemsRef.current.filter((it) => idSet.has(it.id));
    if (!sel.length) {
      showToast("nothing to save");
      return null;
    }
    const bb = selectionWorldBBoxForIds(ids);
    const anchor = bb ? { x: bb.minx, y: bb.miny } : viewportCenterWorld();
    const relativeItems = sel.map((it) => {
      const base = { ...it, id: uid() };
      if (it.type === "stroke") {
        return { ...base, points: it.points.map((p) => ({ x: p.x - anchor.x, y: p.y - anchor.y })) };
      }
      return { ...base, x: it.x - anchor.x, y: it.y - anchor.y };
    });
    const titleFromText = sel
      .filter((it) => it.type === "text" && it.text?.trim())
      .map((it) => it.text.trim().split("\n")[0].slice(0, 48))
      .join(" · ");
    const struct = {
      id: uid(),
      title: extra.title || titleFromText || "untitled",
      kind: extra.kind || "idea",
      structNum: extra.structNum || null,
      items: relativeItems,
      savedAt: Date.now(),
    };
    setStructures((arr) => [struct, ...arr]);
    setRailTab("structures");
    showToast(extra.toast || "saved structure");
    return struct;
  }

  function captureSelectionAsStructure(extra = {}) {
    return saveSelectionByIds(selRef.current, extra);
  }

  function pinOpToToolbox(opId) {
    const op = opMap[opId];
    if (!op) return;
    if (op.top && topFunctions.some((f) => f.id === opId)) {
      showToast("already in toolbox");
      return;
    }
    const tree = opToJsonTree(op, opMap);
    if (!tree) return;
    const { ops } = treeToOperators(tree, { role: op.role || null, top: true });
    setOperators((prev) => [...prev, ...ops]);
    setRailTab("functions");
    showToast(`saved · ${op.name}`);
  }

  function deleteStructure(id) {
    setStructures((arr) => arr.filter((s) => s.id !== id));
  }

  function plantStructure(struct, atWorld) {
    if (!struct?.items?.length) return;
    const center = atWorld || viewportCenterWorld();
    const newIds = [];
    const newItems = struct.items.map((it) => {
      const id = uid();
      newIds.push(id);
      if (it.type === "stroke") {
        return normalizeItem({
          ...it,
          id,
          points: it.points.map((p) => ({ x: p.x + center.x, y: p.y + center.y })),
        });
      }
      return normalizeItem({ ...it, id, x: it.x + center.x, y: it.y + center.y });
    });
    setItems((arr) => [...arr, ...newItems]);
    setSelection(newIds);
    showToast(`planted · ${struct.title || "structure"}`);
  }

  function applyStructureDrop(structId, atClient) {
    const struct = structures.find((s) => s.id === structId);
    if (!struct) return;
    const at = atClient ? clientToWorld(atClient.x, atClient.y) : viewportCenterWorld();
    plantStructure(struct, at);
  }

  async function runSamenessDiscovery() {
    const ids = selRef.current;
    const idSet = new Set(ids);
    const nodes = itemsRef.current.filter((it) => idSet.has(it.id) && ((it.type === "text" && it.text?.trim()) || it.type === "image"));
    if (nodes.length < 2) {
      showToast("select at least two items");
      return;
    }
    const labels = nodes.map((n) =>
      n.type === "text" ? n.text.trim() : "[image]"
    );
    const jobId = pushJob({ label: "discover sameness", kind: "sameness", status: "running", step: "starting…", startedAt: Date.now(), estimatedMs: ETA.sameness });
    try {
      patchJob(jobId, { status: "running", step: "finding shared structure" });
      const out = await runClaude(samenessPrompt(labels), "", { system: boardSystem(operators, opMap), maxTokens: 2000 });
      const parsed = parseSameness(out);
      const num = nextStructNumber();
      const title = `#${num} · ${parsed.name}`;
      const center = viewportCenterWorld();
      const body = `${parsed.name.toUpperCase()}\n\n${parsed.body}`;
      spawnNewObject(body, nodes.map((n) => n.id), center);
      const struct = {
        id: uid(),
        title,
        kind: "structure",
        structNum: num,
        items: [normalizeItem({ type: "text", x: 0, y: 0, text: body, w: 420 })],
        savedAt: Date.now(),
      };
      setStructures((arr) => [struct, ...arr]);
      setRailTab("structures");
      finishJob(jobId, "done");
      showToast(`discovered · ${title}`);
    } catch (err) {
      finishJob(jobId, "error", err.message || "discovery failed");
      showToast(err.message || "discovery failed");
    }
  }

  const topFunctions = operators.filter((o) => o.top);
  const primitives = useMemo(() => {
    const byName = Object.fromEntries(
      operators.filter((o) => o.primitive && !o.role && !o.top).map((o) => [o.name, o])
    );
    return TRANSFORM_PRIMITIVES.map((t) => byName[t.name] || t);
  }, [operators]);
  const basics = operators.filter((o) => !o.role && !o.top && !o.primitive);
  const selectionQuickOps = primitives;

  function plantStarterThought() {
    pushHistory();
    const c = viewportCenterWorld();
    const id = uid();
    const text = "The father runs to the prodigal son.";
    setItems([
      normalizeItem({
        id,
        type: "text",
        x: c.x - 160,
        y: c.y - 36,
        text,
        w: 360,
      }),
    ]);
    setSelection([id]);
    setTool("highlight");
    showToast("draw over the text with the highlighter");
  }

  function itemScreenBBox(it) {
    if (it.type === "stroke") {
      const xs = it.points.map((p) => worldToClient(p.x, p.y).x);
      const ys = it.points.map((p) => worldToClient(p.x, p.y).y);
      return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    }
    const el = document.querySelector(`[data-item="${it.id}"]`);
    if (!el) {
      const p = worldToClient(it.x, it.y);
      return { left: p.x, top: p.y, right: p.x + 10, bottom: p.y + 10 };
    }
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  function itemAtPoint(cx, cy, excludeIds = null) {
    const list = itemsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
      if (it.type === "link") continue;
      if (excludeIds?.has(it.id)) continue;
      if (it.type === "stroke") {
        for (let k = 1; k < it.points.length; k++) {
          const a = worldToClient(it.points[k - 1].x, it.points[k - 1].y);
          const b = worldToClient(it.points[k].x, it.points[k].y);
          if (distToSeg(cx, cy, a.x, a.y, b.x, b.y) <= Math.max(8, it.width * camRef.current.scale * 0.7)) return it;
        }
      } else {
        const bb = itemScreenBBox(it);
        if (cx >= bb.left && cx <= bb.right && cy >= bb.top && cy <= bb.bottom) return it;
      }
    }
    return null;
  }

  function resolveTargetIds(atClient) {
    const sel = selRef.current;
    if (sel.length > 1 && atClient) {
      const hit = itemAtPoint(atClient.x, atClient.y);
      if (hit && sel.includes(hit.id)) return sel;
      return sel;
    }
    if (!atClient) return sel.length ? sel : [];
    const hit = itemAtPoint(atClient.x, atClient.y);
    if (!hit) return [];
    const it = itemsRef.current.find((i) => i.id === hit.id);
    if (it?.groupId) {
      return itemsRef.current.filter((i) => i.groupId === it.groupId).map((i) => i.id);
    }
    return [hit.id];
  }

  function selectionWorldBBoxForIds(itemIds) {
    const ids = new Set(itemIds || []);
    const sel = itemsRef.current.filter((it) => ids.has(it.id));
    if (!sel.length) return null;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const it of sel) {
      const bb = itemScreenBBox(it);
      const a = clientToWorld(bb.left, bb.top);
      const b = clientToWorld(bb.right, bb.bottom);
      minx = Math.min(minx, a.x);
      miny = Math.min(miny, a.y);
      maxx = Math.max(maxx, b.x);
      maxy = Math.max(maxy, b.y);
    }
    return { minx, miny, maxx, maxy };
  }

  function selectionWorldBBox() {
    return selectionWorldBBoxForIds(selRef.current);
  }

  function eraseAtPointer(cx, cy) {
    const hits = highlightErasureHits(
      itemsRef.current,
      cx,
      cy,
      null,
      null,
      camRef.current.scale,
      worldToClient,
      null
    );
    for (const it of itemsRef.current) {
      if (it.type !== "text") continue;
      const bb = clientBoundsForItem(it, worldToClient);
      if (!bb) continue;
      const pad = Math.max(14, HIGHLIGHT_W * camRef.current.scale * 0.52);
      if (cx >= bb.left - pad && cx <= bb.right + pad && cy >= bb.top - pad && cy <= bb.bottom + pad) {
        hits.push(it.id);
      }
    }
    const uniq = [...new Set(hits)];
    if (!uniq.length) return false;
    pushHistory();
    setItems((arr) => arr.filter((it) => !uniq.includes(it.id)));
    setHighlight((hl) => (hl && uniq.includes(hl.itemId) ? null : hl));
    setSelection((sel) => sel.filter((id) => !uniq.includes(id)));
    return true;
  }
  eraseAtPointerRef.current = eraseAtPointer;

  // ---- pointer gestures on the board ----
  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest?.(".branch-nub")) return;
    setExpandPulse(null);
    setGesturing(true);
    const cx = e.clientX;
    const cy = e.clientY;
    lastPointerRef.current = { cx, cy };
    const panning = toolRef.current === "hand";
    const t = toolRef.current;

    finishEditing();

    const w = clientToWorld(cx, cy);
    const lp = vpLocal(cx, cy);

    if (panning) {
      gesture.current = { mode: "pan", cx, cy, cam: { ...camRef.current } };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }

    if (t === "image") {
      if (pendingImageRef.current) {
        placeArmedImage(w);
        return;
      }
      pickImage();
      return;
    }

    if (t === "pen" || t === "marker" || t === "highlight" || t === "eraser" || t === "text") {
      pushHistory();
    }

    if (t === "pen" || t === "marker") {
      gesture.current = { mode: "draw", marker: t === "marker", points: [w] };
      setDraft({ points: [w], marker: t === "marker" });
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }

    if (t === "highlight") {
      gesture.current = {
        mode: "draw",
        highlight: true,
        points: [w],
        deletedIds: new Set(),
        lastCx: cx,
        lastCy: cy,
      };
      setDraft({ points: [w], highlight: true });
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }

    if (t === "eraser") {
      gesture.current = { mode: "erase" };
      const hit = itemAtPoint(cx, cy);
      if (hit) setItems((arr) => arr.filter((it) => it.id !== hit.id));
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }

    if (t === "text") {
      const id = uid();
      setItems((arr) => [...arr, normalizeItem({ id, type: "text", x: w.x, y: w.y, text: "", w: 360 })]);
      setSelection([id]);
      setEditing(id);
      setTool("select");
      return;
    }

    const hit = itemAtPoint(cx, cy);
    if (hit) {
      const already = selRef.current.includes(hit.id);
      const nextSel = e.shiftKey
        ? already
          ? selRef.current.filter((id) => id !== hit.id)
          : [...selRef.current, hit.id]
        : already
        ? selRef.current
        : [hit.id];
      setSelection(nextSel);
      gesture.current = { mode: "pending", cx, cy, ids: nextSel, hitId: hit.id };
    } else {
      if (!e.shiftKey) setSelection([]);
      gesture.current = { mode: "lasso", x0: lp.x, y0: lp.y, x1: lp.x, y1: lp.y };
      setLasso({ x0: lp.x, y0: lp.y, x1: lp.x, y1: lp.y });
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function startHandleGesture(e, mode, payload) {
    e.stopPropagation();
    e.preventDefault();
    pushHistory();
    gesture.current = { mode, cx: e.clientX, cy: e.clientY, ...payload };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  // ---- text editing ----
  function commitEdit(id, text) {
    const clean = (text || "").replace(/\u00a0/g, " ");
    if (!clean.trim()) {
      setItems((arr) => arr.filter((it) => it.id !== id));
    } else {
      updateItem(id, { text: clean });
    }
    setEditing(null);
  }

  // ---- images ----
  async function addImage(file, at) {
    try {
      pushHistory();
      const { src, w, h } = await fileToImage(file);
      const center = at || viewportCenterWorld();
      const scale = Math.min(1, 260 / w);
      const id = uid();
      setItems((arr) => [...arr, normalizeItem({ id, type: "image", x: center.x, y: center.y, w: Math.round(w * scale), h: Math.round(h * scale), src, rotation: 0, scale: 1 })]);
      setSelection([id]);
    } catch {
      showToast("could not load that image");
    }
  }
  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      if (!input.files?.[0]) return;
      pendingImageRef.current = input.files[0];
      setImageArmed(true);
      setTool("image");
      showToast("click on the canvas to place the image");
    };
    input.click();
  }

  function placeArmedImage(atWorld) {
    const file = pendingImageRef.current;
    if (!file) return;
    pendingImageRef.current = null;
    setImageArmed(false);
    addImage(file, atWorld);
    setTool("select");
  }

  // hover: wake a note's tendrils so you can grab a thought anywhere and continue it
  function onHoverMove(e) {
    if (toolRef.current !== "select" || gesture.current || editingRef.current || walkingRef.current) {
      if (hoverIdRef.current) setHoverId(null);
      return;
    }
    const cx = e.clientX;
    const cy = e.clientY;
    if (hoverRafRef.current) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const hit = itemAtPoint(cx, cy);
      const id = hit && isNoteItem(hit) ? hit.id : null;
      if (id !== hoverIdRef.current) setHoverId(id);
    });
  }

  // double-click: branch compass on notes, edit empty notes, write on blank paper
  function onDoubleClick(e) {
    const t = toolRef.current;
    if (t !== "select" && t !== "text") return;
    finishEditing();
    const hit = itemAtPoint(e.clientX, e.clientY);
    if (hit?.type === "text") {
      const it = itemsRef.current.find((i) => i.id === hit.id);
      if (!it?.text?.trim()) {
        setSelection([hit.id]);
        setEditing(hit.id);
        return;
      }
      setSelection([hit.id]);
      setExpandPulse(hit.id);
      return;
    }
    if (hit?.type === "image") {
      setSelection([hit.id]);
      setExpandPulse(hit.id);
      return;
    }
    const w = clientToWorld(e.clientX, e.clientY);
    const id = uid();
    setItems((arr) => [...arr, normalizeItem({ id, type: "text", x: w.x, y: w.y, text: "", w: 320 })]);
    setSelection([id]);
    setEditing(id);
  }

  // ---- export / object helpers ----
  function spawnNewObject(text, sourceIds, atWorld) {
    const clean = stripMd(text || "").trim();
    if (!clean) return null;
    const idSet = new Set(sourceIds || []);
    const sel = itemsRef.current.filter((it) => idSet.has(it.id));
    const boxes = sel.map(itemWorldBBox).filter(Boolean);
    let x;
    let y;
    if (atWorld) {
      x = atWorld.x;
      y = atWorld.y;
    } else if (boxes.length) {
      x = Math.max(...boxes.map((b) => b.maxx)) + 48;
      y = Math.min(...boxes.map((b) => b.miny));
    } else {
      const c = viewportCenterWorld();
      x = c.x;
      y = c.y;
    }
    const id = uid();
    const w = Math.min(560, Math.max(280, Math.round(clean.length * 0.5 + 200)));
    const item = normalizeItem({ id, type: "text", x, y, text: clean, w, bornFrom: sourceIds || [] });
    setItems((arr) => [...arr, item]);
    setSelection([id]);
    return id;
  }

  function applyTransformResult(out, sourceIds, atWorld) {
    pushHistory();
    spawnNewObject(out, sourceIds, atWorld);
  }

  function runHighlightPrimitive(op, hl) {
    if (op.needsSelection >= 2) {
      const others = selRef.current.filter((id) => id !== hl.itemId);
      if (!others.length) {
        showToast("select another idea first, then highlight for merge");
        return;
      }
    }
    window.getSelection()?.removeAllRanges();
    removeHighlightStroke(hl.strokeId);
    setHighlight(null);
    const ids =
      op.needsSelection >= 2
        ? [hl.itemId, ...selRef.current.filter((id) => id !== hl.itemId)]
        : [hl.itemId];
    const atClient = { x: hl.rect.left + hl.rect.width / 2, y: hl.rect.bottom + 12 };
    runOperator(op, ids, {
      atClient,
      highlightQuote: hl.quote,
      highlightContext: hl.context,
    });
  }

  async function combineItemsByDrag(draggedIds, targetIds) {
    const ids = [...new Set([...draggedIds, ...targetIds])];
    const mergeOp = operators.find((o) => o.name === "merge" && o.primitive) || TRANSFORM_PRIMITIVES.find((o) => o.name === "merge");
    runOperator(mergeOp, ids, {});
  }
  combineRef.current = combineItemsByDrag;

  function materialFromItemsForExport(itemList) {
    const parts = [];
    for (const it of itemList) {
      if (it.type === "text" && it.text?.trim()) parts.push({ kind: "text", content: it.text.trim() });
      else if (it.type === "image" && it.src) parts.push({ kind: "image", content: it.src, alt: "image" });
      else if (it.type === "stroke") parts.push({ kind: "stroke", content: "[drawing on canvas]" });
    }
    return parts;
  }

  function exportSelection(format) {
    const ids = selRef.current;
    const itemList = ids.length
      ? itemsRef.current.filter((it) => ids.includes(it.id))
      : itemsRef.current.filter((it) => (it.type === "text" && it.text?.trim()) || it.type === "image" || it.type === "stroke");
    if (!itemList.length) {
      showToast("nothing to export");
      return;
    }
    const parts = materialFromItemsForExport(itemList);
    const plain = parts.map((p) => (p.kind === "text" ? p.content : p.content)).join("\n\n---\n\n");
    const title = `lens-export-${new Date().toISOString().slice(0, 10)}`;
    const download = (name, blob, mime) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([blob], { type: mime }));
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    if (format === "txt") {
      download(`${title}.txt`, plain, "text/plain;charset=utf-8");
    } else if (format === "md") {
      const md = parts
        .map((p) => {
          if (p.kind === "text") return p.content;
          if (p.kind === "image") return `![image](${p.content})`;
          return p.content;
        })
        .join("\n\n---\n\n");
      download(`${title}.md`, md, "text/markdown;charset=utf-8");
    } else if (format === "doc") {
      const html = buildExportHtml(parts, title);
      download(`${title}.doc`, html, "application/msword");
    } else if (format === "pdf") {
      openPrintExport(parts, title);
    }
    showToast(`exported · ${format}`);
  }

  function buildExportHtml(parts, title) {
    const body = parts
      .map((p) => {
        if (p.kind === "text") return `<p style="white-space:pre-wrap;font-family:Georgia,serif;line-height:1.5">${escapeHtml(p.content).replace(/\n/g, "<br>")}</p>`;
        if (p.kind === "image") return `<p><img src="${p.content}" style="max-width:100%;height:auto" alt="image"/></p>`;
        return `<p><em>${p.content}</em></p>`;
      })
      .join("<hr/>");
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="max-width:720px;margin:40px auto;padding:0 24px;color:#20201d">${body}</body></html>`;
  }

  function openPrintExport(parts, title) {
    const html = buildExportHtml(parts, title);
    const w = window.open("", "_blank");
    if (!w) {
      showToast("allow popups to export PDF");
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  // ---- render ----
  const selBBox = selection.length ? selectionWorldBBox() : null;
  const selItem = selection.length === 1 ? items.find((it) => it.id === selection[0]) : null;
  const canTransform = selItem && (selItem.type === "text" || selItem.type === "image");
  const hoverItem = hoverId ? items.find((it) => it.id === hoverId) : null;
  const branchTarget =
    tool === "select" && !editing && !highlight && !walking
      ? (selItem && isNoteItem(selItem) ? selItem : hoverItem && isNoteItem(hoverItem) ? hoverItem : null)
      : null;
  const boardLinks = items.filter((it) => it.type === "link");
  const walkPath = walking ? paths.find((p) => p.id === walking.pathId) : null;
  const walkStep = walkPath?.steps?.[walking.stepIndex] || null;
  const walkFocusRects = walkStep
    ? walkStep.itemIds
        .map((id) => items.find((it) => it.id === id))
        .filter(Boolean)
        .map((it) => itemScreenBBox(it))
    : [];
  const selScreenBBox = selBBox && selection.length ? (() => {
    const ids = new Set(selection);
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const it of items.filter((i) => ids.has(i.id))) {
      const bb = itemScreenBBox(it);
      left = Math.min(left, bb.left);
      top = Math.min(top, bb.top);
      right = Math.max(right, bb.right);
      bottom = Math.max(bottom, bb.bottom);
    }
    return { left, top, right, bottom, cx: (left + right) / 2 };
  })() : null;
  const aiMenuPos = selScreenBBox && !editing && !gesturing
    ? {
        x: clamp(selScreenBBox.cx, RAIL_W + 120, window.innerWidth - 120),
        y: selScreenBBox.top < 100 ? selScreenBBox.bottom + 14 : selScreenBBox.top - 14,
        below: selScreenBBox.top < 100,
      }
    : null;
  const cursorClass =
    tool === "hand"
      ? "cur-grab"
      : tool === "highlight"
      ? "cur-highlight"
      : tool === "text"
      ? "cur-text"
      : tool === "pen" || tool === "marker"
      ? "cur-draw"
      : tool === "eraser"
      ? "cur-erase"
      : "cur-select";

  function itemCenter(it) {
    const w = itemWidth(it) * (it.scale ?? 1);
    const h = itemHeight(it) * (it.scale ?? 1);
    return { x: it.x + w / 2, y: it.y + h / 2 };
  }

  return (
    <div className="board-app">
      {/* left rail: draggable transformations */}
      <aside
        className={"board-rail" + (railDropOver ? " drop-over" : "")}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(OP_MIME) ||
            e.dataTransfer.types.includes(STRUCT_MIME) ||
            e.dataTransfer.types.includes(SEL_MIME)
          ) {
            e.preventDefault();
            setRailDropOver(true);
            e.dataTransfer.dropEffect = "copy";
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setRailDropOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setRailDropOver(false);
          const selJson = e.dataTransfer.getData(SEL_MIME);
          if (selJson) {
            try {
              saveSelectionByIds(JSON.parse(selJson));
            } catch {
              /* ignore bad payload */
            }
            return;
          }
          const opId = e.dataTransfer.getData(OP_MIME);
          if (opId) {
            pinOpToToolbox(opId);
            return;
          }
          const structId = e.dataTransfer.getData(STRUCT_MIME);
          if (structId) {
            setRailTab("structures");
            showToast("already saved");
          }
        }}
      >
        <div className="rail-head">
          <div className="rail-title">lens</div>
          <button className="rail-icon" title="set up for role" onClick={() => setOnboard({ step: "role" })}>
            ↻
          </button>
        </div>
        <div className="rail-tabs">
          <button className={"rail-tab" + (railTab === "functions" ? " on" : "")} onClick={() => setRailTab("functions")}>
            functions
          </button>
          <button className={"rail-tab" + (railTab === "structures" ? " on" : "")} onClick={() => setRailTab("structures")}>
            structures {structures.length ? `(${structures.length})` : ""}
          </button>
          <button className={"rail-tab" + (railTab === "paths" ? " on" : "")} onClick={() => setRailTab("paths")}>
            paths {paths.length ? `(${paths.length})` : ""}
          </button>
        </div>
        {railTab === "paths" ? (
          <>
            <button
              className="rail-create"
              disabled={!!recording}
              onClick={() => beginRecordingPath()}
              title="record a sequence of attention others can walk"
            >
              {recording ? "recording…" : "◉ begin a path"}
            </button>
            <button
              className="rail-create ghost"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "application/json";
                input.onchange = () => input.files?.[0] && importPath(input.files[0]);
                input.click();
              }}
            >
              ↓ receive a path
            </button>
            <div className="rail-scroll">
              {paths.length === 0 && !recording ? (
                <p className="rail-empty">
                  A path is not a note — it's a walk. Record where you attended, what you noticed, where
                  you lingered. Someone else walks it and arrives with their perception changed.
                </p>
              ) : (
                paths.map((p) => (
                  <PathCard
                    key={p.id}
                    path={p}
                    parent={p.branchOf ? paths.find((x) => x.id === p.branchOf.pathId) : null}
                    onWalk={() => beginWalk(p.id)}
                    onExport={() => exportPath(p)}
                    onDelete={() => deletePath(p.id)}
                  />
                ))
              )}
            </div>
          </>
        ) : railTab === "functions" ? (
          <>
            <button className="rail-create" onClick={openCreateFunction}>
              + function
            </button>
            <div className="rail-scroll">
              {topFunctions.length > 0 && (
                <>
                  <div className="rail-section">yours</div>
                  {topFunctions.map((op) => (
                    <DraggableOpCard
                      key={op.id}
                      op={op}
                      opMap={opMap}
                      expanded={expanded}
                      onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                      onEdit={openEditFunction}
                    />
                  ))}
                </>
              )}
              {primitives.length > 0 && (
                <>
                  <div className="rail-section">primitives</div>
                  {primitives.map((op) => (
                    <DraggableOpCard
                      key={op.id}
                      op={op}
                      opMap={opMap}
                      expanded={expanded}
                      onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                      onEdit={openEditFunction}
                      flat
                    />
                  ))}
                </>
              )}
              {basics.length > 0 && (
                <>
                  <div className="rail-section">basics</div>
                  {basics.map((op) => (
                    <DraggableOpCard
                      key={op.id}
                      op={op}
                      opMap={opMap}
                      expanded={expanded}
                      onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                      onEdit={openEditFunction}
                      flat
                    />
                  ))}
                </>
              )}
              {basics.length === 0 && topFunctions.length === 0 && primitives.length === 0 && (
                <p className="rail-empty">Tap ↻ to generate functions for your role.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <button
              className="rail-create"
              disabled={!selection.length}
              onClick={() => captureSelectionAsStructure()}
            >
              + save selection
            </button>
            <div className="rail-scroll">
              {structures.length === 0 ? (
                <p className="rail-empty">Save selections from the canvas, or discover structures via sameness.</p>
              ) : (
                structures.map((struct) => (
                  <StructureCard
                    key={struct.id}
                    struct={struct}
                    onDelete={() => deleteStructure(struct.id)}
                  />
                ))
              )}
            </div>
          </>
        )}
        <JobPanel jobs={jobs} onDismiss={(id) => setJobs((j) => j.filter((x) => x.id !== id))} />
        {railTab === "functions" && (
          <div className="rail-hint">drag onto canvas to run · drop here to save</div>
        )}
        {railTab === "structures" && (
          <div className="rail-hint">drop selection here to save · drag onto canvas to plant</div>
        )}
        {railTab === "paths" && (
          <div className="rail-hint">walk a path · press b mid-walk to branch it</div>
        )}
      </aside>

      <div className={"board-main" + (dropReady ? " drop-ready" : "") + (editing ? " editing-text" : "")}>
      <div
        ref={viewportRef}
        className="viewport"
        onPointerDown={
          editing
            ? (e) => {
                if (!e.target.closest?.(".board-text.editing")) finishEditing();
              }
            : undefined
        }
      >
        <div
          className="world"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
          {/* branch arrows between notes */}
          <svg className="link-layer" style={{ overflow: "visible" }}>
            <defs>
              <marker
                id="board-link-arrow"
                markerWidth="9"
                markerHeight="9"
                refX="8"
                refY="4.5"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L9,4.5 L0,9 Z" fill={INK} fillOpacity="0.55" />
              </marker>
            </defs>
            {boardLinks.map((link) => {
              const from = items.find((i) => i.id === link.fromId);
              const to = items.find((i) => i.id === link.toId);
              if (!from || !to) return null;
              const dirId = link.fromDir || inferLinkDir(from, to);
              const a = branchAnchor(from, dirId);
              const b = linkEndpoint(to, a);
              return (
                <path
                  key={link.id}
                  d={linkCurvePath(a, b)}
                  className="board-link"
                  fill="none"
                  stroke={INK}
                  strokeWidth={1.6}
                  strokeOpacity={0.42}
                  strokeLinecap="round"
                  markerEnd="url(#board-link-arrow)"
                />
              );
            })}
            {linkDraft && (
              <path
                d={linkCurvePath(
                  { x: linkDraft.fromX, y: linkDraft.fromY },
                  { x: linkDraft.toX, y: linkDraft.toY }
                )}
                className="board-link draft"
                fill="none"
                stroke={INK}
                strokeWidth={1.8}
                strokeOpacity={0.65}
                strokeDasharray="6 5"
                strokeLinecap="round"
                markerEnd="url(#board-link-arrow)"
              />
            )}
          </svg>

          {/* committed strokes */}
          <svg className="ink-layer" style={{ overflow: "visible" }}>
            {items
              .filter((it) => it.type === "stroke")
              .map((it) => (
                <polyline
                  key={it.id}
                  data-item={it.id}
                  points={it.points.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={it.highlight ? HIGHLIGHT_INK : it.color}
                  strokeWidth={it.width}
                  strokeOpacity={it.highlight ? 0.72 : it.marker ? 0.32 : 0.95}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={(selection.includes(it.id) ? "sel" : "") + (it.highlight ? " hl-stroke" : "")}
                />
              ))}
            {draft && draft.points.length >= 1 && (
              <>
                {draft.points.length === 1 ? (
                  <circle
                    className="draft-dot"
                    cx={draft.points[0].x}
                    cy={draft.points[0].y}
                    r={draft.highlight ? HIGHLIGHT_W / 2 : draft.marker ? MARKER_W / 2 : PEN_W}
                    fill={draft.highlight ? HIGHLIGHT_INK : INK}
                    fillOpacity={draft.highlight ? 0.72 : draft.marker ? 0.32 : 0.95}
                  />
                ) : (
                  <>
                    <polyline
                      className={
                        "draft-stroke" +
                        (draft.highlight ? " hl-stroke" : "") +
                        (draft.loop ? " hl-loop" : "")
                      }
                      points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")}
                      fill={draft.loop ? "rgba(32, 32, 29, 0.05)" : "none"}
                      stroke={draft.loop ? "var(--ink)" : draft.highlight ? HIGHLIGHT_INK : INK}
                      strokeWidth={draft.highlight ? HIGHLIGHT_W : draft.marker ? MARKER_W : PEN_W}
                      strokeOpacity={draft.loop ? 0.4 : draft.highlight ? 0.72 : draft.marker ? 0.32 : 0.95}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    {draft.loop && draft.points.length > 2 && (
                      <line
                        className="hl-loop-close"
                        x1={draft.points[draft.points.length - 1].x}
                        y1={draft.points[draft.points.length - 1].y}
                        x2={draft.points[0].x}
                        y2={draft.points[0].y}
                        stroke="var(--ink)"
                        strokeWidth={1.5}
                        strokeOpacity={0.35}
                        strokeDasharray="6 4"
                      />
                    )}
                  </>
                )}
              </>
            )}
          </svg>

          {/* text + images */}
          {items
            .filter((it) => it.type !== "stroke")
            .map((it) =>
              it.type === "image" ? (
                <img
                  key={it.id}
                  data-item={it.id}
                  className={"board-img" + (selection.includes(it.id) ? " sel" : "") + (dropTargetId === it.id ? " drop-target" : "")}
                  src={it.src}
                  style={{ ...itemStyle(it), width: it.w, height: it.h }}
                  draggable={selection.includes(it.id)}
                  onDragStart={(e) => selection.includes(it.id) && startSelectionDrag(e, [it.id])}
                  alt=""
                />
              ) : (
                <BoardText
                  key={it.id}
                  item={it}
                  selected={selection.includes(it.id)}
                  dropTarget={dropTargetId === it.id}
                  editing={editing === it.id}
                  onCommit={(text) => commitEdit(it.id, text)}
                  onDragStart={(e) => startSelectionDrag(e, [it.id])}
                />
              )
            )}

          {/* selection box */}
          {selBBox && selection.length > 0 && !canTransform && (
            <div
              className="sel-box"
              style={{
                left: selBBox.minx - 10,
                top: selBBox.miny - 10,
                width: selBBox.maxx - selBBox.minx + 20,
                height: selBBox.maxy - selBBox.miny + 20,
              }}
            >
              <div
                className="sel-drag"
                draggable
                onDragStart={(e) => startSelectionDrag(e, selection)}
                title="drag to toolbox to save"
              >
                ⠿
              </div>
            </div>
          )}
        </div>

        {/* live lasso (viewport-local space) */}
        {lasso && (
          <div
            className="lasso"
            style={{
              left: Math.min(lasso.x0, lasso.x1),
              top: Math.min(lasso.y0, lasso.y1),
              width: Math.abs(lasso.x1 - lasso.x0),
              height: Math.abs(lasso.y1 - lasso.y0),
            }}
          />
        )}
      </div>

      {/* dedicated input surface — all canvas tools attach here */}
      <div
        ref={inputLayerRef}
        className={"canvas-input-layer " + cursorClass}
        onPointerDown={onPointerDown}
        onPointerMove={onHoverMove}
        onPointerLeave={() => hoverIdRef.current && setHoverId(null)}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(OP_MIME) ||
            e.dataTransfer.types.includes(STRUCT_MIME) ||
            e.dataTransfer.types.includes("Files")
          ) {
            e.preventDefault();
            setDropReady(true);
            if (e.dataTransfer.types.includes(OP_MIME)) {
              e.dataTransfer.dropEffect = "copy";
              const hit = itemAtPoint(e.clientX, e.clientY);
              setDropTargetId(hit?.id || null);
            }
          }
        }}
        onDragLeave={() => {
          setDropReady(false);
          setDropTargetId(null);
        }}
        onDrop={(e) => {
          setDropReady(false);
          setDropTargetId(null);
          e.preventDefault();
          const opId = e.dataTransfer.getData(OP_MIME);
          if (opId) {
            applyOpDrop(opId, { x: e.clientX, y: e.clientY });
            return;
          }
          const structId = e.dataTransfer.getData(STRUCT_MIME);
          if (structId) {
            applyStructureDrop(structId, { x: e.clientX, y: e.clientY });
            return;
          }
          if (e.dataTransfer.files?.length) {
            const w = clientToWorld(e.clientX, e.clientY);
            addImage(e.dataTransfer.files[0], w);
          }
        }}
      />

      {/* screen-space transform handles (outside zoomed world) */}
      {canTransform && !editing && (
        <ScreenTransformHandles
          bbox={itemScreenBBox(selItem)}
          onRotateStart={(e) => {
            const c = itemCenter(selItem);
            const sc = worldToClient(c.x, c.y);
            startHandleGesture(e, "rotate", {
              id: selItem.id,
              cx0: c.x,
              cy0: c.y,
              startRot: selItem.rotation || 0,
              startAngle: Math.atan2(e.clientY - sc.y, e.clientX - sc.x),
            });
          }}
          onResizeStart={(e, corner) => {
            startHandleGesture(e, "resize", {
              id: selItem.id,
              corner,
              startW: itemWidth(selItem),
              startH: itemHeight(selItem),
              startX: selItem.x,
              startY: selItem.y,
              aspect: selItem.type === "image",
            });
          }}
          onScaleStart={(e) => {
            startHandleGesture(e, "scale", { id: selItem.id, startScale: selItem.scale ?? 1 });
          }}
        />
      )}

      {/* brand moved to rail — canvas stays clean */}

      {/* empty hint */}
      {items.length === 0 && (
        <div className="empty-hint">
          <p>pick a tool below · or start with a thought</p>
          <button type="button" className="starter-btn" onClick={plantStarterThought}>
            ✦ try the highlighter
          </button>
        </div>
      )}

      {/* zoom controls */}
      <div className="zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button onClick={() => setCamera((c) => zoomCamera(c, 1 / 1.2))}>−</button>
        <button className="zoom-pct" onClick={() => setCamera((c) => ({ ...c, scale: 1 }))}>
          {Math.round(camera.scale * 100)}%
        </button>
        <button onClick={() => setCamera((c) => zoomCamera(c, 1.2))}>+</button>
      </div>
      </div>

      {!editing && !walking && (
        <CanvasHud tool={tool} selectionCount={selection.length} imageArmed={imageArmed} />
      )}

      {highlight && !editing && (
        <HighlightToolbar
          highlight={highlight}
          primitives={primitives}
          mergeReady={selection.filter((id) => id !== highlight.itemId).length > 0}
          onOp={(op) => runHighlightPrimitive(op, highlight)}
          onDismiss={() => {
            window.getSelection()?.removeAllRanges();
            removeHighlightStroke(highlight.strokeId);
            setHighlight(null);
          }}
        />
      )}

      {branchTarget && !gesturing && (
        <BranchCompass
          item={branchTarget}
          worldToClient={worldToClient}
          expanded={expandPulse === branchTarget.id}
          subtle={!selection.includes(branchTarget.id)}
          onStartDrag={startBranchDrag}
        />
      )}

      {recording && !walking && (
        <PathRecorderBar
          recording={recording}
          selectionCount={selection.length}
          onVerb={(kind, caption) => recordStep(kind, selRef.current, caption)}
          onRemoveStep={removeRecordedStep}
          onCaptionStep={updateRecordedStep}
          onFinish={finishRecordingPath}
          onDiscard={discardRecording}
        />
      )}

      {walking && walkPath && walkStep && (
        <WalkOverlay
          path={walkPath}
          stepIndex={walking.stepIndex}
          step={walkStep}
          rects={walkFocusRects}
          onPrev={() => walkTo(walking.stepIndex - 1)}
          onNext={() =>
            walking.stepIndex >= walkPath.steps.length - 1 ? endWalk() : walkTo(walking.stepIndex + 1)
          }
          onBranch={branchFromWalk}
          onLeave={endWalk}
        />
      )}

      {aiMenuPos && !highlight && (
        <SelectionMenu
          pos={aiMenuPos}
          selectionCount={selection.length}
          quickOps={selectionQuickOps}
          onRunOp={(op) => runOperator(op, selection, { atClient: { x: aiMenuPos.x, y: aiMenuPos.y } })}
          onExport={exportSelection}
          onDelete={deleteSelection}
          onEdit={
            selection.length === 1 && items.find((i) => i.id === selection[0])?.type === "text"
              ? () => setEditing(selection[0])
              : null
          }
          onSaveStructure={() => captureSelectionAsStructure()}
          onDiscoverSameness={selection.length >= 2 ? runSamenessDiscovery : null}
        />
      )}

      <InputDeck
        tool={tool}
        imageArmed={imageArmed}
        canUndo={canUndo}
        canRedo={canRedo}
        onSelectTool={(id) => {
          if (id !== "image") {
            pendingImageRef.current = null;
            setImageArmed(false);
          }
          setTool(id);
        }}
        onPickImage={pickImage}
        onUndo={undo}
        onRedo={redo}
      />

      {toast && <div className="toast">{toast}</div>}

      {onboard && (
        <Onboarding state={onboard} onStart={runOnboarding} onSkip={skipOnboarding} onClose={() => setOnboard(null)} />
      )}

      {opEditor && (
        <FunctionEditor
          editor={opEditor}
          opMap={opMap}
          operators={operators}
          onClose={() => setOpEditor(null)}
          onSaveTree={saveFunctionTree}
          onSaveManual={saveManualOp}
          onDelete={deleteFunction}
        />
      )}
    </div>
  );
}

function BranchCompass({ item, worldToClient, expanded, subtle, onStartDrag }) {
  const c = noteCenter(item);
  if (!c) return null;
  const sc = worldToClient(c.x, c.y);
  const r = expanded ? 68 : 46;
  return (
    <div
      className={"branch-compass" + (expanded ? " expanded" : "") + (subtle ? " subtle" : "")}
      style={{ left: sc.x, top: sc.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {expanded && <span className="branch-compass-hint">branch</span>}
      {EXPAND_DIRS.map((dir) => {
        const px = Math.cos(dir.angle) * r;
        const py = Math.sin(dir.angle) * r;
        return (
          <button
            key={dir.id}
            type="button"
            className="branch-nub"
            style={{ transform: `translate(calc(-50% + ${px}px), calc(-50% + ${py}px))` }}
            title={`Branch ${dir.label}`}
            onPointerDown={(e) => onStartDrag(e, item.id, dir.id)}
          >
            <span className="branch-nub-dot" />
          </button>
        );
      })}
    </div>
  );
}

function PathRecorderBar({ recording, selectionCount, onVerb, onRemoveStep, onCaptionStep, onFinish, onDiscard }) {
  const [caption, setCaption] = useState("");
  const [finishing, setFinishing] = useState(false);
  const [title, setTitle] = useState("");
  const steps = recording.steps || [];

  if (finishing) {
    return (
      <div className="path-recorder" onPointerDown={(e) => e.stopPropagation()}>
        <span className="rec-dot done" />
        <input
          className="rec-title-input"
          autoFocus
          placeholder="name this path — what does it teach someone to see?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onFinish(title);
            if (e.key === "Escape") setFinishing(false);
          }}
        />
        <button className="rec-btn primary" onClick={() => onFinish(title)}>
          save path
        </button>
        <button className="rec-btn" onClick={() => setFinishing(false)}>
          back
        </button>
      </div>
    );
  }

  return (
    <div className="path-recorder" onPointerDown={(e) => e.stopPropagation()}>
      <span className="rec-dot" />
      <span className="rec-label">
        {recording.branchOf ? "branching" : "recording"} · {steps.length} step{steps.length === 1 ? "" : "s"}
      </span>
      {steps.length > 0 && (
        <div className="rec-steps">
          {steps.map((s, i) => (
            <button
              key={s.id}
              className="rec-step-chip"
              title={`${pathVerb(s.kind).label}${s.caption ? ` — ${s.caption}` : ""} · click to remove`}
              onClick={() => onRemoveStep(s.id)}
            >
              {pathVerb(s.kind).glyph}
              <span className="rec-step-n">{i + 1}</span>
            </button>
          ))}
        </div>
      )}
      <span className="rec-sep" />
      <input
        className="rec-caption"
        placeholder="say what to notice… (optional)"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && caption.trim() && steps.length) {
            onCaptionStep(steps[steps.length - 1].id, { caption: caption.trim() });
            setCaption("");
          }
        }}
      />
      <div className="rec-verbs" title={selectionCount ? "" : "select something on the canvas first"}>
        {PATH_VERBS.map((v) => (
          <button
            key={v.id}
            className="rec-verb"
            disabled={!selectionCount}
            title={v.hint}
            onClick={() => {
              onVerb(v.id, caption);
              setCaption("");
            }}
          >
            <span className="rec-verb-glyph">{v.glyph}</span>
            {v.label}
          </button>
        ))}
      </div>
      <span className="rec-sep" />
      <button className="rec-btn primary" disabled={!steps.length} onClick={() => setFinishing(true)}>
        finish
      </button>
      <button className="rec-btn danger" onClick={onDiscard} title="discard recording">
        ×
      </button>
    </div>
  );
}

function WalkOverlay({ path, stepIndex, step, rects, onPrev, onNext, onBranch, onLeave }) {
  const verb = pathVerb(step.kind);
  const last = stepIndex >= path.steps.length - 1;
  const pad = 16;
  const missing = rects.length === 0;
  return (
    <>
      <svg className="walk-dim" width="100%" height="100%">
        <defs>
          <mask id="walk-holes">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {rects.map((r, i) => (
              <rect
                key={i}
                x={r.left - pad}
                y={r.top - pad}
                width={r.right - r.left + pad * 2}
                height={r.bottom - r.top + pad * 2}
                rx="12"
                fill="black"
              />
            ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(28, 26, 22, 0.5)" mask="url(#walk-holes)" />
        {rects.map((r, i) => (
          <rect
            key={"o" + i}
            x={r.left - pad}
            y={r.top - pad}
            width={r.right - r.left + pad * 2}
            height={r.bottom - r.top + pad * 2}
            rx="12"
            fill="none"
            stroke="rgba(242, 208, 78, 0.85)"
            strokeWidth="2"
            className="walk-hole-ring"
          />
        ))}
      </svg>
      <div className="walk-footer" onPointerDown={(e) => e.stopPropagation()}>
        <div className="walk-verb">
          <span className="walk-glyph">{verb.glyph}</span>
          <span className="walk-verb-name">{verb.label}</span>
        </div>
        <div className="walk-caption">
          {step.caption || verb.hint}
          {missing && <span className="walk-missing"> (what was here has changed — that, too, is part of the path)</span>}
        </div>
        <div className="walk-progress">
          {path.steps.map((s, i) => (
            <span key={s.id} className={"walk-dot" + (i === stepIndex ? " on" : i < stepIndex ? " past" : "")} />
          ))}
        </div>
        <div className="walk-controls">
          <button className="walk-btn" disabled={stepIndex === 0} onClick={onPrev}>
            ←
          </button>
          <span className="walk-count">
            {stepIndex + 1} / {path.steps.length}
          </span>
          <button className="walk-btn primary" onClick={onNext}>
            {last ? "arrive" : "→"}
          </button>
          <span className="walk-sep" />
          <button className="walk-btn branch" onClick={onBranch} title="stop here and continue your own way (b)">
            ⑂ branch here
          </button>
          <button className="walk-btn" onClick={onLeave} title="leave the walk (esc)">
            leave
          </button>
        </div>
        <div className="walk-title">walking · {path.title}</div>
      </div>
    </>
  );
}

function PathCard({ path, parent, onWalk, onExport, onDelete }) {
  const verbs = [...new Set((path.steps || []).map((s) => pathVerb(s.kind).glyph))].slice(0, 6);
  return (
    <div className="path-card">
      <div className="path-card-top">
        <span className="path-card-glyphs">{verbs.join(" ")}</span>
        <span className="path-card-title">{path.title || "untitled path"}</span>
      </div>
      <div className="path-card-meta">
        {path.steps?.length || 0} steps
        {path.walks ? ` · walked ${path.walks}×` : ""}
        {parent && (
          <span className="path-card-branch"> · ⑂ from “{parent.title}” at step {(path.branchOf?.stepIndex ?? 0) + 1}</span>
        )}
        {!parent && path.branchOf && <span className="path-card-branch"> · ⑂ branched</span>}
      </div>
      <div className="path-card-actions">
        <button className="path-card-btn primary" onClick={onWalk}>
          ▷ walk
        </button>
        <button className="path-card-btn" onClick={onExport} title="export as file to send">
          ↗ send
        </button>
        <button className="path-card-btn danger" onClick={onDelete} title="delete path">
          ×
        </button>
      </div>
    </div>
  );
}

function BoardText({ item, selected, dropTarget, editing, onCommit, onDragStart }) {
  const ref = useRef(null);
  const seeded = useRef(false);

  useEffect(() => {
    if (editing && ref.current) {
      if (!seeded.current) {
        ref.current.innerText = item.text || "";
        seeded.current = true;
      }
      ref.current.focus();
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
    if (!editing) seeded.current = false;
  }, [editing, item.id]);

  const style = itemStyle(item);

  if (editing) {
    return (
      <div
        ref={ref}
        className="board-text editing"
        data-item={item.id}
        contentEditable
        suppressContentEditableWarning
        style={style}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCommit(ref.current?.innerText ?? "");
          }
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCommit(ref.current?.innerText ?? "");
          }
        }}
      />
    );
  }
  return (
    <div
      className={
        "board-text" +
        (selected ? " sel" : "") +
        (dropTarget ? " drop-target" : "") +
        (item.portal ? " portal" : "")
      }
      data-item={item.id}
      style={style}
      draggable={selected}
      onDragStart={(e) => selected && onDragStart?.(e)}
    >
      {item.text}
    </div>
  );
}

function ScreenTransformHandles({ bbox, onRotateStart, onResizeStart, onScaleStart }) {
  const w = bbox.right - bbox.left;
  const h = bbox.bottom - bbox.top;
  const cx = (bbox.left + bbox.right) / 2;
  const handles = [
    ["nw", bbox.left, bbox.top],
    ["ne", bbox.right, bbox.top],
    ["se", bbox.right, bbox.bottom],
    ["sw", bbox.left, bbox.bottom],
  ];
  return (
    <>
      <div
        className="xform-outline-screen"
        style={{ left: bbox.left, top: bbox.top, width: w, height: h }}
      />
      {handles.map(([corner, x, y]) => (
        <div
          key={corner}
          className="xform-handle corner"
          style={{ left: x - 5, top: y - 5 }}
          onPointerDown={(e) => onResizeStart(e, corner)}
        />
      ))}
      <div
        className="xform-handle rotate"
        style={{ left: cx - 6, top: bbox.top - 30 }}
        onPointerDown={onRotateStart}
        title="rotate"
      />
      <div
        className="xform-handle scale"
        style={{ left: bbox.right + 6, top: bbox.top + h / 2 - 5 }}
        onPointerDown={onScaleStart}
        title="scale"
      />
    </>
  );
}

function startSelectionDrag(e, ids) {
  e.stopPropagation();
  e.dataTransfer.setData(SEL_MIME, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = "copy";
}

function startOpDrag(e, op) {
  e.stopPropagation();
  e.dataTransfer.setData(OP_MIME, op.id);
  e.dataTransfer.effectAllowed = "copy";
}

function startStructDrag(e, struct) {
  e.stopPropagation();
  e.dataTransfer.setData(STRUCT_MIME, struct.id);
  e.dataTransfer.effectAllowed = "copy";
}

function CanvasHud({ tool, selectionCount, imageArmed }) {
  const meta = CANVAS_TOOLS[tool] || CANVAS_TOOLS.select;
  let hint = meta.hint;
  if (imageArmed && tool === "image") {
    hint = "Click on the canvas to place your image";
  } else if (tool === "highlight" && selectionCount > 1) {
    hint = `${selectionCount} ideas selected · highlight text · merge fuses with the other selection`;
  } else if (selectionCount >= 2 && tool === "select") {
    hint = `${selectionCount} selected · selection menu → sameness or merge · drag to move`;
  } else if (selectionCount > 0 && tool === "select") {
    hint = `${selectionCount} selected · double-tap to branch · drag nub for arrow · Enter to write`;
  } else if (tool === "highlight") {
    hint = "Text → primitives · scribble erases · closed circle selects inside · ⌫ at cursor";
  }

  return (
    <div className="canvas-hud" onPointerDown={(e) => e.stopPropagation()}>
      <div className={"canvas-mode-pill" + (tool === "highlight" ? " cognition" : "")}>
        {meta.swatch && (
          <span
            className="mode-swatch"
            style={{
              background: meta.swatch,
              opacity: meta.swatchOpacity ?? (tool === "highlight" ? 0.85 : 1),
            }}
          />
        )}
        <span className="mode-icon">{meta.icon}</span>
        <span className="mode-label">{meta.label}</span>
      </div>
      <p className="mode-hint">{hint}</p>
    </div>
  );
}

function InputDeck({ tool, imageArmed, canUndo, canRedo, onSelectTool, onPickImage, onUndo, onRedo }) {
  return (
    <div className="input-deck" onPointerDown={(e) => e.stopPropagation()}>
      <div className="input-deck-head">
        <span>input</span>
        <div className="input-history">
          <button type="button" className="input-undo" disabled={!canUndo} onClick={onUndo} title="undo">
            ↩ undo
          </button>
          <button type="button" className="input-undo" disabled={!canRedo} onClick={onRedo} title="redo">
            redo ↪
          </button>
        </div>
      </div>
      <div className="input-deck-groups">
        {TOOL_GROUPS.map((group) => {
          const tools = Object.values(CANVAS_TOOLS).filter((t) => t.group === group.id);
          if (!tools.length) return null;
          return (
            <div key={group.id} className="input-group">
              <span className="input-group-label">{group.label}</span>
              <div className="input-group-tools">
                {tools.map((t) => {
                  const isImage = t.id === "image";
                  const active = tool === t.id || (isImage && imageArmed);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={
                        "input-tool" +
                        (active ? " on" : "") +
                        (t.id === "highlight" ? " highlight-tool" : "")
                      }
                      title={t.label}
                      onClick={() => (isImage ? onPickImage() : onSelectTool(t.id))}
                    >
                      {t.swatch && (
                        <span
                          className="tool-swatch"
                          style={{
                            background: t.swatch,
                            opacity: t.swatchOpacity ?? (t.id === "highlight" ? 0.85 : 0.95),
                          }}
                        />
                      )}
                      <span className="tool-icon">{t.icon}</span>
                      <span className="tool-label">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HighlightToolbar({ highlight, primitives, mergeReady, onOp, onDismiss }) {
  const cx = highlight.rect.left + highlight.rect.width / 2;
  const above = highlight.rect.top > 100;
  const style = {
    left: cx,
    top: above ? highlight.rect.top - 10 : highlight.rect.bottom + 10,
    transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)",
  };
  const quote =
    highlight.quote.length > 48 ? `${highlight.quote.slice(0, 48)}…` : highlight.quote;

  return (
    <div className="highlight-toolbar" style={style} onPointerDown={(e) => e.stopPropagation()}>
      <div className="highlight-toolbar-head">
        <span className="highlight-mark">✦</span>
        <span className="highlight-quote">"{quote}"</span>
        <button className="highlight-close" onClick={onDismiss} title="dismiss">
          ×
        </button>
      </div>
      <div className="highlight-actions">
        {primitives.map((op) => {
          const disabled = op.needsSelection >= 2 && !mergeReady;
          return (
            <button
              key={op.id}
              className="highlight-btn"
              disabled={disabled}
              title={
                disabled
                  ? "Select another idea first, then highlight for merge"
                  : op.description || op.name
              }
              onClick={() => !disabled && onOp(op)}
            >
              {op.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function JobRow({ job, onDismiss }) {
  const [displayProgress, setDisplayProgress] = useState(0);
  const [etaMs, setEtaMs] = useState(null);

  useEffect(() => {
    if (job.status === "done") {
      setDisplayProgress(1);
      setEtaMs(0);
      return;
    }
    if (job.status !== "running") return;

    const start = job.startedAt || Date.now();
    const total = job.estimatedMs || ETA.default;

    const tick = () => {
      const elapsed = Date.now() - start;
      const timeRatio = Math.min(1, elapsed / total);
      const target = Math.min(0.96, timeRatio * 0.96);
      setDisplayProgress((prev) => {
        const eased = prev + (target - prev) * 0.12;
        return Math.max(prev, Math.min(0.96, eased));
      });
      setEtaMs(Math.max(0, total - elapsed));
    };

    tick();
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, [job.id, job.status, job.startedAt, job.estimatedMs]);

  useEffect(() => {
    if (typeof job.progress === "number" && job.progress > displayProgress) {
      setDisplayProgress(job.progress);
    }
  }, [job.progress, displayProgress]);

  const pct = Math.round((job.status === "done" ? 1 : displayProgress) * 100);
  const eta =
    job.status === "running" && etaMs != null
      ? formatJobEta(etaMs)
      : job.status === "done"
      ? "done"
      : null;

  return (
    <div className={"job-row" + (job.status === "error" ? " error" : job.status === "done" ? " done" : "")}>
      <div className="job-row-top">
        <span className="job-label">{job.label}</span>
        {job.status === "running" && eta && <span className="job-eta">{eta}</span>}
        {job.status === "error" && (
          <button className="job-dismiss" onClick={() => onDismiss(job.id)} title="dismiss">
            ×
          </button>
        )}
      </div>
      {job.step && <div className="job-step">{job.step}</div>}
      {job.status === "running" && (
        <div className="job-bar">
          <div className="job-bar-fill" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function JobPanel({ jobs, onDismiss }) {
  if (!jobs.length) return null;
  return (
    <div className="job-panel">
      <div className="job-panel-head">in progress</div>
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function DraggableOpCard({ op, opMap, expanded, onToggle, onEdit, flat }) {
  if (!op) return null;
  const steps = op.kind === "pipeline" && op.steps ? op.steps.map((id) => opMap[id]).filter(Boolean) : [];
  const open = expanded[op.id];
  return (
    <div className="op-card-wrap">
      <div
        className="op-card"
        draggable
        onDragStart={(e) => startOpDrag(e, op)}
        title="drag onto canvas"
      >
        <div className="op-card-row">
          <span className="op-drag-grip" title="drag onto canvas">
            ⠿
          </span>
          <div className="op-card-label">
            <span className="op-card-name">{op.name}</span>
            {open && op.description && <span className="op-card-desc">{op.description}</span>}
          </div>
          {!flat && steps.length > 0 && (
            <button className="op-card-toggle" onClick={() => onToggle(op.id)} title={`${steps.length} steps`}>
              {open ? "▾" : "▸"}
            </button>
          )}
          <button className="op-card-edit" onClick={() => onEdit(op)} title="edit">
            ⚙
          </button>
        </div>
      </div>
      {open && steps.length > 0 && (
        <div className="op-card-steps">
          {steps.map((step) => (
            <DraggableStep key={step.id} step={step} opMap={opMap} expanded={expanded} onToggle={onToggle} onEdit={onEdit} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableStep({ step, opMap, expanded, onToggle, onEdit, depth }) {
  const sub = step.kind === "pipeline" && step.steps ? step.steps.map((id) => opMap[id]).filter(Boolean) : [];
  const open = expanded[step.id];
  const isLeaf = !sub.length;
  return (
    <div className="op-step" style={{ paddingLeft: depth * 8 }}>
      <div
        className={"op-step-chip" + (isLeaf ? " leaf" : "")}
        draggable
        onDragStart={(e) => startOpDrag(e, step)}
        title="drag onto canvas"
      >
        <span className="op-drag-grip">⠿</span>
        <div className="op-step-label">
          <span className="op-step-name">{step.name}</span>
          {open && step.description && <span className="op-step-desc">{step.description}</span>}
        </div>
        {!isLeaf && (
          <button className="op-step-toggle" onClick={() => onToggle(step.id)}>
            {open ? "▾" : "▸"}
          </button>
        )}
        <button className="op-step-edit" onClick={() => onEdit(step)}>⚙</button>
      </div>
      {open &&
        sub.map((child) => (
          <DraggableStep key={child.id} step={child} opMap={opMap} expanded={expanded} onToggle={onToggle} onEdit={onEdit} depth={depth + 1} />
        ))}
    </div>
  );
}

function StructureCard({ struct, onDelete }) {
  const preview = structurePreview(struct);
  const label = struct.structNum ? `#${struct.structNum}` : struct.kind || "idea";
  return (
    <div className="struct-card-wrap">
      <div
        className="struct-card"
        draggable
        onDragStart={(e) => startStructDrag(e, struct)}
        title="drag onto canvas to plant"
      >
        <div className="struct-card-row">
          <span className="op-drag-grip" title="drag onto canvas">
            ⠿
          </span>
          <div className="struct-card-body">
            <span className="struct-kind">{label}</span>
            <span className="struct-title">{struct.title || preview}</span>
            <span className="struct-preview">{preview}</span>
          </div>
          <button className="struct-card-del" onClick={onDelete} title="delete">
            ×
          </button>
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function SelectionMenu({
  pos,
  selectionCount,
  quickOps,
  onRunOp,
  onExport,
  onDelete,
  onEdit,
  onSaveStructure,
  onDiscoverSameness,
}) {
  const [open, setOpen] = useState(false);
  const transform = pos.below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
  const style = { left: pos.x, top: pos.y, transform };

  if (open) {
    return (
      <div className="palette col export-palette" style={style}>
        <div className="palette-row head">
          <button className="p-btn ghost" onClick={() => setOpen(false)}>
            ←
          </button>
          <span className="palette-title">export</span>
        </div>
        {["txt", "md", "doc", "pdf"].map((fmt) => (
          <button key={fmt} className="p-btn wide" onClick={() => { onExport(fmt); setOpen(false); }}>
            {fmt === "doc" ? "Word (.doc)" : fmt === "pdf" ? "PDF (print)" : `.${fmt}`}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="palette selection-menu" style={style}>
      {quickOps.length > 0 && (
        <div className="selection-ops">
          {quickOps.map((op) => (
            <button
              key={op.id}
              className="p-btn op-chip"
              title={op.description || op.name}
              onClick={() => onRunOp(op)}
            >
              {op.name}
            </button>
          ))}
        </div>
      )}
      <div className="selection-actions">
        {onDiscoverSameness && (
          <>
            <button className="p-btn sameness" onClick={onDiscoverSameness} title="find shared structure">
              sameness
            </button>
            <span className="p-sep" />
          </>
        )}
        <button className="p-btn" onClick={() => setOpen(true)}>
          export
        </button>
        {onEdit && (
          <button className="p-btn" onClick={onEdit} title="edit note">
            write
          </button>
        )}
        <button className="p-btn" onClick={onSaveStructure} disabled={!selectionCount} title="save to structures">
          save
        </button>
        <span className="p-sep" />
        <button className="p-btn danger" onClick={onDelete} title="delete selection">
          ⌫
        </button>
      </div>
    </div>
  );
}

function Onboarding({ state, onStart, onSkip, onClose }) {
  const [custom, setCustom] = useState("");

  if (state.step === "role") {
    return (
      <div className="onboard-scrim">
        <div className="onboard">
          <div className="onboard-mark">lens</div>
          <h2>What do you do?</h2>
          <p className="onboard-sub">
            Pick a role — I'll build thinking functions in the background while you use the canvas.
          </p>
          <div className="role-grid">
            {ROLES.map((r) => (
              <button key={r} className="role-btn" onClick={() => onStart(r)}>
                {r}
              </button>
            ))}
          </div>
          <div className="onboard-custom">
            <input
              placeholder="or type your own…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && custom.trim() && onStart(custom.trim())}
            />
            <button disabled={!custom.trim()} onClick={() => custom.trim() && onStart(custom.trim())}>
              build
            </button>
          </div>
          <button className="onboard-skip" onClick={onSkip}>
            skip for now
          </button>
        </div>
      </div>
    );
  }

  if (state.step === "working") {
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    return (
      <div className="onboard-scrim">
        <div className="onboard">
          <div className="onboard-mark">lens</div>
          <h2>Building your toolbox</h2>
          <p className="onboard-sub">designing functions for a {state.role}, each composed of smaller functions…</p>
          <div className="progress">
            <div className="progress-bar" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress-label">
            {state.label || `${state.done} / ${state.total} functions`} {state.total ? `· ${state.done}/${state.total}` : ""}
          </div>
        </div>
      </div>
    );
  }

  if (state.step === "done") {
    return (
      <div className="onboard-scrim">
        <div className="onboard">
          <div className="onboard-mark">lens</div>
          <h2>Your toolbox is ready</h2>
          <p className="onboard-sub">
            {state.count} functions built for a {state.role}. Drag functions onto ideas on the canvas, or drag ideas together to combine.
          </p>
          <button className="onboard-go" onClick={onClose}>
            start thinking
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboard-scrim">
      <div className="onboard">
        <div className="onboard-mark">lens</div>
        <h2>Hm, that didn't work</h2>
        <p className="onboard-sub">{state.message}</p>
        <div className="onboard-custom">
          <button className="onboard-go" onClick={() => onStart("founder")}>
            try again
          </button>
          <button className="onboard-skip" onClick={onSkip}>
            skip
          </button>
        </div>
      </div>
    </div>
  );
}

function FunctionEditor({ editor, opMap, operators, onClose, onSaveTree, onSaveManual, onDelete }) {
  const isCreate = editor.mode === "create";
  const sourceRoot = editor.op || null;

  const [draftOps, setDraftOps] = useState(() => (isCreate ? [] : collectDraftOps(sourceRoot, opMap)));
  const [rootId, setRootId] = useState(() => sourceRoot?.id || null);
  const [navPath, setNavPath] = useState([]);

  const draftMap = useMemo(() => Object.fromEntries(draftOps.map((o) => [o.id, o])), [draftOps]);
  const focusId = navPath.length ? navPath[navPath.length - 1] : rootId;
  const focusOp = focusId ? draftMap[focusId] : null;
  const rootDraft = rootId ? draftMap[rootId] : null;

  const [name, setName] = useState(focusOp?.name || "");
  const [description, setDescription] = useState(focusOp?.description || "");
  const [prompt, setPrompt] = useState(focusOp?.prompt || "");
  const [prose, setProse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setName(focusOp?.name || "");
    setDescription(focusOp?.description || "");
    setPrompt(focusOp?.prompt || "");
  }, [focusId]);

  function patchFocus(patch) {
    if (!focusId) return;
    setDraftOps((ops) => ops.map((o) => (o.id === focusId ? { ...o, ...patch } : o)));
  }

  function flushFields() {
    if (!focusId) return;
    patchFocus({
      name: name.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
    });
  }

  function navigateTo(id) {
    flushFields();
    if (id === rootId) {
      setNavPath([]);
      return;
    }
    const idx = navPath.indexOf(id);
    if (idx >= 0) setNavPath(navPath.slice(0, idx + 1));
    else setNavPath([...navPath, id]);
  }

  function navigateUp() {
    flushFields();
    setNavPath((p) => p.slice(0, -1));
  }

  async function runProse() {
    const instruction = prose.trim();
    if (!instruction) return;
    setBusy(true);
    setError(null);
    try {
      flushFields();
      let tree;
      if (isCreate && !rootDraft) {
        tree = await createFunctionFromProse(instruction, operators, opMap);
      } else {
        const target = focusOp || rootDraft;
        tree = await editFunctionWithProse(target, draftMap, instruction, operators);
      }
      const { rootId: rid, ops } = treeToOperators(tree, {
        role: rootDraft?.role || sourceRoot?.role || null,
        top: isCreate ? true : !!sourceRoot?.top,
      });
      setDraftOps(ops);
      setRootId(rid);
      setNavPath([]);
      setProse("");
    } catch (err) {
      setError(err.message || "Could not apply changes.");
    } finally {
      setBusy(false);
    }
  }

  function saveAll() {
    flushFields();
    let ops = draftOps;
    let rid = rootId;
    if (!rid && name.trim() && prompt.trim()) {
      rid = uid();
      ops = [
        {
          id: rid,
          kind: "prompt",
          name: name.trim(),
          description: description.trim(),
          prompt: prompt.trim(),
          top: true,
        },
      ];
    }
    const root = ops.find((o) => o.id === rid);
    if (!rid || !root?.name?.trim()) return;
    if (root.kind === "prompt" && !root.prompt?.trim()) return;
    onSaveTree(isCreate ? null : sourceRoot?.id, ops);
  }

  const isPipeline = focusOp?.kind === "pipeline";
  const steps =
    isPipeline && focusOp?.steps ? focusOp.steps.map((id) => draftMap[id]).filter(Boolean) : [];
  const crumbs = [];
  if (rootDraft) {
    crumbs.push({ id: rootId, name: rootDraft.name || "function" });
    navPath.forEach((id) => {
      const o = draftMap[id];
      if (o) crumbs.push({ id, name: o.name });
    });
  }

  const canSave =
    !!rootDraft ||
    (name.trim() && prompt.trim()) ||
    (rootId && draftOps.some((o) => o.id === rootId && o.name?.trim()));

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="fn-editor" onClick={(e) => e.stopPropagation()}>
        <div className="fn-head">
          <h3>{isCreate ? "create function" : "edit function"}</h3>
          <button className="fn-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="fn-pane">
          {rootDraft && crumbs.length > 0 && (
            <nav className="fn-crumb" aria-label="function path">
              {crumbs.map((c, i) => (
                <span key={c.id} className="fn-crumb-item">
                  {i > 0 && <span className="fn-crumb-sep">/</span>}
                  <button
                    type="button"
                    className={"fn-crumb-btn" + (c.id === focusId ? " on" : "")}
                    onClick={() => navigateTo(c.id)}
                  >
                    {c.name}
                  </button>
                </span>
              ))}
              {navPath.length > 0 && (
                <button type="button" className="fn-crumb-up" onClick={navigateUp}>
                  ← back
                </button>
              )}
            </nav>
          )}

          {!rootDraft && isCreate && (
            <p className="fn-hint">
              Describe what this function should do, or fill in the fields below. Use descriptive 3–7 word names and hyper-specific prompts with clear output format.
            </p>
          )}

          {rootDraft && (
            <>
              {steps.length > 0 && (
                <div className="fn-blocks-wrap">
                  <div className="fn-blocks-label">steps</div>
                  <FunctionBlockNav steps={steps} focusId={focusId} onSelect={navigateTo} />
                </div>
              )}

              <label>name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Build Full Investment Thesis"
              />

              <label>description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="what goes in, what comes out"
              />

              {!isPipeline && (
                <>
                  <label>prompt</label>
                  <textarea
                    rows={6}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Instruction for this step — include GOAL, OUTPUT FORMAT, and quality bar."
                  />
                </>
              )}
            </>
          )}

          {!rootDraft && isCreate && (
            <>
              <label>name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="function name" />
              <label>description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="what it does"
              />
              <label>prompt</label>
              <textarea
                rows={5}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Or skip manual fields and describe below with AI."
              />
            </>
          )}

          <label>{rootDraft ? "revise with words" : "describe with words"}</label>
          <textarea
            className="fn-prose"
            rows={3}
            placeholder={
              isCreate
                ? 'e.g. "Extract action items, owners, and deadlines from messy meeting notes"'
                : 'e.g. "Add a step that checks for contradictions" or "Make the output shorter"'
            }
            value={prose}
            onChange={(e) => setProse(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runProse();
            }}
          />

          {error && <div className="fn-error">{error}</div>}

          <button className="fn-generate" disabled={busy || !prose.trim()} onClick={runProse}>
            {busy ? (
              <>
                <span className="spinner" /> building…
              </>
            ) : rootDraft ? (
              "apply with AI"
            ) : (
              "generate with AI"
            )}
          </button>
        </div>

        <div className="fn-foot">
          {!isCreate && sourceRoot && (
            <button className="fn-del" onClick={() => onDelete(sourceRoot.id)}>
              delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="fn-secondary" onClick={onClose}>
            cancel
          </button>
          <button className="fn-primary" disabled={!canSave} onClick={saveAll}>
            save
          </button>
        </div>
      </div>
    </div>
  );
}

function FunctionBlockNav({ steps, focusId, onSelect }) {
  if (!steps?.length) return null;
  return (
    <div className="fn-blocks">
      {steps.map((step, i) => (
        <React.Fragment key={step.id}>
          {i > 0 && <span className="fn-block-sep">→</span>}
          <button
            type="button"
            className={"fn-block" + (focusId === step.id ? " on" : "") + (step.kind === "pipeline" ? " composite" : " leaf")}
            onClick={() => onSelect(step.id)}
            title={step.description || step.name}
          >
            {step.name}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}
