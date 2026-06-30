import React, { useEffect, useMemo, useRef, useState } from "react";

const ITEMS_KEY = "lens.board.items.v1";
const CAMERA_KEY = "lens.board.camera.v1";
const OPERATORS_KEY = "lens.board.operators.v1";
const OLD_SEEDS_KEY = "lens.seeds.v2"; // migrate ideas from the old node version

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

// The system prompt teaches Claude exactly how lens works, so every function
// it designs is composable, realistic, and decomposed down to editable primitives.
const LENS_SYSTEM = `You are the function-architect for "lens", an infinite thinking whiteboard where a person operates on their own notes with AI.

HOW LENS WORKS — internalize this completely:
- The user selects some material on the board (text, or an image) and applies a FUNCTION to it. The function transforms that material and writes the result back onto the board. Material flows in; transformed material flows out.
- A FUNCTION is a COMPOSITION, never a monolith. It is built from smaller functions, which are built from smaller functions, all the way down to PRIMITIVE OPERATORS. Functions comprise functions comprise functions.
- A FUNCTION is executed as a PIPELINE: the output of each step becomes the input to the very next step. Therefore a decomposition is an ORDERED sequence in which each step does real work on the result of the previous one. Order matters; later steps may assume earlier steps already ran.
- A PRIMITIVE OPERATOR is a LEAF: one atomic transformation, expressed as a precise instruction ("prompt") to you, the model. It receives the running text as its material and returns ONLY the transformed result — no preamble, no labels, no commentary, no meta-talk.
- The user can open any function in a toolbox, see every sub-function and primitive nested inside it, and EDIT any primitive's prompt by hand. So every layer must be legible and self-explanatory, and every leaf must be a genuinely reusable, expertly engineered prompt that stands on its own.

YOUR STANDARDS — non-negotiable:
- TRUE USEFULNESS: design for the operations this specific person actually repeats in their real workflow, the high-leverage moves that save real time or raise real quality. No filler, no generic "brainstorm ideas" fluff.
- REALISTIC: the pipeline should mirror how a sharp practitioner actually does the work, step by step, in the right order.
- DECOMPOSE TO PRIMITIVES: keep breaking steps down until each leaf does exactly ONE clear thing. Prefer more, smaller, sharper primitives over a few vague mega-steps. A leaf that does two things must be split.
- MAX-STRENGTH PROMPTS: write each leaf prompt to use Claude at full power — specific, demanding, role-aware instructions that produce expert-grade output. State exactly what to do with the input and exactly what to return. Bake in the relevant expertise, criteria, and format.
- CLOSED PIPELINE: a leaf may only rely on "the input text" (whatever the previous step produced). Never require information the pipeline hasn't yet created.
- STRUCTURE: composite nodes have "steps" and NO "prompt". Leaf nodes have "prompt" and NO "steps".
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
    "You execute a transformation on the user's thinking whiteboard. Return ONLY the transformed result — no preamble, labels, or commentary.";
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
    "You operate on selected material from the user's thinking whiteboard. Return ONLY the requested result.";
  if (compact) {
    sys += `\n\nThis user's personal library of functions and transformations — align your output with their established patterns:\n${compact}`;
  }
  return sys;
}

