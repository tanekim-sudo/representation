import React, { useEffect, useMemo, useRef, useState } from "react";

const ITEMS_KEY = "lens.board.items.v1";
const CAMERA_KEY = "lens.board.camera.v1";
const OPERATORS_KEY = "lens.board.operators.v1";
const STRUCTURES_KEY = "lens.structures.v1";
const STRUCTSEQ_KEY = "lens.structseq.v1";
const OLD_NODES_KEY = "lens.savednodes.v1";
const ARTIFACT_KEY = "lens.artifact.v1";
const OLD_SEEDS_KEY = "lens.seeds.v2";
const OP_MIME = "application/lens-op";
const STRUCT_MIME = "application/lens-structure";
const RAIL_W = 280;

const INK = "#20201d";
const PEN_W = 2.4; // world units
const MARKER_W = 16;

const DEFAULT_OPERATORS = [
  { id: "op-sharpen", name: "sharpen", prompt: "Rewrite this more sharply and precisely, preserving the meaning. Return only the rewritten text." },
  { id: "op-expand", name: "expand", prompt: "Expand this idea with depth, specifics and a fresh angle. Return only the expanded text." },
  { id: "op-counter", name: "counter", prompt: "Give the single strongest counter-argument or opposing view to this. Return only that argument." },
  { id: "op-simplify", name: "simplify", prompt: "Explain this as simply and concretely as possible, like to a smart friend. Return only the explanation." },
];

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

function parseJSON(raw) {
  let s = (raw || "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

// The master system prompt — teaches Claude exactly what lens is and how to architect operators.
const LENS_SYSTEM = `You are the function-architect for "lens", an infinite thinking whiteboard where a person operates on their own notes, ideas, drafts, images, and sketches with AI.

WHAT LENS IS
- An infinite canvas (pan, zoom, free placement) where the user writes text, draws ink strokes, and drops images anywhere.
- A left rail of TRANSFORMATIONS (functions/operators) the user drags onto selected material or clicks to apply.
- Each transformation is a COMPOSITION: functions made of sub-functions made of sub-functions, recursively, down to PRIMITIVE LEAVES.
- The user selects material on the board → applies a function → Claude executes a pipeline → the result replaces or spawns new text on the board.
- Saved IDEA STRUCTURES: the user can save any selection (text, images, strokes) as a reusable structure in their library, then drag it back onto the canvas later.
- Discovery: the user can select multiple disparate items and find their hidden structural sameness — producing numbered STRUCTURE objects.

HOW FUNCTIONS EXECUTE
- A FUNCTION runs as an ORDERED PIPELINE. Output of step N becomes input to step N+1.
- Composite nodes have "steps" (array of child nodes) and NO "prompt".
- Leaf/primitive nodes have "prompt" (one precise instruction) and NO "steps".
- The user can expand any function in the rail to see nested sub-functions at infinite depth, drag any level onto the canvas, or edit any leaf prompt by hand.

NAMING — CRITICAL
- Names must be EXTREMELY ABSTRACT and SUCCINCT — the minimum signal, like mathematical operators.
- Top-level functions: ONE word preferred, TWO words absolute max (e.g. "thesis", "redflags", "memo", "comps", "signal").
- Sub-functions: ONE word only (e.g. "extract", "stress", "map", "draft", "compress").
- NEVER use verbose phrases like "Extract investment thesis" or "Identify red flags". Use "thesis", "flags".
- Descriptions are optional and only shown on expand — keep to one short sentence if present.

DECOMPOSITION — INFINITE DEPTH
- Every composite bundles more than one cognitive move → split it.
- Recurse 3–5 layers deep minimum for top-level functions. Sub-functions that still do two things must split again.
- There is no depth limit — keep decomposing until each leaf does exactly ONE atomic transformation.
- Order matters: later steps may assume earlier steps ran. Mirror how an expert actually performs the work.

LEAF PROMPTS — MAX STRENGTH
- Each leaf is a standalone, expert-grade instruction to Claude.
- State exactly what to do with "the input text" (previous step's output) and exactly what to return.
- Return ONLY the transformed result — no preamble, labels, commentary, or meta-talk.
- NEVER refuse, ask for more data, or say "insufficient material". Work with whatever fragments exist — keywords, rough notes, single phrases.
- A closed pipeline: leaves may only rely on input text, never on information not yet created.

YOUR STANDARDS
- TRUE USEFULNESS: high-leverage moves this person repeats in real work. No generic brainstorm fluff.
- REALISTIC: mirror how a sharp practitioner actually thinks, step by step.
- COMPLEMENT the user's existing library — do not duplicate names or purposes.
- OUTPUT: return ONLY valid JSON. No markdown fences, no explanation outside the JSON.`;

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

function executionSystem(operators, opMap, activeOp) {
  const compact = summarizeLibrary(operators, opMap, { compact: true });
  let sys =
    "You execute a transformation on the user's thinking whiteboard. Return ONLY the transformed result — no preamble, labels, headings, or commentary. Work with whatever material is given: brief fragments, keywords, rough notes, single phrases, partial sentences. NEVER refuse, NEVER say insufficient data, NEVER ask for more information, NEVER output meta-analysis about what's missing. Always produce the best possible transform on what's provided.";
  if (activeOp?.name) {
    sys += `\n\nActive transform: "${activeOp.name}"`;
    if (activeOp.description) sys += ` — ${activeOp.description}`;
  }
  if (compact) {
    sys += `\n\nThis user's personal library (match their style, vocabulary, and transformation patterns):\n${compact}`;
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

Design the 10 single most valuable FUNCTIONS for their lens whiteboard — the repeated, high-leverage cognitive operations they perform on notes, ideas, drafts, data, or documents.
${hasLib ? "\nThey already have a personal library (see system context). Design NEW functions that complement it — do not duplicate existing names.\n" : ""}
For each function:
- "name": ONE word preferred, TWO words absolute max. Extremely abstract and succinct (e.g. "thesis", "flags", "memo", "signal", "comps"). NOT verbose phrases.
- "description": one short sentence (optional, for expand view only).

Return ONLY JSON: {"functions":[{"name":"...","description":"..."}]} with exactly 10 functions, ordered from most to least frequently used.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 2000 });
  const j = parseJSON(out);
  return Array.isArray(j.functions) ? j.functions.slice(0, 10) : [];
}

// decompose one function into a deep tree of sub-functions ending in primitives
async function decomposeFunction(role, fn, operators, opMap) {
  const prompt = `The user is a: ${role}.

Decompose this ONE function into a deep tree ending in primitive operators. Go 3–5 layers deep minimum. Each sub-layer should be ONE word. Tailor to the user's library in system context.

FUNCTION
name: ${fn.name}
description: ${fn.description || fn.name}

Requirements:
- 2–5 ordered sub-functions at each level, mirroring how an expert ${role} performs this.
- Recurse until every leaf is a PRIMITIVE doing exactly one thing.
- Names: ONE word only at every level. Extremely abstract (e.g. "extract", "stress", "map", "compress", "draft").
- Every LEAF has a max-strength "prompt". Composites have "steps" and NO "prompt".
- Descriptions: optional, one short sentence max.

Return ONLY JSON:
{"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 8000 });
  return parseJSON(out);
}

// expand an existing operator subtree with more layers via Claude
async function expandOperatorSubtree(op, opMap, operators) {
  const current = serializeTree(op, opMap);
  const prompt = `Expand this function with MORE sub-layers of abstraction. Add deeper decomposition where steps still bundle multiple operations. Go at least 2 layers deeper. Keep ONE-word names at every level.

CURRENT:
${current}

Return ONLY JSON for the COMPLETE expanded function (same shape):
{"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 8000 });
  return parseJSON(out);
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
    const prompt = (node.prompt || "").trim() || `Apply "${name}" to the input text and return only the result.`;
    out.push({ id, name, description, kind: "prompt", prompt, role, top });
  }
  return id;
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

They described it in their own words:
"""
${description}
"""

Design this as a complete function tree: decompose it into ordered sub-functions ending in primitive operators, exactly as lens executes them (pipeline where each step's output feeds the next).

Requirements:
- Infer a sharp 2-4 word name and one-sentence description for the top function.
- Break into 2-5 ordered sub-functions; recurse 2-4 layers until every leaf is one atomic primitive.
- Every LEAF has a max-strength "prompt" tailored to this user's library. Composites have "steps" and NO "prompt".
- Do not duplicate functions already in their library unless the user explicitly asks to recreate one.

Return ONLY JSON:
{"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 6000 });
  return parseJSON(out);
}

// edit an existing function tree from the user's prose instruction
async function editFunctionWithProse(op, opMap, instruction, operators) {
  const current = serializeTree(op, opMap);
  const prompt = `The user is EDITING an existing function on their lens whiteboard.
Keep it consistent with their personal library (see system context) — same vocabulary, style, and transformation patterns.

CURRENT FUNCTION (tree — composites have steps, leaves have prompts):
${current}

The user wants these changes (in their own words):
"""
${instruction}
"""

Apply their request. Preserve anything they didn't ask to change. You may rename, re-describe, re-prompt, reorder, add, remove, or split steps. Keep decomposing until leaves are single atomic primitives with excellent prompts tailored to this user's library.

Return ONLY JSON for the COMPLETE updated function (same shape as create):
{"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}

If this should become a single primitive with no sub-steps, return a leaf:
{"name":"...","description":"...","prompt":"..."}`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 6000 });
  return parseJSON(out);
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

async function runClaude(prompt, text, opts = {}) {
  const { image = null, system = null, maxTokens = null } = opts;
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, text, count: 1, image, system, maxTokens }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Claude did not answer.");
  return (data.outputs || [])[0] || "";
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
    const s = load(OPERATORS_KEY, null);
    return Array.isArray(s) ? s : DEFAULT_OPERATORS;
  });
  const [structures, setStructures] = useState(() => {
    const saved = load(STRUCTURES_KEY, null);
    if (Array.isArray(saved) && saved.length) return saved;
    return migrateOldSavedNodes();
  });

  const [tool, setTool] = useState("select"); // select | text | pen | marker | eraser | hand
  const [selection, setSelection] = useState([]);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);
  const [lasso, setLasso] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [opEditor, setOpEditor] = useState(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [dropReady, setDropReady] = useState(false);
  const [railTab, setRailTab] = useState("functions"); // functions | structures
  const [onboard, setOnboard] = useState(() => (localStorage.getItem(ONBOARDED_KEY) ? null : { step: "role" }));

  const viewportRef = useRef(null);
  const gesture = useRef(null);
  const camRef = useRef(camera);
  const itemsRef = useRef(items);
  const toolRef = useRef(tool);
  const selRef = useRef(selection);
  const spaceRef = useRef(false);
  const editingRef = useRef(editing);
  camRef.current = camera;
  itemsRef.current = items;
  toolRef.current = tool;
  selRef.current = selection;
  editingRef.current = editing;

  useEffect(() => localStorage.setItem(ITEMS_KEY, JSON.stringify(items)), [items]);
  useEffect(() => localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)), [camera]);
  useEffect(() => localStorage.setItem(OPERATORS_KEY, JSON.stringify(operators)), [operators]);
  useEffect(() => localStorage.setItem(STRUCTURES_KEY, JSON.stringify(structures)), [structures]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
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

  // global pointer move/up so gestures work across canvas items
  useEffect(() => {
    function onMove(e) {
      const g = gesture.current;
      if (!g) return;
      const cx = e.clientX;
      const cy = e.clientY;

      if (g.mode === "pan") {
        setCamera({ ...g.cam, x: g.cam.x + (cx - g.cx), y: g.cam.y + (cy - g.cy) });
      } else if (g.mode === "draw") {
        const w = clientToWorld(cx, cy);
        g.points.push(w);
        setDraft({ points: g.points.slice(), marker: g.marker });
      } else if (g.mode === "erase") {
        const hit = itemAtPoint(cx, cy);
        if (hit) setItems((arr) => arr.filter((it) => it.id !== hit.id));
      } else if (g.mode === "move") {
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
          g.mode = "move";
          g.moved = 0;
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
          let nw = Math.max(40, g.startW + dw);
          let nh = Math.max(30, g.startH + (g.corner.includes("n") ? -dh : dh));
          if (g.aspect) nh = Math.round(nw * (g.startH / g.startW));
          updateItem(g.id, { w: Math.round(nw), h: Math.round(nh) });
        } else if (it.type === "text") {
          updateItem(g.id, { w: Math.max(120, Math.round(g.startW + dw)) });
        }
      } else if (g.mode === "scale") {
        const it = itemsRef.current.find((i) => i.id === g.id);
        if (!it) return;
        const dw = (cx - g.cx) / camRef.current.scale;
        const factor = Math.max(0.25, g.startScale + dw / 200);
        updateItem(g.id, { scale: factor });
      }
    }

    function onUp() {
      const g = gesture.current;
      gesture.current = null;
      if (!g) return;

      if (g.mode === "draw") {
        if (g.points.length > 1) {
          setItems((arr) => [
            ...arr,
            { id: uid(), type: "stroke", points: g.points, color: INK, width: g.marker ? MARKER_W : PEN_W, marker: g.marker },
          ]);
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

  // keyboard: tools, space-pan, delete, escape
  useEffect(() => {
    function down(e) {
      const typing = e.target.isContentEditable || /^(INPUT|TEXTAREA)$/.test(e.target.tagName || "");
      if (e.code === "Space" && !typing) {
        spaceRef.current = true;
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (typing) return;
      if (e.key === "Escape") {
        finishEditing();
        setSelection([]);
        setLasso(null);
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selRef.current.length) {
        e.preventDefault();
        deleteSelection();
      }
      if (e.key === "v" || e.key === "1") setTool("select");
      if (e.key === "t" || e.key === "2") setTool("text");
      if (e.key === "p" || e.key === "3") setTool("pen");
      if (e.key === "m" || e.key === "4") setTool("marker");
      if (e.key === "e" || e.key === "5") setTool("eraser");
      if (e.key === "h" || e.key === "6") setTool("hand");
      if (e.key === "r" && selRef.current.length === 1) {
        const it = itemsRef.current.find((i) => i.id === selRef.current[0]);
        if (it && (it.type === "text" || it.type === "image")) {
          updateItem(it.id, { rotation: ((it.rotation || 0) + 15) % 360 });
        }
      }
    }
    function up(e) {
      if (e.code === "Space") {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
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
    const ids = new Set(selRef.current);
    setItems((arr) => arr.filter((it) => !ids.has(it.id)));
    setSelection([]);
  }

  // ---- composed operators (functions made of functions) ----
  const opMap = useMemo(() => Object.fromEntries(operators.map((o) => [o.id, o])), [operators]);

  // run a function: pipelines chain their sub-functions (output -> next input)
  async function applyOpTree(op, material, image) {
    if (!op) return material;
    if (op.kind === "pipeline" && op.steps?.length) {
      let cur = material;
      let img = image;
      for (const sid of op.steps) {
        cur = await applyOpTree(opMap[sid], cur, img);
        img = null; // an image only feeds the first step
      }
      return cur;
    }
    return await runClaude(op.prompt || "", material, {
      image,
      system: executionSystem(operators, opMap, op),
    });
  }

  async function runOperator(op, targetIds) {
    let ids = targetIds || selRef.current;
    if (!ids.length) {
      const candidates = itemsRef.current.filter(
        (it) => (it.type === "text" && it.text?.trim()) || it.type === "image"
      );
      if (candidates.length === 1) ids = [candidates[0].id];
    }
    const idSet = new Set(ids);
    const texts = itemsRef.current
      .filter((it) => idSet.has(it.id) && it.type === "text" && it.text?.trim())
      .map((it) => it.text.trim());
    const image = itemsRef.current.find((it) => idSet.has(it.id) && it.type === "image")?.src || null;
    const material = texts.join("\n\n———\n\n");
    if (!material && !image) {
      showToast("click material on the board to select it, then apply a transform");
      return;
    }
    setSelection(ids);
    setAiBusy(true);
    try {
      const out = await applyOpTree(op, material, image);
      applyTransformResult(out, ids);
      showToast(`applied · ${op.name}`);
    } catch (err) {
      showToast(err.message || "Claude did not answer");
    } finally {
      setAiBusy(false);
    }
  }

  function applyOpDrop(opId, atClient) {
    const op = opMap[opId];
    if (!op) return;
    let ids = selRef.current;
    if (!ids.length && atClient) {
      const hit = itemAtPoint(atClient.x, atClient.y);
      if (hit && (hit.type === "text" || hit.type === "image")) ids = [hit.id];
    }
    if (!ids.length) {
      showToast("drop onto selected material");
      return;
    }
    runOperator(op, ids);
  }

  // ---- onboarding: build a whole toolbox for a role ----
  async function runOnboarding(role) {
    setOnboard({ step: "working", role, done: 0, total: 10, label: "imagining your functions…" });
    try {
      const list = await generateFunctionList(role, operators, opMap);
      if (!list.length) throw new Error("Could not imagine functions. Try again.");
      setOnboard((o) => ({ ...o, total: list.length }));
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
              prompt: `Apply the function "${fn.name}" (${fn.description}) to the input text and return only the result.`,
            };
          }
          done += 1;
          setOnboard((o) => (o && o.step === "working" ? { ...o, done } : o));
          return tree;
        })
      );
      const newOps = [];
      trees.forEach((t) => materializeTree(t, role, true, newOps));
      setOperators((prev) => [...prev, ...newOps]);
      localStorage.setItem(ONBOARDED_KEY, "1");
      setOnboard({ step: "done", role, count: trees.length });
    } catch (err) {
      setOnboard({ step: "error", message: err.message || "Something went wrong." });
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

  async function expandFunction(op) {
    setAiBusy(true);
    try {
      const tree = await expandOperatorSubtree(op, opMap, operators);
      const { rootId, ops } = treeToOperators(tree, { role: op.role || null, top: !!op.top });
      setOperators((arr) => {
        const map = Object.fromEntries(arr.map((o) => [o.id, o]));
        const removeIds = collectSubtreeIds(op.id, map);
        let next = arr.filter((o) => !removeIds.has(o.id));
        next = next.map((o) => {
          if (o.kind === "pipeline" && o.steps?.includes(op.id)) {
            return { ...o, steps: o.steps.map((sid) => (sid === op.id ? rootId : sid)) };
          }
          return o;
        });
        return [...next, ...ops];
      });
      setExpanded((e) => ({ ...e, [rootId]: true, [op.id]: undefined }));
      showToast(`expanded · ${op.name}`);
    } catch (err) {
      showToast(err.message || "could not expand");
    } finally {
      setAiBusy(false);
    }
  }

  // ---- saved idea structures ----
  function captureSelectionAsStructure(extra = {}) {
    const ids = new Set(selRef.current);
    const sel = itemsRef.current.filter((it) => ids.has(it.id));
    if (!sel.length) {
      showToast("select material to save");
      return null;
    }
    const bb = selectionWorldBBox();
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
    setAiBusy(true);
    try {
      const out = await runClaude(samenessPrompt(labels), "", { system: boardSystem(operators, opMap), maxTokens: 2000 });
      const parsed = parseSameness(out);
      const num = nextStructNumber();
      const title = `#${num} · ${parsed.name}`;
      const center = viewportCenterWorld();
      const textId = uid();
      const body = `${parsed.name.toUpperCase()}\n\n${parsed.body}`;
      setItems((arr) => [
        ...arr,
        normalizeItem({ id: textId, type: "text", x: center.x, y: center.y, text: body, w: 420 }),
      ]);
      setSelection([textId]);
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
      showToast(`discovered · ${title}`);
    } catch (err) {
      showToast(err.message || "discovery failed");
    } finally {
      setAiBusy(false);
    }
  }

  const topFunctions = operators.filter((o) => o.top);
  const basics = operators.filter((o) => !o.role && !o.top);
  const paletteOps = operators.filter((o) => o.top || !o.role);

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

  function itemAtPoint(cx, cy) {
    const list = itemsRef.current;
    for (let i = list.length - 1; i >= 0; i--) {
      const it = list[i];
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

  function selectionWorldBBox() {
    const ids = new Set(selRef.current);
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

  // ---- pointer gestures on the board ----
  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest?.(".xform-handle, .xform-screen-layer, .board-rail, .dock, .zoom, .palette, .op-drag-grip, .struct-card")) return;
    const cx = e.clientX;
    const cy = e.clientY;
    const panning = spaceRef.current || toolRef.current === "hand";
    const t = toolRef.current;

    if (!e.target.closest?.(".board-text.editing")) finishEditing();

    const w = clientToWorld(cx, cy);
    const lp = vpLocal(cx, cy);

    if (panning) {
      gesture.current = { mode: "pan", cx, cy, cam: { ...camRef.current } };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      return;
    }

    if (t === "pen" || t === "marker") {
      gesture.current = { mode: "draw", marker: t === "marker", points: [w] };
      setDraft({ points: [w], marker: t === "marker" });
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
    input.onchange = () => input.files && input.files[0] && addImage(input.files[0]);
    input.click();
  }

  // double-click: edit an existing text, or write a new one
  function onDoubleClick(e) {
    if (e.target.closest?.(".board-rail, .dock, .zoom, .palette")) return;
    finishEditing();
    const hit = itemAtPoint(e.clientX, e.clientY);
    if (hit) {
      if (hit.type === "text") {
        setSelection([hit.id]);
        setEditing(hit.id);
      }
      return;
    }
    const w = clientToWorld(e.clientX, e.clientY);
    const id = uid();
    setItems((arr) => [...arr, normalizeItem({ id, type: "text", x: w.x, y: w.y, text: "" })]);
    setSelection([id]);
    setEditing(id);
  }

  // ---- the laboratory: AI on the selection ----
  function selectedTextMaterial() {
    const ids = new Set(selRef.current);
    return itemsRef.current
      .filter((it) => ids.has(it.id) && it.type === "text" && it.text.trim())
      .map((it) => it.text.trim());
  }
  function selectedImage() {
    const ids = new Set(selRef.current);
    return itemsRef.current.find((it) => ids.has(it.id) && it.type === "image")?.src || null;
  }

  function placeResults(texts) {
    const bb = selectionWorldBBox();
    const center = viewportCenterWorld();
    const startX = bb ? bb.minx : center.x;
    let y = bb ? bb.maxy + 60 : center.y;
    const newIds = [];
    const newItems = texts.map((t) => {
      const id = uid();
      newIds.push(id);
      const text = stripMd(t);
      const w = Math.min(520, Math.max(280, Math.round(text.length * 0.55 + 180)));
      return normalizeItem({ id, type: "text", x: startX, y, text, w });
    });
    setItems((arr) => [...arr, ...newItems]);
    setSelection(newIds);
  }

  function applyTransformResult(out, ids) {
    const clean = stripMd(out || "").trim();
    if (!clean) return;
    const idSet = new Set(ids);
    const sel = itemsRef.current.filter((it) => idSet.has(it.id));
    const textOnly = sel.length === 1 && sel[0].type === "text" && !sel.some((it) => it.type === "image");
    if (textOnly) {
      updateItem(sel[0].id, { text: clean });
      setSelection([sel[0].id]);
      return;
    }
    placeResults([clean]);
  }

  async function runAI(prompt, { multi = false } = {}) {
    const texts = selectedTextMaterial();
    const image = selectedImage();
    const material = texts.join("\n\n———\n\n");
    if (!material && !image) {
      showToast("select some text or an image first");
      return;
    }
    setAiBusy(true);
    try {
      const out = await runClaude(prompt, material, { image, system: boardSystem(operators, opMap) });
      if (multi) {
        const parts = out
          .split(/\n+/)
          .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
          .filter((l) => l.length > 1);
        placeResults(parts.length ? parts : [out]);
      } else {
        applyTransformResult(out, selRef.current);
      }
    } catch (err) {
      showToast(err.message || "Claude did not answer");
    } finally {
      setAiBusy(false);
    }
  }

  const AI = {
    operator: (op) => runOperator(op),
    custom: (instruction) => runAI(`${instruction}\n\nApply this to the material. Return only the result.`),
    combine: () =>
      runAI("Synthesize the following fragments into one tight, original idea that captures what they share and where they point. Return only that idea."),
    split: () =>
      runAI("Break the material into its distinct underlying sub-ideas. Return a short list, one idea per line, no numbering.", { multi: true }),
    ask: (q) => runAI(`Using only the material provided, answer this question clearly and concretely.\n\nQuestion: ${q}`),
    sameness: () => runSamenessDiscovery(),
    saveStructure: () => captureSelectionAsStructure(),
  };

  // ---- render ----
  const selBBox = selection.length ? selectionWorldBBox() : null;
  const selItem = selection.length === 1 ? items.find((it) => it.id === selection[0]) : null;
  const canTransform = selItem && (selItem.type === "text" || selItem.type === "image");
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
  const aiMenuPos = selScreenBBox && !editing && !gesture.current
    ? {
        x: clamp(selScreenBBox.cx, RAIL_W + 120, window.innerWidth - 120),
        y: selScreenBBox.top < 100 ? selScreenBBox.bottom + 14 : selScreenBBox.top - 14,
        below: selScreenBBox.top < 100,
      }
    : null;
  const cursorClass =
    spaceDown || tool === "hand"
      ? "cur-grab"
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
        className="board-rail"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(OP_MIME) || e.dataTransfer.types.includes(STRUCT_MIME)) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const opId = e.dataTransfer.getData(OP_MIME);
          if (opId) {
            applyOpDrop(opId);
            return;
          }
          const structId = e.dataTransfer.getData(STRUCT_MIME);
          if (structId) applyStructureDrop(structId);
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
        </div>
        {railTab === "functions" ? (
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
                      onApply={(o) => runOperator(o)}
                      onEdit={openEditFunction}
                      onExpand={expandFunction}
                      busy={aiBusy}
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
                      onApply={(o) => runOperator(o)}
                      onEdit={openEditFunction}
                      onExpand={expandFunction}
                      busy={aiBusy}
                      flat
                    />
                  ))}
                </>
              )}
              {basics.length === 0 && topFunctions.length === 0 && (
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
                    onPlant={() => plantStructure(struct)}
                    onDelete={() => deleteStructure(struct.id)}
                  />
                ))
              )}
            </div>
          </>
        )}
        {selection.length > 0 && railTab === "functions" && (
          <div className="rail-hint">{selection.length} selected · drag ⠿ onto canvas</div>
        )}
      </aside>

      <div className={"board-main" + (dropReady ? " drop-ready" : "")}>
      <div
        ref={viewportRef}
        className={"viewport " + cursorClass}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if (
            e.dataTransfer.types.includes(OP_MIME) ||
            e.dataTransfer.types.includes(STRUCT_MIME) ||
            e.dataTransfer.types.includes("Files")
          ) {
            e.preventDefault();
            setDropReady(true);
          }
        }}
        onDragLeave={() => setDropReady(false)}
        onDrop={(e) => {
          setDropReady(false);
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
      >
        <div
          className="world"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
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
                  stroke={it.color}
                  strokeWidth={it.width}
                  strokeOpacity={it.marker ? 0.32 : 0.95}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={selection.includes(it.id) ? "sel" : ""}
                />
              ))}
            {draft && draft.points.length > 1 && (
              <polyline
                points={draft.points.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={INK}
                strokeWidth={draft.marker ? MARKER_W : PEN_W}
                strokeOpacity={draft.marker ? 0.32 : 0.95}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
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
                  className={"board-img" + (selection.includes(it.id) ? " sel" : "")}
                  src={it.src}
                  style={{ ...itemStyle(it), width: it.w, height: it.h }}
                  draggable={false}
                  alt=""
                />
              ) : (
                <BoardText
                  key={it.id}
                  item={it}
                  selected={selection.includes(it.id)}
                  editing={editing === it.id}
                  onCommit={(text) => commitEdit(it.id, text)}
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
            />
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
          double-click to write · drag functions ⠿ or structures onto canvas
        </div>
      )}

      {/* AI palette over the selection */}
      {aiMenuPos && (
        <AIPalette
          pos={aiMenuPos}
          busy={aiBusy}
          operators={paletteOps}
          opMap={opMap}
          textCount={selectedTextMaterial().length}
          selectionCount={selection.length}
          onAction={AI}
          onDelete={deleteSelection}
          onNewOperator={openCreateFunction}
          onEditOperator={openEditFunction}
        />
      )}

      {/* bottom tool dock — centered on canvas area */}
      <div className="dock">
        {[
          ["select", "↖", "select / move (V)"],
          ["hand", "✋", "pan (H)"],
          ["text", "T", "text (T)"],
          ["pen", "✎", "pen (P)"],
          ["marker", "▔", "marker (M)"],
          ["eraser", "⌫", "eraser (E)"],
        ].map(([id, glyph, title]) => (
          <button
            key={id}
            className={"tool" + (tool === id ? " on" : "")}
            title={title}
            onClick={() => setTool(id)}
          >
            {glyph}
          </button>
        ))}
        <span className="dock-sep" />
        <button className="tool" title="add image" onClick={pickImage}>
          ▢
        </button>
      </div>

      {/* zoom controls */}
      <div className="zoom">
        <button onClick={() => setCamera((c) => zoomCamera(c, 1 / 1.2))}>−</button>
        <button className="zoom-pct" onClick={() => setCamera((c) => ({ ...c, scale: 1 }))}>
          {Math.round(camera.scale * 100)}%
        </button>
        <button onClick={() => setCamera((c) => zoomCamera(c, 1.2))}>+</button>
      </div>
      </div>

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

function BoardText({ item, selected, editing, onCommit }) {
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
      className={"board-text" + (selected ? " sel" : "")}
      data-item={item.id}
      style={style}
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
    <div className="xform-screen-layer">
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
    </div>
  );
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

function DraggableOpCard({ op, opMap, expanded, onToggle, onApply, onEdit, onExpand, busy, flat }) {
  if (!op) return null;
  const steps = op.kind === "pipeline" && op.steps ? op.steps.map((id) => opMap[id]).filter(Boolean) : [];
  const open = expanded[op.id];
  return (
    <div className="op-card-wrap">
      <div className="op-card" title="click apply · drag ⠿ onto canvas">
        <div className="op-card-row">
          <span
            className="op-drag-grip"
            draggable={!busy}
            onDragStart={(e) => startOpDrag(e, op)}
            title="drag onto canvas"
          >
            ⠿
          </span>
          <button className="op-card-apply" disabled={busy} onClick={() => onApply(op)}>
            <span className="op-card-name">{op.name}</span>
            {open && op.description && <span className="op-card-desc">{op.description}</span>}
          </button>
          {!flat && steps.length > 0 && (
            <button className="op-card-toggle" onClick={() => onToggle(op.id)} title={`${steps.length} steps`}>
              {open ? "▾" : "▸"}
            </button>
          )}
          {onExpand && !flat && (
            <button className="op-card-expand" onClick={() => onExpand(op)} disabled={busy} title="expand layers">
              +
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
            <DraggableStep key={step.id} step={step} opMap={opMap} expanded={expanded} onToggle={onToggle} onApply={onApply} onEdit={onEdit} onExpand={onExpand} busy={busy} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}

function DraggableStep({ step, opMap, expanded, onToggle, onApply, onEdit, onExpand, busy, depth }) {
  const sub = step.kind === "pipeline" && step.steps ? step.steps.map((id) => opMap[id]).filter(Boolean) : [];
  const open = expanded[step.id];
  const isLeaf = !sub.length;
  return (
    <div className="op-step" style={{ paddingLeft: depth * 8 }}>
      <div className={"op-step-chip" + (isLeaf ? " leaf" : "")} title="click apply · drag ⠿">
        <span
          className="op-drag-grip"
          draggable={!busy}
          onDragStart={(e) => startOpDrag(e, step)}
          title="drag onto canvas"
        >
          ⠿
        </span>
        <button className="op-step-apply" disabled={busy} onClick={() => onApply(step)}>
          <span className="op-step-name">{step.name}</span>
          {open && step.description && <span className="op-step-desc">{step.description}</span>}
        </button>
        {!isLeaf && (
          <button className="op-step-toggle" onClick={() => onToggle(step.id)}>
            {open ? "▾" : "▸"}
          </button>
        )}
        {onExpand && !isLeaf && (
          <button className="op-step-expand" onClick={() => onExpand(step)} disabled={busy} title="expand">
            +
          </button>
        )}
        <button className="op-step-edit" onClick={() => onEdit(step)}>⚙</button>
      </div>
      {open &&
        sub.map((child) => (
          <DraggableStep key={child.id} step={child} opMap={opMap} expanded={expanded} onToggle={onToggle} onApply={onApply} onEdit={onEdit} onExpand={onExpand} busy={busy} depth={depth + 1} />
        ))}
    </div>
  );
}

function StructureCard({ struct, onPlant, onDelete }) {
  const preview = structurePreview(struct);
  const label = struct.structNum ? `#${struct.structNum}` : struct.kind || "idea";
  return (
    <div className="struct-card-wrap">
      <div className="struct-card" title="click to plant · drag ⠿ onto canvas">
        <div className="struct-card-row">
          <span
            className="op-drag-grip"
            draggable
            onDragStart={(e) => startStructDrag(e, struct)}
            title="drag onto canvas"
          >
            ⠿
          </span>
          <button className="struct-card-plant" onClick={onPlant}>
            <span className="struct-kind">{label}</span>
            <span className="struct-title">{struct.title || preview}</span>
            <span className="struct-preview">{preview}</span>
          </button>
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

function AIPalette({ pos, busy, operators, opMap, textCount, selectionCount, onAction, onDelete, onNewOperator, onEditOperator }) {
  const [mode, setMode] = useState(null); // null | 'transform' | 'ask' | 'custom'
  const [q, setQ] = useState("");
  const transform = pos.below ? "translate(-50%, 0)" : "translate(-50%, -100%)";
  const style = { left: pos.x, top: pos.y, transform };

  if (busy) {
    return (
      <div className="palette busy" style={style}>
        <span className="spinner" /> working…
      </div>
    );
  }

  if (mode === "ask" || mode === "custom") {
    const placeholder = mode === "ask" ? "ask a question about this…" : "describe a transformation…";
    return (
      <div className="palette" style={style}>
        <input
          autoFocus
          className="palette-input"
          placeholder={placeholder}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && q.trim()) {
              mode === "ask" ? onAction.ask(q.trim()) : onAction.custom(q.trim());
              setMode(null);
              setQ("");
            }
            if (e.key === "Escape") setMode(null);
          }}
        />
        <button className="p-btn" onClick={() => setMode(null)}>
          ←
        </button>
      </div>
    );
  }

  if (mode === "transform") {
    return (
      <div className="palette col" style={style}>
        <div className="palette-row head">
          <button className="p-btn ghost" onClick={() => setMode(null)}>
            ←
          </button>
          <span className="palette-title">transform</span>
        </div>
        <div className="op-grid">
          {operators.map((op) => (
            <button
              key={op.id}
              className="op-chip"
              draggable
              onDragStart={(e) => startOpDrag(e, op)}
              onClick={() => onAction.operator(op)}
              onContextMenu={(e) => {
                e.preventDefault();
                onEditOperator(op);
              }}
              title="drag or click · right-click to edit"
            >
              {op.name}
            </button>
          ))}
          <button className="op-chip add" onClick={onNewOperator}>
            + new
          </button>
        </div>
        <button className="p-btn wide" onClick={() => setMode("custom")}>
          custom instruction…
        </button>
      </div>
    );
  }

  return (
    <div className="palette" style={style}>
      <button className="p-btn" onClick={() => setMode("transform")}>
        transform
      </button>
      <button className="p-btn" onClick={onAction.combine} disabled={textCount < 2}>
        combine
      </button>
      <button className="p-btn" onClick={onAction.split}>
        split
      </button>
      <button className="p-btn" onClick={() => setMode("ask")}>
        ask
      </button>
      <button className="p-btn" onClick={onAction.sameness} disabled={textCount < 2}>
        sameness
      </button>
      <button className="p-btn" onClick={onAction.saveStructure} disabled={!selectionCount} title="save to structures">
        save
      </button>
      <span className="p-sep" />
      <button className="p-btn danger" onClick={onDelete} title="delete selection">
        ⌫
      </button>
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
            I'll build you a toolbox of thinking functions — each one made of smaller functions — tuned to how you work.
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
            {state.count} functions built for a {state.role}. Expand one in the left rail to see its steps, drag transforms onto selected material, or click to apply.
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
  const op = editor.op || null;
  const isPipeline = op?.kind === "pipeline";

  const [tab, setTab] = useState("describe"); // describe | manual
  const [prose, setProse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null); // Claude JSON tree awaiting save

  const [name, setName] = useState(op?.name || "");
  const [description, setDescription] = useState(op?.description || "");
  const [prompt, setPrompt] = useState(op?.prompt || "");

  async function runDescribe() {
    const instruction = prose.trim();
    if (!instruction) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      let tree;
      if (isCreate) {
        tree = await createFunctionFromProse(instruction, operators, opMap);
      } else {
        tree = await editFunctionWithProse(op, opMap, instruction, operators);
      }
      setPreview(tree);
      setName(tree.name || name);
      setDescription(tree.description || description);
      if (tree.prompt) setPrompt(tree.prompt);
    } catch (err) {
      setError(err.message || "Could not build that function.");
    } finally {
      setBusy(false);
    }
  }

  function acceptPreview() {
    if (!preview) return;
    const { ops } = treeToOperators(preview, {
      role: op?.role || null,
      top: isCreate ? true : !!op?.top,
    });
    onSaveTree(isCreate ? null : op.id, ops);
  }

  function saveManual() {
    if (!name.trim()) return;
    if (isPipeline) {
      // pipeline metadata only — structure edits go through describe
      onSaveManual({
        ...op,
        name: name.trim(),
        description: description.trim(),
      });
      return;
    }
    const id = op?.id || uid();
    onSaveManual({
      id,
      kind: "prompt",
      name: name.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
      top: isCreate ? true : op?.top,
    });
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="fn-editor" onClick={(e) => e.stopPropagation()}>
        <div className="fn-head">
          <h3>{isCreate ? "create function" : "edit function"}</h3>
          <button className="fn-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="fn-tabs">
          <button className={"fn-tab" + (tab === "describe" ? " on" : "")} onClick={() => setTab("describe")}>
            describe
          </button>
          <button className={"fn-tab" + (tab === "manual" ? " on" : "")} onClick={() => setTab("manual")}>
            manual
          </button>
        </div>

        {tab === "describe" && (
          <div className="fn-pane">
            <p className="fn-hint">
              {isCreate
                ? "Describe what you want this function to do in plain English. Claude will design it and break it into sub-functions down to editable primitives."
                : "Tell Claude what to change — add a step, rewrite a prompt, rename it, make it sharper. It updates the whole function tree."}
            </p>

            {!isCreate && op && (
              <div className="fn-current">
                <div className="fn-current-label">current</div>
                <pre>{serializeTree(op, opMap)}</pre>
              </div>
            )}

            <textarea
              className="fn-prose"
              rows={4}
              autoFocus
              placeholder={
                isCreate
                  ? 'e.g. "Take messy meeting notes and extract action items, owners, and deadlines as a clean list"'
                  : 'e.g. "Add a step that checks for contradictions" or "Make the final output shorter and more direct"'
              }
              value={prose}
              onChange={(e) => setProse(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runDescribe();
              }}
            />

            {error && <div className="fn-error">{error}</div>}

            <button className="fn-generate" disabled={busy || !prose.trim()} onClick={runDescribe}>
              {busy ? (
                <>
                  <span className="spinner" /> building…
                </>
              ) : isCreate ? (
                "generate function"
              ) : (
                "apply changes"
              )}
            </button>

            {preview && (
              <div className="fn-preview">
                <div className="fn-preview-head">
                  <span className="fn-preview-label">preview</span>
                  <span className="fn-preview-name">{preview.name}</span>
                </div>
                {preview.description && <p className="fn-preview-desc">{preview.description}</p>}
                <FunctionPreviewTree node={preview} depth={0} />
                <div className="fn-preview-actions">
                  <button className="fn-secondary" onClick={() => setPreview(null)}>
                    revise
                  </button>
                  <button className="fn-primary" onClick={acceptPreview}>
                    {isCreate ? "add to toolbox" : "save changes"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "manual" && (
          <div className="fn-pane">
            <label>name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. stress-test thesis" />

            <label>description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="what goes in, what comes out"
            />

            {isPipeline && op ? (
              <>
                <label>structure</label>
                <p className="fn-hint small">
                  This is a composed function. To add, remove, or reorder steps, use the <strong>describe</strong> tab.
                </p>
                <div className="fn-tree-readonly">
                  <FunctionPreviewTreeFromOps root={op} opMap={opMap} depth={0} />
                </div>
              </>
            ) : (
              <>
                <label>prompt</label>
                <textarea
                  rows={7}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Precise instruction for Claude: what to do with the input text, and to return only the result."
                />
              </>
            )}
          </div>
        )}

        <div className="fn-foot">
          {!isCreate && op && (
            <button className="fn-del" onClick={() => onDelete(op.id)}>
              delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="fn-secondary" onClick={onClose}>
            cancel
          </button>
          {tab === "manual" && (
            <button
              className="fn-primary"
              disabled={!name.trim() || (!isPipeline && !prompt.trim())}
              onClick={saveManual}
            >
              save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// preview tree from Claude JSON (nested steps)
function FunctionPreviewTree({ node, depth }) {
  if (!node) return null;
  const children = node.steps || [];
  const isLeaf = !children.length;
  return (
    <div className="fn-tree-node" style={{ paddingLeft: depth * 16 }}>
      <div className="fn-tree-row">
        <span className={"fn-tree-dot" + (isLeaf ? " leaf" : "")} />
        <span className="fn-tree-name">{node.name}</span>
        {node.description && <span className="fn-tree-desc">{node.description}</span>}
      </div>
      {node.prompt && (
        <div className="fn-tree-prompt" style={{ paddingLeft: 16 + depth * 16 }}>
          {node.prompt}
        </div>
      )}
      {children.map((child, i) => (
        <FunctionPreviewTree key={i} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// preview tree from flat opMap (saved operators)
function FunctionPreviewTreeFromOps({ root, opMap, depth }) {
  if (!root) return null;
  const children = root.kind === "pipeline" && root.steps ? root.steps.map((id) => opMap[id]).filter(Boolean) : [];
  const isLeaf = root.kind === "prompt";
  return (
    <div className="fn-tree-node" style={{ paddingLeft: depth * 16 }}>
      <div className="fn-tree-row">
        <span className={"fn-tree-dot" + (isLeaf ? " leaf" : "")} />
        <span className="fn-tree-name">{root.name}</span>
        {root.description && <span className="fn-tree-desc">{root.description}</span>}
      </div>
      {root.prompt && (
        <div className="fn-tree-prompt" style={{ paddingLeft: 16 + depth * 16 }}>
          {root.prompt}
        </div>
      )}
      {children.map((child) => (
        <FunctionPreviewTreeFromOps key={child.id} root={child} opMap={opMap} depth={depth + 1} />
      ))}
    </div>
  );
}