// role/profession -> the most valuable cognitive functions to automate
async function generateFunctionList(role, operators, opMap) {
  const hasLib = operators?.length > 0;
  const prompt = `The user is a: ${role}.

Design the 10 single most valuable FUNCTIONS this person would want on their lens whiteboard — the repeated, high-leverage cognitive operations they perform on notes, ideas, drafts, data, or documents in their real day-to-day work. Think about their actual workflow and where AI gives the biggest lift.
${hasLib ? "\nThey already have a personal library (see system context). Design NEW functions that complement it — do not duplicate existing names or purposes.\n" : ""}
For each function give:
- "name": 2-4 words, the verb-led operation (e.g. "Stress-test thesis", "Draft cold outreach").
- "description": one plain sentence a beginner instantly understands, stating what material goes in and what comes out.

Return ONLY JSON: {"functions":[{"name":"...","description":"..."}]} with exactly 10 functions, ordered from most to least frequently used.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 2000 });
  const j = parseJSON(out);
  return Array.isArray(j.functions) ? j.functions.slice(0, 10) : [];
}

// decompose one function into a deep tree of sub-functions ending in primitives
async function decomposeFunction(role, fn, operators, opMap) {
  const prompt = `The user is a: ${role}.

Decompose this ONE function into a deep tree of smaller functions, ending in primitive operators, exactly as lens executes them (a pipeline where each step's output feeds the next).
Tailor every name, description, and leaf prompt to the user's personal library in the system context — reuse their vocabulary and match their existing transformation patterns where relevant.

FUNCTION
name: ${fn.name}
description: ${fn.description}

Requirements:
- Break it into 2-5 ordered sub-functions that mirror how an expert ${role} actually performs this, in sequence.
- Recursively decompose sub-functions wherever they still bundle more than one operation, going 2-4 layers deep, until every leaf is a PRIMITIVE that does exactly one thing.
- Every LEAF must have a "prompt": a precise, max-strength instruction tailored to this user's library that transforms "the input text" (the previous step's output) and returns ONLY the result.
- Composite nodes have "steps" and NO "prompt". Leaf nodes have "prompt" and NO "steps".
- Names: 1-4 words. Descriptions: one short, clear sentence each.

Return ONLY JSON for THIS function:
{"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 6000 });
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
    if (Array.isArray(saved)) return saved;
    return migrateOldSeeds();
  });
  const [camera, setCamera] = useState(() => load(CAMERA_KEY, { x: 0, y: 0, scale: 1 }));
  const [operators, setOperators] = useState(() => {
    const s = load(OPERATORS_KEY, null);
    return Array.isArray(s) ? s : DEFAULT_OPERATORS;
  });

  const [tool, setTool] = useState("select"); // select | text | pen | marker | eraser
  const [selection, setSelection] = useState([]);
  const [editing, setEditing] = useState(null); // item id being edited
  const [draft, setDraft] = useState(null); // live stroke (world points)
  const [lasso, setLasso] = useState(null); // {x0,y0,x1,y1} client coords
  const [aiBusy, setAiBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [opEditor, setOpEditor] = useState(null); // operator being edited
  const [spaceDown, setSpaceDown] = useState(false);
  const [toolboxOpen, setToolboxOpen] = useState(true);
  const [expanded, setExpanded] = useState({}); // operator id -> open in toolbox tree
  const [onboard, setOnboard] = useState(() => (localStorage.getItem(ONBOARDED_KEY) ? null : { step: "role" }));

  const viewportRef = useRef(null);
  const gesture = useRef(null);
  const camRef = useRef(camera);
  const itemsRef = useRef(items);
  const toolRef = useRef(tool);
  const selRef = useRef(selection);
  const spaceRef = useRef(false);
  camRef.current = camera;
  itemsRef.current = items;
  toolRef.current = tool;
  selRef.current = selection;

  useEffect(() => localStorage.setItem(ITEMS_KEY, JSON.stringify(items)), [items]);
  useEffect(() => localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)), [camera]);
  useEffect(() => localStorage.setItem(OPERATORS_KEY, JSON.stringify(operators)), [operators]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }

  // ---- camera math (transform-origin is 0 0) ----
  const screenToWorld = (sx, sy) => {
    const c = camRef.current;
    return { x: (sx - c.x) / c.scale, y: (sy - c.y) / c.scale };
  };
  const worldToScreen = (wx, wy) => {
    const c = camRef.current;
    return { x: wx * c.scale + c.x, y: wy * c.scale + c.y };
  };

  // wheel: pan; cmd/ctrl+wheel: zoom toward cursor
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.0016);
        setCamera((c) => {
          const scale = clamp(c.scale * factor, 0.12, 4.5);
          const wx = (e.clientX - c.x) / c.scale;
          const wy = (e.clientY - c.y) / c.scale;
          return { scale, x: e.clientX - wx * scale, y: e.clientY - wy * scale };
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
        setSelection([]);
        setEditing(null);
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

  // paste image anywhere
  useEffect(() => {
    function onPaste(e) {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            addImage(f);
            return;
          }
        }
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

  async function runOperator(op) {
    const texts = selectedTextMaterial();
    const image = selectedImage();
    const material = texts.join("\n\n———\n\n");
    if (!material && !image) {
      showToast("select some text or an image first");
      return;
    }
    setAiBusy(true);
    try {
      const out = await applyOpTree(op, material, image);
      placeResults([out]);
    } catch (err) {
      showToast(err.message || "Claude did not answer");
    } finally {
      setAiBusy(false);
    }
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
      setToolboxOpen(true);
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
      if (oldRootId) {
        const map = Object.fromEntries(arr.map((o) => [o.id, o]));
        const removeIds = collectSubtreeIds(oldRootId, map);
        next = arr.filter((o) => !removeIds.has(o.id));
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

  const topFunctions = operators.filter((o) => o.top);
  const basics = operators.filter((o) => !o.role && !o.top);
  const paletteOps = operators.filter((o) => o.top || !o.role);

  function itemScreenBBox(it) {
    if (it.type === "stroke") {
      const xs = it.points.map((p) => worldToScreen(p.x, p.y).x);
      const ys = it.points.map((p) => worldToScreen(p.x, p.y).y);
      return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
    }
    const el = document.querySelector(`[data-item="${it.id}"]`);
    if (!el) {
      const p = worldToScreen(it.x, it.y);
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
          const a = worldToScreen(it.points[k - 1].x, it.points[k - 1].y);
          const b = worldToScreen(it.points[k].x, it.points[k].y);
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
      const a = screenToWorld(bb.left, bb.top);
      const b = screenToWorld(bb.right, bb.bottom);
      minx = Math.min(minx, a.x);
      miny = Math.min(miny, a.y);
      maxx = Math.max(maxx, b.x);
      maxy = Math.max(maxy, b.y);
    }
    return { minx, miny, maxx, maxy };
  }

  // ---- pointer gestures on the board ----
  function onPointerDown(e) {
    if (e.button === 1) return; // middle handled by browser pan? ignore
    const cx = e.clientX;
    const cy = e.clientY;
    const w = screenToWorld(cx, cy);
    const panning = spaceRef.current || toolRef.current === "hand";
    const t = toolRef.current;

    if (editing) setEditing(null);

    if (panning) {
      gesture.current = { mode: "pan", cx, cy, cam: { ...camRef.current } };
      return;
    }

    if (t === "pen" || t === "marker") {
      gesture.current = { mode: "draw", marker: t === "marker", points: [w] };
      setDraft({ points: [w], marker: t === "marker" });
      return;
    }

    if (t === "eraser") {
      gesture.current = { mode: "erase" };
      const hit = itemAtPoint(cx, cy);
      if (hit) setItems((arr) => arr.filter((it) => it.id !== hit.id));
      return;
    }

    if (t === "text") {
      const id = uid();
      setItems((arr) => [...arr, { id, type: "text", x: w.x, y: w.y - 14, text: "" }]);
      setSelection([id]);
      setEditing(id);
      setTool("select");
      return;
    }

    // select tool
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
      gesture.current = { mode: "move", cx, cy, ids: nextSel, moved: 0, hitId: hit.id };
    } else {
      if (!e.shiftKey) setSelection([]);
      gesture.current = { mode: "lasso", x0: cx, y0: cy, x1: cx, y1: cy };
      setLasso({ x0: cx, y0: cy, x1: cx, y1: cy });
    }
  }

  function onPointerMove(e) {
    const g = gesture.current;
    if (!g) return;
    const cx = e.clientX;
    const cy = e.clientY;

    if (g.mode === "pan") {
      setCamera({ ...g.cam, x: g.cam.x + (cx - g.cx), y: g.cam.y + (cy - g.cy) });
    } else if (g.mode === "draw") {
      const w = screenToWorld(cx, cy);
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
      g.moved += Math.abs(cx) + Math.abs(cy);
      const ids = new Set(g.ids);
      setItems((arr) =>
        arr.map((it) => {
          if (!ids.has(it.id)) return it;
          if (it.type === "stroke") return { ...it, points: it.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
          return { ...it, x: it.x + dx, y: it.y + dy };
        })
      );
    } else if (g.mode === "lasso") {
      g.x1 = cx;
      g.y1 = cy;
      setLasso({ x0: g.x0, y0: g.y0, x1: cx, y1: cy });
    }
  }

  function onPointerUp() {
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
      const L = Math.min(g.x0, g.x1), R = Math.max(g.x0, g.x1);
      const T = Math.min(g.y0, g.y1), B = Math.max(g.y0, g.y1);
      if (Math.abs(R - L) < 4 && Math.abs(B - T) < 4) return;
      const picked = itemsRef.current
        .filter((it) => {
          const bb = itemScreenBBox(it);
          return bb.left < R && bb.right > L && bb.top < B && bb.bottom > T;
        })
        .map((it) => it.id);
      setSelection(picked);
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
      const center = at || screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
      const scale = Math.min(1, 260 / w);
      const id = uid();
      setItems((arr) => [...arr, { id, type: "image", x: center.x, y: center.y, w: Math.round(w * scale), h: Math.round(h * scale), src }]);
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
    const hit = itemAtPoint(e.clientX, e.clientY);
    if (hit) {
      if (hit.type === "text") {
        setSelection([hit.id]);
        setEditing(hit.id);
      }
      return;
    }
    const w = screenToWorld(e.clientX, e.clientY);
    const id = uid();
    setItems((arr) => [...arr, { id, type: "text", x: w.x, y: w.y - 14, text: "" }]);
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
    const startX = bb ? bb.minx : screenToWorld(window.innerWidth / 2, 200).x;
    let y = bb ? bb.maxy + 60 : screenToWorld(0, 240).y;
    const newIds = [];
    const newItems = texts.map((t) => {
      const id = uid();
      newIds.push(id);
      const item = { id, type: "text", x: startX, y, text: stripMd(t) };
      y += 46 + Math.min(220, stripMd(t).length * 0.32);
      return item;
    });
    setItems((arr) => [...arr, ...newItems]);
    setSelection(newIds);
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
        placeResults([out]);
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
    sameness: () =>
      runAI(
        "These are distinct things from different domains. Find the hidden structural sameness — the deep invariant pattern they all share beneath their surface differences. Name the structure in a short phrase, then explain it in 2-3 sentences. Return only that."
      ),
  };

  // ---- render ----
  const selBBox = selection.length ? selectionWorldBBox() : null;
  const aiMenuPos = selBBox && !editing && !gesture.current ? worldToScreen(selBBox.minx, selBBox.miny) : null;
  const cursorClass =
    spaceDown ? "cur-grab" : tool === "text" ? "cur-text" : tool === "pen" || tool === "marker" ? "cur-draw" : tool === "eraser" ? "cur-erase" : "cur-select";

  return (
    <div className="board-app">
      <div
        ref={viewportRef}
        className={"viewport " + cursorClass}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files?.length) {
            e.preventDefault();
            const w = screenToWorld(e.clientX, e.clientY);
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
                  style={{ left: it.x, top: it.y, width: it.w }}
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
          {selBBox && selection.length > 0 && (
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

        {/* live lasso (screen space) */}
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

      {/* brand */}
      <div className="brand">lens</div>

      {/* empty hint */}
      {items.length === 0 && (
        <div className="empty-hint">
          double-click to write · draw with the pen · drag to select and operate
        </div>
      )}

      {/* AI palette over the selection */}
      {aiMenuPos && (
        <AIPalette
          pos={aiMenuPos}
          busy={aiBusy}
          operators={paletteOps}
          textCount={selectedTextMaterial().length}
          onAction={AI}
          onDelete={deleteSelection}
          onNewOperator={openCreateFunction}
          onEditOperator={openEditFunction}
        />
      )}

      {/* toolbox: your functions */}
      <aside className={"toolbox" + (toolboxOpen ? "" : " closed")}>
        <button className="tb-handle" onClick={() => setToolboxOpen((v) => !v)} title="toolbox">
          {toolboxOpen ? "›" : "‹"}
        </button>
        {toolboxOpen && (
          <div className="tb-body">
            <div className="tb-head">
              <span className="tb-title">toolbox</span>
              <div className="tb-head-btns">
                <button title="set up for a role" onClick={() => setOnboard({ step: "role" })}>
                  ↻
                </button>
              </div>
            </div>

            <button className="tb-create" onClick={openCreateFunction}>
              + create function
            </button>

            {topFunctions.length > 0 && (
              <div className="tb-section">
                <div className="tb-section-label">functions</div>
                {topFunctions.map((op) => (
                  <OperatorNode
                    key={op.id}
                    op={op}
                    depth={0}
                    opMap={opMap}
                    expanded={expanded}
                    onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                    onApply={(o) => runOperator(o)}
                    onEdit={openEditFunction}
                  />
                ))}
              </div>
            )}

            <div className="tb-section">
              <div className="tb-section-label">basics</div>
              {basics.map((op) => (
                <OperatorNode
                  key={op.id}
                  op={op}
                  depth={0}
                  opMap={opMap}
                  expanded={expanded}
                  onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                  onApply={(o) => runOperator(o)}
                  onEdit={openEditFunction}
                />
              ))}
              {basics.length === 0 && topFunctions.length === 0 && (
                <p className="tb-empty">no functions yet — set up for a role</p>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* bottom tool dock */}
      <div className="dock">
        {[
          ["select", "↖", "select / move (V)"],
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
        <button onClick={() => setCamera((c) => zoomBy(c, 1 / 1.2))}>−</button>
        <button className="zoom-pct" onClick={() => setCamera((c) => ({ ...c, scale: 1 }))}>
          {Math.round(camera.scale * 100)}%
        </button>
        <button onClick={() => setCamera((c) => zoomBy(c, 1.2))}>+</button>
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

function zoomBy(c, factor) {
  const scale = clamp(c.scale * factor, 0.12, 4.5);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const wx = (cx - c.x) / c.scale;
  const wy = (cy - c.y) / c.scale;
  return { scale, x: cx - wx * scale, y: cy - wy * scale };
}

function BoardText({ item, selected, editing, onCommit }) {
  const ref = useRef(null);
  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }, [editing]);

  if (editing) {
    return (
      <div
        ref={ref}
        className="board-text editing"
        data-item={item.id}
        contentEditable
        suppressContentEditableWarning
        style={{ left: item.x, top: item.y }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onBlur={() => onCommit(ref.current ? ref.current.innerText : item.text)}
        onKeyDown={(e) => {
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
            e.preventDefault();
            onCommit(ref.current.innerText);
          }
          e.stopPropagation();
        }}
        dangerouslySetInnerHTML={{ __html: escapeHtml(item.text) }}
      />
    );
  }
  return (
    <div
      className={"board-text" + (selected ? " sel" : "")}
      data-item={item.id}
      style={{ left: item.x, top: item.y }}
    >
      {item.text}
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

function AIPalette({ pos, busy, operators, textCount, onAction, onDelete, onNewOperator, onEditOperator }) {
  const [mode, setMode] = useState(null); // null | 'transform' | 'ask' | 'custom'
  const [q, setQ] = useState("");
  const style = { left: clamp(pos.x, 90, window.innerWidth - 90), top: Math.max(70, pos.y - 16) };

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
              onClick={() => onAction.operator(op)}
              onContextMenu={(e) => {
                e.preventDefault();
                onEditOperator(op);
              }}
              title="click to apply · right-click to edit"
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
      <span className="p-sep" />
      <button className="p-btn danger" onClick={onDelete} title="delete selection">
        ⌫
      </button>
    </div>
  );
}

function OperatorNode({ op, depth, opMap, expanded, onToggle, onApply, onEdit }) {
  if (!op) return null;
  const children = op.kind === "pipeline" && op.steps ? op.steps : [];
  const open = expanded[op.id];
  return (
    <div className="tb-node">
      <div className="tb-row" style={{ paddingLeft: 8 + depth * 14 }}>
        {children.length ? (
          <button className="tb-caret" onClick={() => onToggle(op.id)}>
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="tb-dot" />
        )}
        <div className="tb-text" onClick={() => onApply(op)} title="apply to selection">
          <span className="tb-name">{op.name}</span>
          {op.description && <span className="tb-desc">{op.description}</span>}
        </div>
        <button className="tb-edit" title="edit" onClick={() => onEdit(op)}>
          ⚙
        </button>
      </div>
      {open &&
        children.map((id) => (
          <OperatorNode
            key={id}
            op={opMap[id]}
            depth={depth + 1}
            opMap={opMap}
            expanded={expanded}
            onToggle={onToggle}
            onApply={onApply}
            onEdit={onEdit}
          />
        ))}
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
            {state.count} functions built for a {state.role}. Open one in the toolbox to see the smaller functions inside it,
            or select text and apply a function.
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
