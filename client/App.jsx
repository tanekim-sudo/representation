import React, { useEffect, useMemo, useRef, useState } from "react";

const SEEDS_KEY = "lens.seeds.v2";
const EDGES_KEY = "lens.edges.v2";
const CAMERA_KEY = "lens.camera.v2";
const SYMBOLS_KEY = "lens.operators.v2";
const NODES_KEY = "lens.savednodes.v1";
const STRUCTSEQ_KEY = "lens.structseq.v1";

const MAX_RESPONSES = 6;
const CANVAS_SIZE = 256;

const STAR_COLORS = ["#20201d"];

const EMOJI_CHOICES = [
  "✨", "📝", "🔍", "🌍", "🎯", "💡", "🧹", "📌", "🔥", "🧠",
  "⚡", "🪄", "📖", "✂️", "🎨", "🧪", "🗜️", "💬", "🔧", "⭐",
];
const COLOR_CHOICES = ["#20201d"];
const PEN_COLORS = ["#20201d", "#46443c", "#6b6760", "#928d80", "#b8b2a3"];

// The primitive grammar of idea-operations. Arities:
//   1            unary — transforms the selected idea into one child
//   "many"       unary fan-out — produces several children
//   2            binary — needs a second idea picked on the canvas
//   "many-select" collapses several picked ideas into one
//   "analysis"   a perceptual lens — emits an analysis node, doesn't alter meaning
const OPS = {
  // ── primitives (the + - x / of ideas) ──
  reorient: { sym: "↺", name: "reorient", arity: 1, group: "primitive", color: "#8ab4ff",
    prompt: "Reorient this idea: shift its frame of reference or vantage point so the same thing is seen from a fundamentally different angle. Return only the reoriented idea, no preamble." },
  integrate: { sym: "⊕", name: "integrate", arity: 2, group: "primitive", color: "#34d399",
    prompt: "Integrate these two ideas into one unified idea that fuses their structures into a single coherent whole. Return only the integrated idea, no preamble." },
  release: { sym: "⊖", name: "release", arity: 1, group: "primitive", color: "#fca5a5",
    prompt: "Release this idea: identify its central constraint, assumption, or excess and strip it away — return what remains, lighter and freer, once that is let go. Return only the resulting idea, no preamble." },
  reciprocate: { sym: "⇄", name: "reciprocate", arity: 2, group: "primitive", color: "#f0abfc",
    prompt: "Reciprocate: articulate the mutual, two-way exchange between these two ideas — what each gives to and receives from the other, as a single relational idea. Return only that idea, no preamble." },
  amplify: { sym: "↑", name: "amplify", arity: 1, group: "primitive", color: "#fcd34d",
    prompt: "Amplify this idea: intensify it, raise its stakes, push it toward its boldest and most extreme form. Return only the amplified idea, no preamble." },
  reduce: { sym: "↓", name: "reduce", arity: 1, group: "primitive", color: "#7dd3fc",
    prompt: "Reduce this idea to its minimal essential core — the smallest form that still carries its full meaning. Return only the reduced idea, no preamble." },
  harmonize: { sym: "≈", name: "harmonize", arity: 2, group: "primitive", color: "#5eead4",
    prompt: "Harmonize these two ideas: resolve their tension into a balanced form in which both coexist without contradiction. Return only the harmonized idea, no preamble." },
  differentiate: { sym: "✦", name: "differentiate", arity: "many", group: "primitive", color: "#c084fc",
    prompt: "Differentiate this idea into its distinct facets — the meaningfully different forms or aspects latent within it. Return each on its own line, no numbering, no bullets, no preamble." },
  iterate: { sym: "⟳", name: "iterate", arity: 1, group: "primitive", color: "#60a5fa",
    prompt: "Iterate this idea: apply one more refining pass, tightening and improving it as if producing the next draft. Return only the iterated idea, no preamble." },
  transcend: { sym: "⤴", name: "transcend", arity: 1, group: "primitive", color: "#a78bfa",
    prompt: "Transcend this idea: rise one level of abstraction to the larger principle or paradigm it is an instance of. Return only the transcendent idea, no preamble." },

  // ── maps (perceptual lenses) ──
  map: { sym: "❋", name: "map", arity: "analysis", group: "map", color: "#22d3ee",
    prompt: "Search across ALL domains (physics, biology, economics, art, theology, engineering, social systems, mathematics...) for problems and structures with the SAME deep structure as this idea. Return, with short headers:\n• Deep structure: the abstract pattern in one line\n• Isomorphisms: 3-5 concrete structural matches in other domains\n• Solution families: the kinds of solutions those domains already use\n• Latent equivalences: non-obvious things this idea is secretly the same as\nBe specific and concrete." },
  spacemap: { sym: "◎", name: "spacemap", arity: "analysis", group: "map", color: "#fb7185",
    prompt: "Locate this idea within the cultural solution manifold — how explored this region already is. Return, with short headers:\n• Novelty: how closely it resembles what has already been done (low/med/high + one line)\n• Nearest neighbors: the closest prior art or existing analogues\n• Density: how crowded / well-trodden this region of idea-space is\n• Gradient to novelty: the specific direction that is most unexplored from here\nBe specific and concrete." },

  // ── interactions (composed moves) ──
  extend: { sym: "⟿", name: "extend", arity: 1, group: "interaction", color: "#34d399",
    prompt: "Continue this idea forward: carry its line of thought one decisive step further, as the natural next move along the same trajectory. Return only the continued idea, no preamble." },
  split: { sym: "⨁", name: "split", arity: "many", group: "interaction", color: "#fcd34d",
    prompt: "Find the central tension inside this idea and fork it there into 2-3 divergent ideas, each fully committing to one side of that tension. Return each on its own line, no numbering, no bullets, no preamble." },
  resonate: { sym: "∿", name: "resonate", arity: 1, group: "interaction", color: "#f0abfc",
    prompt: "Take the deep structure of this idea and re-embody it in a COMPLETELY different domain (e.g. recast a social idea as biology, music, or geology). Start by naming the target domain, then state the resonant idea in one or two sentences. Return only that, no preamble." },
  stabilize: { sym: "⊙", name: "stabilize", arity: "many-select", group: "interaction", color: "#5e6b80",
    prompt: "Collapse these branches into the shared structure they hold in common — the stable invariant underneath all of them. Return only that shared structure, as a single idea, no preamble." },

  // ── discovery (the discovery engine) ──
  sameness: { sym: "⟁", name: "find hidden sameness", arity: "many-select", group: "discovery", color: "#b5832b",
    prompt: "" },
};

const OP_GROUPS = [
  { key: "primitive", label: "primitives" },
  { key: "interaction", label: "interactions" },
  { key: "map", label: "maps" },
  { key: "discovery", label: "discovery" },
];

// Prompt for the discovery engine: find the deep isomorphism across N disparate things.
function samenessPrompt(items) {
  const body = items
    .map((t, i) => `(${i + 1}) ${t}`)
    .join("\n");
  return `You are a discovery engine that finds HIDDEN SAMENESS — the deep structural isomorphism shared by seemingly unrelated things.

Here are ${items.length} things:
${body}

Find the single deepest structure they all share — the abstract pattern that is secretly the same across all of them. Ignore surface similarity; reach for the invariant mechanism.

Return EXACTLY this format, no preamble:
NAME: <a vivid 2-5 word name for the discovered structure>
STRUCTURE: <one or two sentences stating the shared deep structure precisely>
MAPPING:
${items.map((_, i) => `- (${i + 1}) → <how this thing instantiates the structure, one line>`).join("\n")}
WHY IT MATTERS: <one sentence on what this isomorphism unlocks or predicts>`;
}

function parseSameness(out) {
  const grab = (re) => {
    const m = out.match(re);
    return m ? m[1].trim() : "";
  };
  const name = grab(/NAME:\s*(.+)/i);
  return { name: name || "Hidden Structure", body: out.trim() };
}

function opsIn(group) {
  return Object.entries(OPS)
    .filter(([, o]) => o.group === group)
    .map(([k, o]) => ({ key: k, ...o }));
}

// Provenance / formation metadata for replay (invisible until a node is replayed)
const VERB_META = {
  plant: { label: "planted", color: "#5e6b80", symbol: "✦" },
  write: { label: "written", color: "#cbd5ff", symbol: "✎" },
  operator: { label: "operator", color: "#8ab4ff", symbol: "◈" },
  // legacy kinds from earlier versions
  evolve: { label: "evolved", color: "#a78bfa", symbol: "❂" },
  branch: { label: "branched", color: "#5eead4", symbol: "❧" },
  combine: { label: "integrated", color: "#34d399", symbol: "⊕" },
};
Object.entries(OPS).forEach(([k, o]) => {
  VERB_META[k] = { label: o.name, color: o.color, symbol: o.sym };
});

// ── Highlighter grammar: operations on extracted thought-particles ──
// kind: extract (instant, no AI) | one | fan | binary | analysis-binary
const FRAG_OPS = {
  isolate: { sym: "⟐", name: "isolate", kind: "extract", color: "#5e6b80",
    hint: "pull this fragment out as its own particle" },
  collide: { sym: "⚡", name: "collide", kind: "binary", color: "#fcd34d",
    hint: "crash this into another fragment",
    prompt: "These two thought-fragments collide. Return the single new idea that emerges from their collision — the spark, friction, or fusion produced when they crash together. Return only that idea, no preamble." },
  synthesize: { sym: "⊕", name: "synthesize", kind: "one", color: "#34d399",
    hint: "grow this fragment into a fuller idea",
    prompt: "Synthesize this fragment into a single fuller, realized idea — develop what it is reaching toward without padding. Return only the idea, no preamble." },
  mutate: { sym: "✦", name: "mutate", kind: "fan", color: "#c084fc",
    hint: "spawn mutations of this fragment",
    prompt: "Mutate this fragment into 3 distinct variations — each a different mutation of the same seed-thought, pushing it in a different direction. Return each on its own line, no numbering, no bullets, no preamble." },
  compare: { sym: "⇄", name: "compare", kind: "analysis-binary", color: "#22d3ee",
    hint: "compare this with another fragment",
    prompt: "Compare these two thought-fragments. Return, with short headers:\n• Shared structure\n• Key differences\n• The tension between them\n• What each reveals about the other\nBe concrete." },
};
const FRAG_ORDER = ["isolate", "collide", "synthesize", "mutate", "compare"];
Object.entries(FRAG_OPS).forEach(([k, o]) => {
  VERB_META[k] = { label: o.name, color: o.color, symbol: o.sym };
});

// What a floating thing can be. Everything is matter in the field.
const INK = "#20201d";
const KINDS = {
  idea: { glyph: "✦", color: INK, label: "idea" },
  question: { glyph: "❓", color: INK, label: "question" },
  experiment: { glyph: "⚗", color: INK, label: "experiment" },
  fragment: { glyph: "❖", color: INK, label: "fragment" },
  structure: { glyph: "⬡", color: INK, label: "structure" },
  observation: { glyph: "◉", color: INK, label: "observation" },
  memory: { glyph: "❁", color: INK, label: "memory" },
  book: { glyph: "▤", color: INK, label: "book" },
  person: { glyph: "☻", color: INK, label: "person" },
  experience: { glyph: "✷", color: INK, label: "experience" },
};
const KIND_ORDER = Object.keys(KINDS);

// Rotating prompts for the entry portal.
const ENTRY_EXAMPLES = [
  "discipleship",
  "marriage",
  "exercise",
  "startup building",
  "learning piano",
];

const BINARY_ARITIES = new Set([2]);

function lastText(h) {
  return h && h.length ? h[h.length - 1].to ?? "" : "";
}

// Capture a manual edit as a formation stage if the text drifted since last step
function withWrite(seed) {
  const h = seed.history && seed.history.length ? seed.history : [{ kind: "plant", op: null, to: "" }];
  if ((seed.text || "") !== lastText(h)) return [...h, { kind: "write", op: null, to: seed.text || "" }];
  return h;
}

const DEFAULT_SYMBOLS = [
  {
    id: "op-summarize",
    name: "Distill",
    emoji: "🌀",
    color: "#22d3ee",
    image: null,
    strokes: [],
    prompt: "Distill this into its sharpest, most essential form.",
    count: 1,
  },
  {
    id: "op-question",
    name: "Question",
    emoji: "💬",
    color: "#fcd34d",
    image: null,
    strokes: [],
    prompt: "Ask the most provocative questions this idea raises.",
    count: 3,
  },
];

function uid() {
  return "s-" + Math.random().toString(36).slice(2, 9);
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function pickColor() {
  return STAR_COLORS[Math.floor(Math.random() * STAR_COLORS.length)];
}

function makeSeed(x, y, text = "", extra = {}) {
  const { history, ...rest } = extra;
  return {
    id: uid(),
    type: "text",
    x,
    y,
    text,
    color: pickColor(),
    born: Date.now(),
    ...rest,
    history: history || [{ kind: "plant", op: null, to: text }],
  };
}

async function runClaude(prompt, text, count = 1, image = null) {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, text, count, image }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "The void did not answer.");
  return data.outputs || [];
}

// Read a File/Blob into a downscaled data URL (keeps payloads small for vision)
function fileToImage(file, max = 1024) {
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
        resolve(canvas.toDataURL(type, 0.86));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function ask(prompt, text) {
  const outs = await runClaude(prompt, text, 1);
  return outs[0] || "";
}

function parseJourney(raw) {
  let s = (raw || "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

// Ask Claude to reconstruct the genuine intellectual journey behind a node.
async function narrateJourney(history) {
  const lineage = history
    .map((s, i) => {
      const meta = VERB_META[s.kind] || VERB_META.operator;
      const opName = (s.op && s.op.name) || meta.label;
      let line = `[stage ${i + 1}] (${opName}) ${s.to ? s.to : "(an empty seed)"}`;
      if (s.parents && s.parents.length) {
        line += `\n    ↳ merged from: ${s.parents.map((p) => `"${(p.text || "").trim()}"`).join("  +  ")}`;
      }
      return line;
    })
    .join("\n");

  const prompt = `You are a thought-historian narrating how a single idea was really developed on an infinite idea-canvas. Below is its true chronological lineage. Each stage is tagged with the operation that produced it:
- planted = the very first spark, written by hand
- written = a manual edit by the thinker
- evolved = deepened by AI
- branched = a new related direction spun off
- split = broken into sub-ideas
- combined = synthesized from two earlier ideas
- a named operator = a custom transformation the thinker built and applied

Reconstruct the genuine intellectual journey end to end: how the thinking actually moved from the first spark to the final form — the realizations, the pivots, the widening or sharpening of the idea. Be specific to THIS idea's content, not generic.

Return ONLY valid JSON (no markdown fences) in exactly this shape:
{
  "title": "short evocative name for this line of thought (max 6 words)",
  "chapters": [
    { "move": "2-4 word name for the cognitive move at this stage", "narration": "1-2 vivid sentences in second person ('you...') describing what you were doing and what shifted in your understanding at this exact step" }
  ],
  "synthesis": "3-4 sentences capturing the whole arc: where it began, the pivotal turns, and where it arrived and why that matters"
}
There MUST be exactly one chapter object per stage, in the same order as the stages.`;

  const out = await ask(prompt, lineage);
  const j = parseJourney(out);
  if (!j || !Array.isArray(j.chapters)) throw new Error("Could not trace the thought.");
  return j;
}

export default function App() {
  const [seeds, setSeeds] = useState(() => load(SEEDS_KEY, []));
  const [edges, setEdges] = useState(() => load(EDGES_KEY, []));
  const [camera, setCamera] = useState(() => load(CAMERA_KEY, { x: 0, y: 0, scale: 1 }));
  const [symbols, setSymbols] = useState(() => {
    const s = load(SYMBOLS_KEY, null);
    return Array.isArray(s) ? s : DEFAULT_SYMBOLS;
  });
  const [selected, setSelected] = useState(null);
  // pending multi-node operation: { opKey, fromId, picks: [ids] }
  const [pending, setPending] = useState(null);
  const [busyIds, setBusyIds] = useState([]);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toolboxOpen, setToolboxOpen] = useState(true);
  const [replaySeed, setReplaySeed] = useState(null);
  // highlighter: current text selection -> { text, rect, sourceId }
  const [highlight, setHighlight] = useState(null);
  // a two-fragment op waiting for its second fragment -> { opKey, fragA, sourceA }
  const [pendingFrag, setPendingFrag] = useState(null);
  // entry portal + palette
  const [entryText, setEntryText] = useState("");
  const [entryKind, setEntryKind] = useState("idea");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exIdx, setExIdx] = useState(0);
  // toolbox: two object types live here — nodes and operators
  const [savedNodes, setSavedNodes] = useState(() => load(NODES_KEY, []));
  const [toolboxTab, setToolboxTab] = useState("operators");
  // discovery engine working state -> { items: [...labels], started }
  const [discovering, setDiscovering] = useState(null);
  // the highlighter marker — the primary input device
  const [markerOn, setMarkerOn] = useState(true);
  const [markerPts, setMarkerPts] = useState(null); // live stroke (screen coords)
  const [selection, setSelection] = useState([]); // node ids under the marker
  const markerRef = useRef(null);

  const viewportRef = useRef(null);
  const panRef = useRef(null);

  useEffect(() => {
    const clean = seeds.map(({ busy, flash, loading, error, ...s }) => s);
    localStorage.setItem(SEEDS_KEY, JSON.stringify(clean));
  }, [seeds]);
  useEffect(() => localStorage.setItem(EDGES_KEY, JSON.stringify(edges)), [edges]);
  useEffect(() => localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)), [camera]);
  useEffect(() => localStorage.setItem(SYMBOLS_KEY, JSON.stringify(symbols)), [symbols]);
  useEffect(() => localStorage.setItem(NODES_KEY, JSON.stringify(savedNodes)), [savedNodes]);

  useEffect(() => {
    function onKey(e) {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || "");
      if (e.key === "Escape") {
        setSelected(null);
        setPending(null);
        setHighlight(null);
        setPendingFrag(null);
        clearSelection();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing && selection.length) {
        e.preventDefault();
        deleteSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection]);

  // ---- the highlighter: capture any selection inside a [data-selectable] surface ----
  useEffect(() => {
    function capture() {
      const sel = window.getSelection();
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      if (!text || text.length < 2 || sel.rangeCount === 0) {
        // don't drop a pending second-fragment prompt just because selection collapsed
        setHighlight((h) => (h ? null : h));
        return;
      }
      const range = sel.getRangeAt(0);
      let node = range.startContainer;
      if (node.nodeType === 3) node = node.parentElement;
      const surface = node && node.closest ? node.closest("[data-selectable]") : null;
      if (!surface) {
        setHighlight(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setHighlight({
        text,
        sourceId: surface.getAttribute("data-seed-id") || null,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width },
      });
    }
    function onUp(e) {
      if (e.target.closest && e.target.closest(".sel-toolbar")) return; // keep selection while clicking toolbar
      setTimeout(capture, 0);
    }
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchend", onUp);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchend", onUp);
    };
  }, []);

  // paste an image from the clipboard anywhere -> a node in the field
  useEffect(() => {
    function onPaste(e) {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            addImageFiles([f]);
            e.preventDefault();
            return;
          }
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [camera]);

  // rotate the entry-portal placeholder examples
  useEffect(() => {
    const id = setInterval(() => setExIdx((i) => (i + 1) % ENTRY_EXAMPLES.length), 2800);
    return () => clearInterval(id);
  }, []);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3400);
  }

  // ---- camera ----
  function screenToWorld(sx, sy) {
    return { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale };
  }
  function worldToScreen(wx, wy) {
    return { x: wx * camera.scale + camera.x, y: wy * camera.scale + camera.y };
  }
  function viewCenterWorld() {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return screenToWorld(r.width / 2, r.height / 2);
  }

  // distance from point p to segment a-b (screen space)
  function distToSeg(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * dx;
    const cy = a.y + t * dy;
    return Math.hypot(p.x - cx, p.y - cy);
  }
  // which nodes does this marker stroke cover?
  function nodesUnderStroke(pts) {
    if (!pts || pts.length === 0) return [];
    const reach = 26; // marker half-thickness + node radius, in screen px
    const hit = [];
    for (const s of seeds) {
      const sp = worldToScreen(s.x, s.y);
      let near = false;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1] || pts[i];
        if (distToSeg(sp, a, b) <= reach) {
          near = true;
          break;
        }
      }
      if (near) hit.push(s.id);
    }
    return hit;
  }

  function onPointerDown(e) {
    if (e.target.closest(".seed") || e.target.closest(".seed-panel")) return;
    const r = viewportRef.current.getBoundingClientRect();
    const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (markerOn) {
      markerRef.current = { pts: [pt] };
      setMarkerPts([pt]);
      setSelection([]);
      viewportRef.current.setPointerCapture(e.pointerId);
      return;
    }
    panRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
    viewportRef.current.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (markerRef.current) {
      const r = viewportRef.current.getBoundingClientRect();
      const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
      const pts = [...markerRef.current.pts, pt];
      markerRef.current.pts = pts;
      setMarkerPts(pts);
      setSelection(nodesUnderStroke(pts));
      return;
    }
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.x;
    const dy = e.clientY - panRef.current.y;
    panRef.current.x = e.clientX;
    panRef.current.y = e.clientY;
    panRef.current.moved += Math.abs(dx) + Math.abs(dy);
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }
  function onPointerUp() {
    if (markerRef.current) {
      const pts = markerRef.current.pts;
      markerRef.current = null;
      const hit = nodesUnderStroke(pts);
      setSelection(hit);
      setMarkerPts(null);
      if (!hit.length) {
        // a tap on empty space clears any current selection
        setSelected(null);
      }
      return;
    }
    const p = panRef.current;
    panRef.current = null;
    if (p && p.moved < 4) {
      setSelected(null);
      setPending(null);
      setSelection([]);
    }
  }
  function clearSelection() {
    setSelection([]);
    setMarkerPts(null);
    markerRef.current = null;
  }
  function deleteSelection() {
    if (!selection.length) return;
    const ids = new Set(selection);
    setSeeds((p) => p.filter((s) => !ids.has(s.id)));
    setEdges((p) => p.filter((e) => !ids.has(e.a) && !ids.has(e.b)));
    if (ids.has(selected)) setSelected(null);
    showToast(`cleared ${selection.length}`);
    clearSelection();
  }
  function stabilizeSelection() {
    if (selection.length < 2) return showToast("select at least two");
    const first = seeds.find((s) => s.id === selection[0]);
    if (first) applyOp("stabilize", first, selection.slice(1));
    clearSelection();
  }
  function discoverSelection() {
    if (selection.length < 2) return showToast("select at least two");
    runDiscoveryOn([...selection]);
    clearSelection();
  }
  function onWheel(e) {
    const r = viewportRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    setCamera((c) => {
      const factor = Math.exp(-e.deltaY * 0.0015);
      const scale = Math.min(2.6, Math.max(0.25, c.scale * factor));
      const wx = (sx - c.x) / c.scale;
      const wy = (sy - c.y) / c.scale;
      return { x: sx - wx * scale, y: sy - wy * scale, scale };
    });
  }
  function onDoubleClick(e) {
    if (e.target.closest(".seed") || e.target.closest(".seed-panel")) return;
    const r = viewportRef.current.getBoundingClientRect();
    const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
    plantText(w.x, w.y);
  }

  // ---- seed ops ----
  function plantText(x, y, kind = "idea", text = "") {
    const c = x == null ? viewCenterWorld() : { x, y };
    const k = KINDS[kind] || KINDS.idea;
    const seed = makeSeed(c.x, c.y, text, { kind, color: k.color });
    setSeeds((p) => [...p, seed]);
    setSelected(seed.id);
    return seed;
  }
  function plantSketch() {
    const c = viewCenterWorld();
    const seed = makeSeed(c.x, c.y, "", { type: "sketch", kind: "fragment", image: null, strokes: [] });
    setSeeds((p) => [...p, seed]);
    setSelected(seed.id);
  }
  function plantImage(dataUrl, x, y) {
    const c = x == null ? viewCenterWorld() : { x, y };
    const seed = makeSeed(c.x, c.y, "", {
      type: "image",
      kind: "observation",
      color: "#5e6b80",
      image: dataUrl,
    });
    setSeeds((p) => [...p, seed]);
    setSelected(seed.id);
  }
  async function addImageFiles(files, x, y) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    for (let i = 0; i < list.length; i++) {
      try {
        const data = await fileToImage(list[i]);
        plantImage(data, x == null ? null : x + i * 30, y == null ? null : y + i * 30);
      } catch {
        showToast("Could not read that image.");
      }
    }
  }
  function pickImageFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.onchange = () => input.files && addImageFiles(input.files);
    input.click();
  }
  function enterThought(text, kind = "idea") {
    const t = text.trim();
    if (!t) return;
    plantText(null, null, kind, t);
  }
  function updateSeed(id, patch) {
    setSeeds((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function moveSeedBy(id, dx, dy) {
    setSeeds((p) => p.map((s) => (s.id === id ? { ...s, x: s.x + dx, y: s.y + dy } : s)));
  }
  function deleteSeed(id) {
    setSeeds((p) => p.filter((s) => s.id !== id));
    setEdges((p) => p.filter((e) => e.a !== id && e.b !== id));
    if (selected === id) setSelected(null);
    if (pending && (pending.fromId === id || pending.picks.includes(id))) setPending(null);
  }
  function connect(a, b) {
    setEdges((p) => [...p, { id: uid(), a, b }]);
  }
  function setBusy(id, on) {
    setBusyIds((p) => (on ? [...new Set([...p, id])] : p.filter((x) => x !== id)));
  }

  function placeNear(seed, index = 0, total = 1) {
    const base = Math.random() * Math.PI * 2;
    const angle = total > 1 ? base + (index / total) * Math.PI * 1.7 : base;
    const radius = 155 + Math.random() * 45;
    return { x: seed.x + Math.cos(angle) * radius, y: seed.y + Math.sin(angle) * radius };
  }

  function parseLines(out) {
    const parts = out
      .split("\n")
      .map((l) => l.replace(/^[\s\-*\d.)]+/, "").trim())
      .filter(Boolean);
    return parts.length ? parts : [out];
  }

  function midOf(nodes) {
    const n = nodes.length || 1;
    return {
      x: nodes.reduce((s, m) => s + m.x, 0) / n,
      y: nodes.reduce((s, m) => s + m.y, 0) / n - 40,
    };
  }

  // The single entry point for the whole primitive grammar.
  // `extra` holds the other node ids for binary / many-select ops.
  async function applyOp(opKey, seed, extra = []) {
    const op = OPS[opKey];
    if (!op) return;
    const others = extra.map((id) => seeds.find((s) => s.id === id)).filter(Boolean);
    const meta = { name: op.name, sym: op.sym, color: op.color };

    const hasContent = (seed.text || "").trim() || seed.type === "sketch" || seed.type === "image";
    if (op.arity === 2 && others.length < 1) return;
    if (op.arity === "many-select" && others.length < 1)
      return showToast("Pick at least one more idea to stabilize.");
    if (op.arity !== "many-select" && op.arity !== 2 && !hasContent)
      return showToast("This seed is still empty.");

    const img = seed.type === "image" ? seed.image : null;
    const involved = [seed, ...others];
    involved.forEach((n) => setBusy(n.id, true));

    try {
      // ---- build the input text + history scaffolding by arity ----
      if (op.arity === 2 || op.arity === "many-select") {
        const input = involved
          .map((n, i) => `Idea ${String.fromCharCode(65 + i)}:\n${n.text || "(a sketch)"}`)
          .join("\n\n");
        const out = (await runClaude(op.prompt, input, 1))[0] || "";
        const mid = midOf(involved);
        const child = makeSeed(mid.x, mid.y, out, {
          color: op.color,
          history: [
            {
              kind: opKey,
              op: meta,
              to: out,
              parents: involved.map((n) => ({ text: n.text, history: n.history })),
            },
          ],
        });
        setSeeds((p) => [...p, child]);
        setEdges((p) => [...p, ...involved.map((n) => ({ id: uid(), a: n.id, b: child.id }))]);
        setSelected(child.id);
        pulse(child.id);
      } else if (op.arity === "many") {
        const baseH = withWrite(seed);
        const out = (await runClaude(op.prompt, seed.text, 1, img))[0] || "";
        const list = parseLines(out);
        const children = list.map((t, i) => {
          const pos = placeNear(seed, i, list.length);
          return makeSeed(pos.x, pos.y, t, {
            color: op.color,
            history: [...baseH, { kind: opKey, op: meta, to: t }],
          });
        });
        setSeeds((p) => [...p, ...children]);
        setEdges((p) => [...p, ...children.map((c) => ({ id: uid(), a: seed.id, b: c.id }))]);
      } else {
        // unary (1) and analysis
        const baseH = withWrite(seed);
        const out = (await runClaude(op.prompt, seed.text, 1, img))[0] || "";
        const pos = placeNear(seed);
        const child = makeSeed(pos.x, pos.y, out, {
          color: op.color,
          analysis: op.group === "map",
          history: [...baseH, { kind: opKey, op: meta, to: out }],
        });
        setSeeds((p) => [...p, child]);
        connect(seed.id, child.id);
        setSelected(child.id);
        pulse(child.id);
      }
    } catch (e) {
      showToast(e.message);
    } finally {
      involved.forEach((n) => setBusy(n.id, false));
    }
  }

  function pulse(id) {
    setSeeds((p) => p.map((s) => (s.id === id ? { ...s, flash: true } : s)));
    setTimeout(
      () => setSeeds((p) => p.map((s) => (s.id === id ? { ...s, flash: false } : s))),
      900
    );
  }

  // Begin / advance / run a multi-node operation from the panel.
  function startOp(opKey, seed) {
    const op = OPS[opKey];
    if (opKey === "sameness") {
      startDiscovery(seed);
      return;
    }
    if (op.arity === 2) {
      setPending({ opKey, fromId: seed.id, picks: [] });
      showToast(`pick another idea to ${op.name}`);
    } else if (op.arity === "many-select") {
      setPending({ opKey, fromId: seed.id, picks: [] });
      showToast(`pick the branches to ${op.name}, then confirm`);
    } else {
      applyOp(opKey, seed);
    }
  }

  function runPending() {
    if (!pending) return;
    if (pending.discover) return runDiscovery();
    const seed = seeds.find((s) => s.id === pending.fromId);
    if (seed) applyOp(pending.opKey, seed, pending.picks);
    setPending(null);
  }

  // ---- the discovery engine: find hidden sameness across many nodes ----
  function startDiscovery(seed = null) {
    setSelected(null);
    setPending({ discover: true, opKey: "sameness", fromId: seed?.id ?? null, picks: [] });
    showToast("select things, then find their hidden sameness");
  }

  function nextStructNumber() {
    const cur = parseInt(localStorage.getItem(STRUCTSEQ_KEY) || "283", 10) || 283;
    const n = cur + 1;
    localStorage.setItem(STRUCTSEQ_KEY, String(n));
    return n;
  }

  function runDiscovery() {
    if (!pending || !pending.discover) return;
    const ids = [...(pending.fromId ? [pending.fromId] : []), ...pending.picks];
    setPending(null);
    runDiscoveryOn(ids);
  }

  async function runDiscoveryOn(ids) {
    const nodes = ids.map((id) => seeds.find((s) => s.id === id)).filter(Boolean);
    if (nodes.length < 2) return showToast("select at least two things to compare");
    const labels = nodes.map((n) =>
      (n.text || "").trim() || (n.type === "image" ? "[an image]" : "[a sketch]")
    );
    setPending(null);
    setDiscovering({ count: nodes.length, started: Date.now() });
    nodes.forEach((n) => setBusy(n.id, true));
    try {
      const out = (await runClaude(samenessPrompt(labels), "", 1))[0] || "";
      const parsed = parseSameness(out);
      const num = nextStructNumber();
      const title = `STRUCTURE #${num} — ${parsed.name}`;
      const mid = midOf(nodes);
      const child = makeSeed(mid.x, mid.y - 30, parsed.body, {
        kind: "structure",
        color: INK,
        struct: num,
        title,
        discovery: true,
        history: [
          {
            kind: "sameness",
            op: { name: "find hidden sameness", sym: "⟁", color: INK },
            to: parsed.body,
            parents: nodes.map((n) => ({ text: n.text, history: n.history })),
          },
        ],
      });
      setSeeds((p) => [...p, child]);
      setEdges((p) => [...p, ...nodes.map((n) => ({ id: uid(), a: n.id, b: child.id }))]);
      setSelected(child.id);
      pulse(child.id);
      showToast(title);
    } catch (e) {
      showToast(e.message);
    } finally {
      nodes.forEach((n) => setBusy(n.id, false));
      setDiscovering(null);
    }
  }

  // ---- saved nodes (idea structures stored in the toolbox) ----
  function saveNodeToToolbox(seed) {
    const snap = {
      id: uid(),
      kind: seed.kind || "idea",
      color: seed.color,
      type: seed.type || "text",
      text: seed.text || "",
      image: seed.image || null,
      strokes: seed.strokes || [],
      title: seed.title || (seed.text || "").trim().split("\n")[0].slice(0, 48) || "untitled",
      savedAt: Date.now(),
    };
    setSavedNodes((p) => [snap, ...p]);
    setToolboxTab("nodes");
    showToast("saved to toolbox");
  }
  function deleteSavedNode(id) {
    setSavedNodes((p) => p.filter((n) => n.id !== id));
  }
  function plantSavedNode(node) {
    const c = viewCenterWorld();
    const seed = makeSeed(c.x, c.y, node.text || "", {
      kind: node.kind,
      color: node.color,
      type: node.type,
      image: node.image,
      strokes: node.strokes,
      title: node.title,
      struct: node.struct,
    });
    setSeeds((p) => [...p, seed]);
    setSelected(seed.id);
  }

  // ---- composed operators: a saved SEQUENCE of functions ----
  function savePathAsOperator(seed) {
    const steps = (seed.history || [])
      .filter((h) => OPS[h.kind] && OPS[h.kind].prompt)
      .map((h) => ({ kind: h.kind, name: OPS[h.kind].name, prompt: OPS[h.kind].prompt }));
    if (!steps.length)
      return showToast("no reusable function-path on this node yet");
    const names = steps.map((s) => OPS[s.kind].sym).join(" ");
    const op = {
      id: uid(),
      name: `path · ${steps.map((s) => s.name).join(" → ").slice(0, 40)}`,
      emoji: "⛓",
      color: seed.color || INK,
      image: null,
      strokes: [],
      kind: "composed",
      steps,
      glyphs: names,
      count: 1,
    };
    setSymbols((p) => [...p, op]);
    setToolboxTab("operators");
    showToast(`operator saved · ${names}`);
  }

  async function applyComposedOperator(op, seed) {
    const start = (seed.text || "").trim();
    if (!start && seed.type !== "image" && seed.type !== "sketch")
      return showToast("This seed is still empty.");
    setBusy(seed.id, true);
    let cur = start;
    const hist = [...withWrite(seed)];
    try {
      for (const step of op.steps) {
        const out = (await runClaude(step.prompt, cur, 1))[0] || "";
        cur = out.split("\n").map((l) => l.trim()).filter(Boolean)[0] || out;
        hist.push({ kind: step.kind, op: { name: step.name, sym: OPS[step.kind]?.sym, color: op.color }, to: cur });
      }
      const pos = placeNear(seed);
      const child = makeSeed(pos.x, pos.y, cur, { color: op.color, history: hist });
      setSeeds((p) => [...p, child]);
      connect(seed.id, child.id);
      setSelected(child.id);
      pulse(child.id);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(seed.id, false);
    }
  }

  // ---- the highlighter engine: operate on extracted thought-particles ----
  function spawnAnchor(sourceId) {
    const src = seeds.find((s) => s.id === sourceId);
    if (src) return src;
    const c = viewCenterWorld();
    return { id: null, x: c.x, y: c.y };
  }

  function onFragmentOp(opKey) {
    if (!highlight) return;
    const op = FRAG_OPS[opKey];
    if (op.kind === "binary" || op.kind === "analysis-binary") {
      setPendingFrag({ opKey, fragA: highlight.text, sourceA: highlight.sourceId });
      setHighlight(null);
      window.getSelection()?.removeAllRanges();
      showToast(`${op.sym} highlight the fragment to ${op.name} with`);
      return;
    }
    applyFragmentOp(opKey, highlight.text, highlight.sourceId);
    setHighlight(null);
    window.getSelection()?.removeAllRanges();
  }

  function runPendingFrag() {
    if (!pendingFrag || !highlight) return;
    applyFragmentOp(pendingFrag.opKey, pendingFrag.fragA, pendingFrag.sourceA, highlight.text, highlight.sourceId);
    setPendingFrag(null);
    setHighlight(null);
    window.getSelection()?.removeAllRanges();
  }

  async function applyFragmentOp(opKey, frag, sourceId, frag2, source2Id) {
    const op = FRAG_OPS[opKey];
    const meta = { name: op.name, sym: op.sym, color: op.color };
    const anchor = spawnAnchor(sourceId);

    if (op.kind === "extract") {
      const pos = placeNear(anchor);
      const baseH = sourceId
        ? withWrite(seeds.find((s) => s.id === sourceId))
        : [{ kind: "plant", op: null, to: frag }];
      const child = makeSeed(pos.x, pos.y, frag, {
        color: op.color,
        particle: true,
        history: [...baseH, { kind: "isolate", op: meta, to: frag }],
      });
      setSeeds((p) => [...p, child]);
      if (sourceId) connect(sourceId, child.id);
      setSelected(child.id);
      pulse(child.id);
      return;
    }

    if (sourceId) setBusy(sourceId, true);
    if (source2Id) setBusy(source2Id, true);
    try {
      if (op.kind === "binary" || op.kind === "analysis-binary") {
        const input = `Fragment A:\n${frag}\n\nFragment B:\n${frag2}`;
        const out = (await runClaude(op.prompt, input, 1))[0] || "";
        const a = seeds.find((s) => s.id === sourceId);
        const b = seeds.find((s) => s.id === source2Id);
        const anchors = [a, b].filter(Boolean);
        const mid = anchors.length ? midOf(anchors) : placeNear(anchor);
        const child = makeSeed(mid.x, mid.y, out, {
          color: op.color,
          particle: true,
          analysis: op.kind === "analysis-binary",
          history: [{ kind: opKey, op: meta, to: out, parents: [{ text: frag }, { text: frag2 }] }],
        });
        setSeeds((p) => [...p, child]);
        if (anchors.length) setEdges((p) => [...p, ...anchors.map((n) => ({ id: uid(), a: n.id, b: child.id }))]);
        setSelected(child.id);
        pulse(child.id);
      } else if (op.kind === "fan") {
        const out = (await runClaude(op.prompt, frag, 1))[0] || "";
        const list = parseLines(out);
        const baseH = sourceId
          ? withWrite(seeds.find((s) => s.id === sourceId))
          : [{ kind: "plant", op: null, to: frag }];
        const children = list.map((t, i) => {
          const pos = placeNear(anchor, i, list.length);
          return makeSeed(pos.x, pos.y, t, {
            color: op.color,
            particle: true,
            history: [...baseH, { kind: opKey, op: meta, to: t }],
          });
        });
        setSeeds((p) => [...p, ...children]);
        if (sourceId) setEdges((p) => [...p, ...children.map((c) => ({ id: uid(), a: sourceId, b: c.id }))]);
      } else {
        // one
        const out = (await runClaude(op.prompt, frag, 1))[0] || "";
        const pos = placeNear(anchor);
        const baseH = sourceId
          ? withWrite(seeds.find((s) => s.id === sourceId))
          : [{ kind: "plant", op: null, to: frag }];
        const child = makeSeed(pos.x, pos.y, out, {
          color: op.color,
          particle: true,
          history: [...baseH, { kind: opKey, op: meta, to: out }],
        });
        setSeeds((p) => [...p, child]);
        if (sourceId) connect(sourceId, child.id);
        setSelected(child.id);
        pulse(child.id);
      }
    } catch (e) {
      showToast(e.message);
    } finally {
      if (sourceId) setBusy(sourceId, false);
      if (source2Id) setBusy(source2Id, false);
    }
  }

  // ---- custom operator applied to a seed ----
  async function applyOperator(opId, seed) {
    const op = symbols.find((s) => s.id === opId);
    if (!op) return;
    if (op.kind === "composed") return applyComposedOperator(op, seed);
    const text = (seed.text || "").trim();
    if (!text && seed.type !== "sketch") return showToast("This seed is still empty.");
    const n = Math.min(Math.max(op.count || 1, 1), MAX_RESPONSES);
    const baseH = withWrite(seed);
    const opMeta = { name: op.name, color: op.color, image: op.image, emoji: op.emoji };

    const placeholders = Array.from({ length: n }, (_, i) => {
      const pos = placeNear(seed, i, n);
      return {
        id: uid(),
        type: "text",
        x: pos.x,
        y: pos.y,
        text: "",
        color: op.color,
        born: Date.now(),
        loading: true,
        history: [...baseH, { kind: "operator", op: opMeta, to: "" }],
      };
    });
    setSeeds((p) => [...p, ...placeholders]);
    setEdges((p) => [...p, ...placeholders.map((c) => ({ id: uid(), a: seed.id, b: c.id }))]);

    try {
      const outs = await runClaude(op.prompt, text, n);
      setSeeds((prev) => {
        const arr = [...prev];
        placeholders.forEach((ph, i) => {
          const idx = arr.findIndex((o) => o.id === ph.id);
          if (idx === -1) return;
          if (i < outs.length) {
            const hist = [...baseH, { kind: "operator", op: opMeta, to: outs[i] }];
            arr[idx] = { ...arr[idx], loading: false, text: outs[i], history: hist };
          } else arr.splice(idx, 1);
        });
        return arr;
      });
    } catch (e) {
      showToast(e.message);
      setSeeds((prev) => prev.filter((o) => !placeholders.some((ph) => ph.id === o.id)));
      setEdges((prev) => prev.filter((ed) => !placeholders.some((ph) => ph.id === ed.b)));
    }
  }

  function onSeedActivate(id) {
    if (pending) {
      const op = OPS[pending.opKey];
      if (pending.discover) {
        if (id === pending.fromId) return;
        setPending((p) => ({
          ...p,
          picks: p.picks.includes(id) ? p.picks.filter((x) => x !== id) : [...p.picks, id],
        }));
        return;
      }
      if (id === pending.fromId) return; // ignore source
      if (op.arity === 2) {
        const seed = seeds.find((s) => s.id === pending.fromId);
        setPending(null);
        if (seed) applyOp(pending.opKey, seed, [id]);
        return;
      }
      if (op.arity === "many-select") {
        setPending((p) => ({
          ...p,
          picks: p.picks.includes(id) ? p.picks.filter((x) => x !== id) : [...p.picks, id],
        }));
        return;
      }
    }
    setSelected(id);
  }

  // ---- operators CRUD ----
  function saveSymbol(sym) {
    setSymbols((prev) => {
      const exists = prev.some((s) => s.id === sym.id);
      return exists ? prev.map((s) => (s.id === sym.id ? sym : s)) : [...prev, sym];
    });
    setEditing(null);
  }
  function deleteSymbol(id) {
    setSymbols((prev) => prev.filter((s) => s.id !== id));
  }

  const selectedSeed = seeds.find((s) => s.id === selected) || null;
  const screenPos = selectedSeed ? worldToScreen(selectedSeed.x, selectedSeed.y) : null;

  const activeLayer =
    highlight || pendingFrag ? "exp" : busyIds.length || pending ? "branch" : "field";

  return (
    <div className="void-app">
      <div className="grid-bg" />

      <div
        className={"viewport" + (markerOn ? " marker-mode" : "")}
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          if (e.dataTransfer.files && e.dataTransfer.files.length) {
            e.preventDefault();
            const r = viewportRef.current.getBoundingClientRect();
            const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
            addImageFiles(e.dataTransfer.files, w.x, w.y);
          }
        }}
      >
        <div
          className="world"
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}
        >
          <Synapses seeds={seeds} edges={edges} />
          {seeds.map((s) => (
            <Seed
              key={s.id}
              seed={s}
              scale={camera.scale}
              selected={selected === s.id}
              pendingFrom={!pending?.discover && pending?.fromId === s.id}
              picked={
                pending?.picks.includes(s.id) ||
                (pending?.discover && pending?.fromId === s.id)
              }
              pickMode={Boolean(pending)}
              marked={selection.includes(s.id)}
              busy={busyIds.includes(s.id)}
              onActivate={() => onSeedActivate(s.id)}
              onMoveBy={(dx, dy) => moveSeedBy(s.id, dx, dy)}
              onDropOperator={(opId) => applyOperator(opId, s)}
            />
          ))}
        </div>

        {markerPts && markerPts.length > 0 && (
          <svg className="marker-layer">
            <polyline
              points={markerPts.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
            />
          </svg>
        )}
      </div>

      <header className="void-brand">
        <span className="void-mark">✦</span>
        <span>lens</span>
      </header>

      {/* top toolbar: highlighter (primary) + discovery */}
      <div className="field-tools">
        <button
          className={"tool-pill" + (markerOn ? " on" : "")}
          onClick={() => {
            setMarkerOn((v) => !v);
            clearSelection();
          }}
          title="highlighter — drag across nodes to select them"
        >
          <span className="tool-mark">▔</span>
          highlighter
        </button>
        <button
          className={"tool-pill" + (pending?.discover ? " on" : "")}
          onClick={() => (pending?.discover ? setPending(null) : startDiscovery())}
          title="select several things, then find their hidden sameness"
        >
          <span className="tool-mark">⟁</span>
          {pending?.discover ? "cancel" : "find sameness"}
        </button>
      </div>

      {/* Toolbox: two object types — nodes and operators */}
      <aside className={"toolbox" + (toolboxOpen ? "" : " collapsed")}>
        <div className="toolbox-head">
          <div className="toolbox-tabs">
            <button
              className={"tb-tab" + (toolboxTab === "operators" ? " on" : "")}
              onClick={() => setToolboxTab("operators")}
            >
              operators
            </button>
            <button
              className={"tb-tab" + (toolboxTab === "nodes" ? " on" : "")}
              onClick={() => setToolboxTab("nodes")}
            >
              nodes
            </button>
          </div>
          <button className="toolbox-toggle" onClick={() => setToolboxOpen((v) => !v)}>
            {toolboxOpen ? "‹" : "›"}
          </button>
        </div>
        {toolboxOpen && toolboxTab === "operators" && (
          <>
            <p className="toolbox-hint">drag a glyph onto a node</p>
            <div className="operator-list">
              {symbols.map((op) => (
                <OperatorChip key={op.id} operator={op} onEdit={() => setEditing(op)} />
              ))}
              {symbols.length === 0 && <p className="toolbox-empty">no operators yet</p>}
            </div>
            <button className="op-new" onClick={() => setEditing(makeBlankSymbol())}>
              + form an operator
            </button>
          </>
        )}
        {toolboxOpen && toolboxTab === "nodes" && (
          <>
            <p className="toolbox-hint">click a structure to drop it into the field</p>
            <div className="node-list">
              {savedNodes.map((n) => (
                <SavedNodeChip
                  key={n.id}
                  node={n}
                  onPlant={() => plantSavedNode(n)}
                  onDelete={() => deleteSavedNode(n.id)}
                />
              ))}
              {savedNodes.length === 0 && (
                <p className="toolbox-empty">no saved nodes yet — save a structure from its panel</p>
              )}
            </div>
          </>
        )}
      </aside>

      {/* plant controls */}
      <div className="entry-dock">
        {paletteOpen && (
          <div className="palette">
            <div className="palette-row">
              {KIND_ORDER.map((k) => (
                <button
                  key={k}
                  className="palette-chip"
                  style={{ "--c": KINDS[k].color }}
                  onClick={() => {
                    setEntryKind(k);
                    if (entryText.trim()) {
                      enterThought(entryText, k);
                      setEntryText("");
                    } else {
                      plantText(null, null, k);
                    }
                    setPaletteOpen(false);
                  }}
                  title={`new ${KINDS[k].label}`}
                >
                  <span className="palette-glyph">{KINDS[k].glyph}</span>
                  <span className="palette-name">{KINDS[k].label}</span>
                </button>
              ))}
            </div>
            <div className="palette-row media">
              <button
                className="palette-chip media"
                onClick={() => {
                  plantSketch();
                  setPaletteOpen(false);
                }}
              >
                <span className="palette-glyph">✎</span>
                <span className="palette-name">drawing</span>
              </button>
              <button
                className="palette-chip media"
                onClick={() => {
                  pickImageFile();
                  setPaletteOpen(false);
                }}
              >
                <span className="palette-glyph">▦</span>
                <span className="palette-name">image</span>
              </button>
            </div>
            <div className="palette-tip">…or drop / paste an image anywhere</div>
          </div>
        )}

        <div className="entry-bar">
          <button
            className={"entry-add" + (paletteOpen ? " open" : "")}
            onClick={() => setPaletteOpen((v) => !v)}
            title="choose a kind or medium"
          >
            +
          </button>
          <span className="entry-kind" style={{ color: KINDS[entryKind].color }} title={KINDS[entryKind].label}>
            {KINDS[entryKind].glyph}
          </span>
          <input
            className="entry-input"
            value={entryText}
            placeholder={`you enter: ${ENTRY_EXAMPLES[exIdx]}…`}
            onChange={(e) => setEntryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && entryText.trim()) {
                enterThought(entryText, entryKind);
                setEntryText("");
              }
            }}
          />
          <button
            className="entry-go"
            disabled={!entryText.trim()}
            onClick={() => {
              if (entryText.trim()) {
                enterThought(entryText, entryKind);
                setEntryText("");
              }
            }}
          >
            enter
          </button>
        </div>
      </div>

      {seeds.length === 0 && (
        <div className="void-hint">
          <p>emptiness, full of potential</p>
          <span>
            you enter a thought below — or drop an image, sketch, or double&#8209;click
            anywhere
          </span>
        </div>
      )}

      {pending && pending.discover && (
        <div className="combine-banner discover">
          <span className="banner-sym">⟁</span> discovery engine ·{" "}
          {pending.picks.length + (pending.fromId ? 1 : 0)} selected · click any nodes to include ·{" "}
          <button
            className="banner-go"
            disabled={pending.picks.length + (pending.fromId ? 1 : 0) < 2}
            onClick={runDiscovery}
          >
            find hidden sameness
          </button>{" "}
          · <em>esc to cancel</em>
        </div>
      )}

      {pending && !pending.discover && (
        <div className="combine-banner">
          {OPS[pending.opKey].arity === "many-select" ? (
            <>
              <span className="banner-sym">{OPS[pending.opKey].sym}</span> {OPS[pending.opKey].name}:{" "}
              {pending.picks.length + 1} selected · click ideas to add ·{" "}
              <button className="banner-go" disabled={pending.picks.length < 1} onClick={runPending}>
                {OPS[pending.opKey].name} now
              </button>{" "}
              · <em>esc to cancel</em>
            </>
          ) : (
            <>
              <span className="banner-sym">{OPS[pending.opKey].sym}</span> choose another idea to{" "}
              {OPS[pending.opKey].name} · <em>esc to cancel</em>
            </>
          )}
        </div>
      )}

      {selectedSeed && screenPos && (
        <SeedPanel
          seed={selectedSeed}
          pos={screenPos}
          flip={screenPos.x > window.innerWidth - 360}
          busy={busyIds.includes(selectedSeed.id)}
          onChange={(patch) => updateSeed(selectedSeed.id, patch)}
          onOp={(opKey) => startOp(opKey, selectedSeed)}
          onDelete={() => deleteSeed(selectedSeed.id)}
          onReplay={() => setReplaySeed(selectedSeed)}
          onSave={() => saveNodeToToolbox(selectedSeed)}
          onSavePath={() => savePathAsOperator(selectedSeed)}
          onClose={() => setSelected(null)}
        />
      )}

      {replaySeed && <Replay seed={replaySeed} onClose={() => setReplaySeed(null)} />}

      {discovering && <DiscoveryOverlay count={discovering.count} />}

      {editing && (
        <SymbolEditor
          symbol={editing}
          onSave={saveSymbol}
          onDelete={editing.id && symbols.some((s) => s.id === editing.id) ? deleteSymbol : null}
          onClose={() => setEditing(null)}
        />
      )}

      {pendingFrag && (
        <div className="combine-banner frag">
          <span className="banner-sym">{FRAG_OPS[pendingFrag.opKey].sym}</span>
          {FRAG_OPS[pendingFrag.opKey].name}: highlight the second fragment
          {highlight ? (
            <>
              {" "}·{" "}
              <button className="banner-go" onClick={runPendingFrag}>
                {FRAG_OPS[pendingFrag.opKey].name} now
              </button>
            </>
          ) : null}{" "}
          · <em>esc to cancel</em>
        </div>
      )}

      {highlight && (
        <SelectionToolbar
          rect={highlight.rect}
          pendingFrag={pendingFrag}
          onOp={onFragmentOp}
          onConfirm={runPendingFrag}
        />
      )}

      {selection.length > 0 && !markerPts && (
        <div className="sel-bar">
          <span className="sel-count">{selection.length} selected</span>
          <button className="sel-act danger" onClick={deleteSelection}>
            delete
          </button>
          <button
            className="sel-act"
            onClick={discoverSelection}
            disabled={selection.length < 2}
          >
            find sameness
          </button>
          <button
            className="sel-act"
            onClick={stabilizeSelection}
            disabled={selection.length < 2}
          >
            stabilize
          </button>
          <button className="sel-act ghost" onClick={clearSelection}>
            clear
          </button>
        </div>
      )}

      {toast && <div className="void-toast">{toast}</div>}
    </div>
  );
}

function SavedNodeChip({ node, onPlant, onDelete }) {
  const k = KINDS[node.kind] || KINDS.idea;
  const preview =
    node.title || (node.text || "").trim().split("\n")[0].slice(0, 40) || "untitled";
  return (
    <div className="node-chip" style={{ "--c": node.color || k.color }} onClick={onPlant}>
      {node.type === "image" && node.image ? (
        <span className="node-thumb" style={{ backgroundImage: `url(${node.image})` }} />
      ) : (
        <span className="node-glyph">{k.glyph}</span>
      )}
      <span className="node-title">{preview}</span>
      <button
        className="node-del"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="remove"
      >
        ×
      </button>
    </div>
  );
}

const DISCOVERY_PHASES = [
  "scanning each thing for its deep structure…",
  "stripping away surface difference…",
  "searching for the shared invariant…",
  "testing the isomorphism across all of them…",
  "crystallizing the hidden structure…",
];

function DiscoveryOverlay({ count }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const phase = DISCOVERY_PHASES[Math.min(Math.floor(secs / 4), DISCOVERY_PHASES.length - 1)];
  return (
    <div className="discovery-overlay">
      <div className="disc-core">
        <div className="disc-ring" />
        <div className="disc-ring r2" />
        <div className="disc-ring r3" />
        <div className="disc-center">⟁</div>
      </div>
      <div className="disc-title">finding hidden sameness</div>
      <div className="disc-sub">across {count} things · {secs}s</div>
      <div className="disc-phase">{phase}</div>
    </div>
  );
}

const LAYERS = [
  { key: "field", n: "I", label: "field", sub: "resonance space" },
  { key: "branch", n: "II", label: "branching", sub: "collaborative growth" },
  { key: "exp", n: "III", label: "experimentation", sub: "manipulable matter" },
];

function LayersIndicator({ active }) {
  return (
    <div className="layers">
      {LAYERS.map((l) => (
        <div key={l.key} className={"layer" + (l.key === active ? " on" : "")}>
          <span className="layer-n">{l.n}</span>
          <span className="layer-text">
            <span className="layer-label">{l.label}</span>
            <span className="layer-sub">{l.sub}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function SelectionToolbar({ rect, pendingFrag, onOp, onConfirm }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: rect.left + rect.width / 2, top: rect.top - 8 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = rect.left + rect.width / 2 - w / 2;
    let top = rect.top - h - 10;
    left = Math.max(10, Math.min(window.innerWidth - w - 10, left));
    if (top < 10) top = rect.bottom + 10; // flip below if no room above
    setPos({ left, top });
  }, [rect]);

  return (
    <div className="sel-toolbar" ref={ref} style={{ left: pos.left, top: pos.top }}>
      {pendingFrag ? (
        <button
          className="sel-btn confirm"
          style={{ "--c": FRAG_OPS[pendingFrag.opKey].color }}
          onClick={onConfirm}
        >
          <span className="sel-sym">{FRAG_OPS[pendingFrag.opKey].sym}</span>
          <span className="sel-name">{FRAG_OPS[pendingFrag.opKey].name} with this</span>
        </button>
      ) : (
        FRAG_ORDER.map((k) => {
          const op = FRAG_OPS[k];
          return (
            <button
              key={k}
              className="sel-btn"
              style={{ "--c": op.color }}
              title={op.hint}
              onClick={() => onOp(k)}
            >
              <span className="sel-sym">{op.sym}</span>
              <span className="sel-name">{op.name}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

function makeBlankSymbol() {
  return {
    id: uid(),
    name: "",
    emoji: EMOJI_CHOICES[Math.floor(Math.random() * EMOJI_CHOICES.length)],
    color: COLOR_CHOICES[Math.floor(Math.random() * COLOR_CHOICES.length)],
    image: null,
    strokes: [],
    prompt: "",
    count: 1,
    __isNew: true,
  };
}

function SymbolIcon({ symbol, size = 22 }) {
  if (symbol?.image) {
    return (
      <img
        className="symbol-icon"
        src={symbol.image}
        alt={symbol.name || "operator"}
        width={size}
        height={size}
        draggable={false}
      />
    );
  }
  return (
    <span className="symbol-icon emoji" style={{ fontSize: size * 0.9 }}>
      {symbol?.emoji}
    </span>
  );
}

function OperatorChip({ operator, onEdit }) {
  const ghostRef = useRef(null);
  return (
    <div
      className="operator-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lens-operator", operator.id);
        e.dataTransfer.effectAllowed = "copy";
        if (ghostRef.current) e.dataTransfer.setDragImage(ghostRef.current, 28, 28);
      }}
      style={{ "--accent": operator.color }}
      title="Drag onto a seed"
    >
      <span className="chip-icon">
        <SymbolIcon symbol={operator} size={20} />
      </span>
      <span className="chip-name">{operator.name || "untitled"}</span>
      {operator.count > 1 && <span className="chip-count">×{operator.count}</span>}
      <button
        className="chip-edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Edit"
      >
        ⚙
      </button>
      <div className="drag-ghost" ref={ghostRef} style={{ "--accent": operator.color }}>
        <SymbolIcon symbol={operator} size={38} />
      </div>
    </div>
  );
}

// Realistic star tints (blue-white giants, sun-like, warm dwarfs)
const STAR_TINTS = [
  [170, 196, 255],
  [202, 220, 255],
  [235, 240, 255],
  [255, 252, 240],
  [255, 232, 200],
  [255, 210, 170],
];

function mod(v, m) {
  return ((v % m) + m) % m;
}

function Starfield({ camera }) {
  const ref = useRef(null);
  const camRef = useRef(camera);
  camRef.current = camera;

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    let raf;
    let w = 0;
    let h = 0;
    let stars = [];
    let shoots = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function init() {
      const n = Math.floor((w * h) / (5200 * dpr));
      const count = Math.max(140, Math.min(420, n));
      stars = Array.from({ length: count }, () => {
        const depth = Math.random();
        const bright = Math.random() < 0.07;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          r: (bright ? 1.4 + Math.random() * 1.8 : 0.3 + depth * 1.2) * dpr,
          base: bright ? 0.85 : 0.25 + depth * 0.5,
          tw: Math.random() * Math.PI * 2,
          tws: (bright ? 0.012 : 0.02 + Math.random() * 0.03),
          par: (0.015 + depth * 0.07) * dpr,
          tint: STAR_TINTS[Math.floor(Math.random() * STAR_TINTS.length)],
          bright,
          spike: bright ? (3 + Math.random() * 4) * dpr : 0,
        };
      });
    }
    function resize() {
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
      init();
    }

    function spawnShoot() {
      const fromLeft = Math.random() < 0.5;
      const y = Math.random() * h * 0.6;
      const speed = (7 + Math.random() * 6) * dpr;
      const ang = (fromLeft ? 0.32 : Math.PI - 0.32) + (Math.random() - 0.5) * 0.18;
      shoots.push({
        x: fromLeft ? -40 : w + 40,
        y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        life: 1,
        len: (90 + Math.random() * 80) * dpr,
        tint: STAR_TINTS[Math.floor(Math.random() * 3)],
      });
    }

    function tick() {
      ctx.clearRect(0, 0, w, h);
      const cam = camRef.current || { x: 0, y: 0 };

      for (const s of stars) {
        s.tw += s.tws;
        const tw = 0.55 + 0.45 * Math.sin(s.tw);
        const a = Math.min(1, s.base * tw);
        const px = mod(s.x - cam.x * s.par, w);
        const py = mod(s.y - cam.y * s.par, h);
        const [r, g, b] = s.tint;

        if (s.bright) {
          const glowR = s.r * 7;
          const grad = ctx.createRadialGradient(px, py, 0, px, py, glowR);
          grad.addColorStop(0, `rgba(${r},${g},${b},${a * 0.7})`);
          grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, glowR, 0, Math.PI * 2);
          ctx.fill();

          // diffraction spikes
          ctx.strokeStyle = `rgba(${r},${g},${b},${a * 0.5})`;
          ctx.lineWidth = 0.7 * dpr;
          const sp = s.spike * (0.7 + 0.3 * tw);
          ctx.beginPath();
          ctx.moveTo(px - sp, py);
          ctx.lineTo(px + sp, py);
          ctx.moveTo(px, py - sp);
          ctx.lineTo(px, py + sp);
          ctx.stroke();
        }

        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        ctx.beginPath();
        ctx.arc(px, py, s.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // shooting stars
      if (Math.random() < 0.005 && shoots.length < 2) spawnShoot();
      shoots = shoots.filter((sh) => sh.life > 0 && sh.x > -80 && sh.x < w + 80);
      for (const sh of shoots) {
        sh.x += sh.vx;
        sh.y += sh.vy;
        sh.life -= 0.012;
        const tx = sh.x - sh.vx * (sh.len / Math.hypot(sh.vx, sh.vy));
        const ty = sh.y - sh.vy * (sh.len / Math.hypot(sh.vx, sh.vy));
        const [r, g, b] = sh.tint;
        const grad = ctx.createLinearGradient(sh.x, sh.y, tx, ty);
        grad.addColorStop(0, `rgba(${r},${g},${b},${0.9 * sh.life})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.6 * dpr;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sh.x, sh.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${sh.life})`;
        ctx.beginPath();
        ctx.arc(sh.x, sh.y, 1.6 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    }
    resize();
    tick();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="starfield" />;
}

function Synapses({ seeds, edges }) {
  const pos = useMemo(() => {
    const m = {};
    for (const s of seeds) m[s.id] = s;
    return m;
  }, [seeds]);

  return (
    <svg className="synapses" overflow="visible">
      {edges.map((e) => {
        const a = pos[e.a];
        const b = pos[e.b];
        if (!a || !b) return null;
        return (
          <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="synapse" stroke={a.color} />
        );
      })}
    </svg>
  );
}

function Seed({ seed, scale, selected, pendingFrom, picked, pickMode, marked, busy, onActivate, onMoveBy, onDropOperator }) {
  const drag = useRef(null);
  const [over, setOver] = useState(false);
  const isSketch = seed.type === "sketch";
  const isImage = seed.type === "image";
  const kind = KINDS[seed.kind] || null;
  const size = isSketch || isImage
    ? 64
    : Math.round(20 + Math.min((seed.text || "").length / 12, 26));

  function down(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { moved: 0 };
  }
  function move(e) {
    if (!drag.current) return;
    drag.current.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    onMoveBy(e.movementX / scale, e.movementY / scale);
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d && d.moved < 4) onActivate();
  }

  const preview = seed.title
    ? seed.title
    : isSketch || isImage
    ? ""
    : (seed.text || "").trim().split("\n")[0].slice(0, 36);

  return (
    <div
      className={
        "seed" +
        (selected ? " selected" : "") +
        (pendingFrom ? " combine-from" : "") +
        (picked ? " picked" : "") +
        (marked ? " marked" : "") +
        (pickMode ? " targetable" : "") +
        (seed.particle ? " particle" : "") +
        (seed.discovery || seed.struct ? " structure" : "") +
        (seed.analysis ? " analysis" : "") +
        (seed.flash ? " flash" : "") +
        (busy || seed.loading ? " busy" : "") +
        (seed.loading ? " forming" : "") +
        (over ? " op-over" : "")
      }
      style={{ left: seed.x, top: seed.y }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData("text/lens-operator");
        if (id) onDropOperator(id);
      }}
    >
      {(isSketch || isImage) && seed.image ? (
        <div
          className={isImage ? "seed-image" : "seed-sketch"}
          style={{ width: size, height: size, "--glow": seed.color, backgroundImage: `url(${seed.image})` }}
        />
      ) : (
        <div className="seed-core" style={{ width: size, height: size, "--glow": seed.color }} />
      )}
      {kind && (
        <div className="seed-kind" style={{ color: seed.color }} title={kind.label}>
          {kind.glyph}
        </div>
      )}
      {preview && <div className="seed-label">{preview}</div>}
    </div>
  );
}

function SeedPanel({ seed, pos, flip, busy, onChange, onOp, onDelete, onReplay, onSave, onSavePath, onClose }) {
  const ref = useRef(null);
  const isSketch = seed.type === "sketch";
  const isImage = seed.type === "image";
  const legacy = ["evolve", "branch", "split", "combine", "operator"];
  const hasFormation = (seed.history || []).some(
    (s) => OPS[s.kind] || legacy.includes(s.kind)
  );
  const hasPath = (seed.history || []).some((s) => OPS[s.kind] && OPS[s.kind].prompt);
  const [editing, setEditing] = useState(!(seed.text || "").trim());
  useEffect(() => {
    setEditing(!(seed.text || "").trim());
  }, [seed.id]);
  useEffect(() => {
    const el = ref.current;
    if (el && editing) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 220) + "px";
    }
  }, [seed.text, editing]);

  return (
    <div
      className={"seed-panel" + (flip ? " left" : "")}
      style={{ left: pos.x, top: pos.y, "--glow": seed.color }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="seed-panel-glow" />

      {seed.title && <div className="seed-struct-title">{seed.title}</div>}

      <div className="kind-picker">
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            className={"kind-chip" + (seed.kind === k ? " on" : "")}
            style={{ "--c": KINDS[k].color }}
            title={KINDS[k].label}
            onClick={() => onChange({ kind: k, color: KINDS[k].color })}
          >
            <span className="kind-glyph">{KINDS[k].glyph}</span>
          </button>
        ))}
      </div>

      {isImage ? (
        <div className="seed-image-view">
          <div className="img-frame" style={{ backgroundImage: `url(${seed.image})` }} />
          <textarea
            className="seed-input caption"
            value={seed.text}
            placeholder="add a note or question about this image… (Claude can see it)"
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </div>
      ) : isSketch ? (
        <DrawPad
          initialStrokes={seed.strokes}
          accent={seed.color}
          onChange={(image, strokes) => onChange({ image, strokes })}
        />
      ) : editing ? (
        <textarea
          ref={ref}
          autoFocus
          className="seed-input"
          value={seed.text}
          placeholder="speak the thought into being…"
          onBlur={() => {
            if ((seed.text || "").trim()) setEditing(false);
          }}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      ) : (
        <div className="seed-read-wrap">
          <div className="seed-read" data-selectable data-seed-id={seed.id}>
            {seed.text}
          </div>
          <button
            className="read-edit"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setEditing(true)}
            title="edit text"
          >
            ✎
          </button>
          <div className="read-hint">highlight any words to operate on them</div>
        </div>
      )}

      {!isSketch && (
        <div className="grammar">
          {OP_GROUPS.map((g) => (
            <div className="op-group" key={g.key}>
              <span className="op-group-label">{g.label}</span>
              <div className={"op-row " + g.key}>
                {opsIn(g.key).map((op) => (
                  <button
                    key={op.key}
                    className={"op-btn" + (op.arity === 2 || op.arity === "many-select" ? " dual" : "")}
                    style={{ "--c": op.color }}
                    onClick={() => onOp(op.key)}
                    disabled={busy}
                    title={`${op.name}${
                      op.arity === 2
                        ? " (needs a second idea)"
                        : op.arity === "many-select"
                        ? " (collapses several ideas)"
                        : ""
                    }`}
                  >
                    <span className="op-sym">{op.sym}</span>
                    <span className="op-name">{op.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="seed-foot">
        <button
          className="ghost-btn replay"
          onClick={onReplay}
          disabled={!hasFormation}
          title={hasFormation ? "replay formation" : "no operations yet — apply a primitive, interaction, or operator first"}
        >
          ▷ replay
        </button>
        <button className="ghost-btn save" onClick={onSave} title="save this node to the toolbox">
          ⊕ save
        </button>
        <button
          className="ghost-btn save"
          onClick={onSavePath}
          disabled={!hasPath}
          title={hasPath ? "save the sequence of functions as a reusable operator" : "no reusable function-path yet"}
        >
          ⛓ path → operator
        </button>
        <div className="spacer" />
        <button className="ghost-btn" onClick={onDelete}>
          dissolve
        </button>
        <button className="ghost-btn" onClick={onClose}>
          close
        </button>
      </div>
    </div>
  );
}

function StepGlyph({ step, color }) {
  const op = step.op;
  if (op && op.image) return <img className="stage-img" src={op.image} alt={op.name || ""} />;
  if (op && op.emoji) return <span className="stage-emoji">{op.emoji}</span>;
  const meta = VERB_META[step.kind] || VERB_META.operator;
  return <span className="stage-symbol" style={{ color }}>{meta.symbol}</span>;
}

// estimate a comfortable reading time for a scene
function readMs(text) {
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;
  return Math.min(9000, Math.max(3600, 900 + words * 320));
}

function Replay({ seed, onClose }) {
  const steps = useMemo(
    () => (seed.history && seed.history.length ? seed.history : [{ kind: "plant", op: null, to: seed.text }]),
    [seed]
  );

  const [phase, setPhase] = useState("loading"); // loading | play | error
  const [journey, setJourney] = useState(null);
  const [errMsg, setErrMsg] = useState("");
  const [i, setI] = useState(0); // 0 = title, 1..N = stages, N+1 = synthesis
  const [playing, setPlaying] = useState(true);

  const total = steps.length + 2; // title + stages + synthesis

  async function trace() {
    setPhase("loading");
    setErrMsg("");
    try {
      const j = await narrateJourney(steps);
      setJourney(j);
      setI(0);
      setPlaying(true);
      setPhase("play");
    } catch (e) {
      setErrMsg(e.message || "Could not trace the thought.");
      setPhase("error");
    }
  }

  useEffect(() => {
    trace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // scene content for timing
  const sceneText = useMemo(() => {
    if (phase !== "play" || !journey) return "";
    if (i === 0) return journey.title || "";
    if (i === total - 1) return journey.synthesis || "";
    const ch = journey.chapters[i - 1] || {};
    return (ch.narration || "") + " " + (steps[i - 1]?.to || "");
  }, [phase, journey, i, total, steps]);

  useEffect(() => {
    if (phase !== "play" || !playing) return;
    if (i >= total - 1) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => setI((v) => v + 1), readMs(sceneText));
    return () => clearTimeout(t);
  }, [phase, playing, i, total, sceneText]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
      if (phase !== "play") return;
      if (e.key === "ArrowRight") {
        setPlaying(false);
        setI((v) => Math.min(total - 1, v + 1));
      }
      if (e.key === "ArrowLeft") {
        setPlaying(false);
        setI((v) => Math.max(0, v - 1));
      }
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, total, onClose]);

  if (phase === "loading") {
    return (
      <div className="replay-overlay" onClick={onClose}>
        <div className="replay-stage loading" onClick={(e) => e.stopPropagation()} style={{ "--c": "#5e6b80" }}>
          <div className="replay-orb-wrap">
            <span className="replay-shock" />
            <span className="replay-shock two" />
            <div className="replay-orb tracing" />
          </div>
          <div className="replay-tracing">tracing the thought…</div>
          <div className="replay-sub">reconstructing how this idea came to be</div>
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="replay-overlay" onClick={onClose}>
        <div className="replay-stage" onClick={(e) => e.stopPropagation()} style={{ "--c": "#fb7185" }}>
          <div className="replay-label" style={{ color: "#fb7185" }}>
            the thread went dark
          </div>
          <div className="replay-sub">{errMsg}</div>
          <div className="replay-controls">
            <button className="ghost-btn" onClick={trace}>
              ⟲ try again
            </button>
            <div className="spacer" />
            <button className="ghost-btn" onClick={onClose}>
              close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- play phase ----
  const isTitle = i === 0;
  const isSynth = i === total - 1;
  const stepIdx = i - 1;
  const step = !isTitle && !isSynth ? steps[stepIdx] : null;
  const chapter = step ? journey.chapters[stepIdx] || {} : null;
  const meta = step ? VERB_META[step.kind] || VERB_META.operator : null;
  const color = isTitle
    ? "#5e6b80"
    : isSynth
    ? "#a78bfa"
    : (step.op && step.op.color) || meta.color;

  return (
    <div className="replay-overlay" onClick={onClose}>
      <div className="replay-stage" onClick={(e) => e.stopPropagation()} style={{ "--c": color }}>
        <div className="replay-journey-title">{journey.title}</div>

        {isTitle ? (
          <div className="replay-scene title" key="title">
            <div className="replay-count">the journey of</div>
            <h1 className="replay-big">{journey.title}</h1>
            <div className="replay-sub">{steps.length} stages · from first spark to final form</div>
          </div>
        ) : isSynth ? (
          <div className="replay-scene synth" key="synth">
            <div className="replay-count">the arc, end to end</div>
            <div className="replay-orb-wrap" key="synth-orb">
              <span className="replay-shock" />
              <div className="replay-orb">
                <span className="stage-symbol" style={{ color }}>
                  ✧
                </span>
              </div>
            </div>
            <div className="replay-synthesis">{journey.synthesis}</div>
            <div className="replay-final">“{steps[steps.length - 1]?.to}”</div>
          </div>
        ) : (
          <div className="replay-scene" key={"s" + i}>
            <div className="replay-head">
              <span className="replay-count">
                stage {stepIdx + 1} / {steps.length}
              </span>
              <span className="replay-move" style={{ color }}>
                {chapter.move || (step.op && step.op.name) || meta.label}
              </span>
            </div>

            {step.parents && (
              <div className="replay-parents">
                {step.parents.map((p, k) => (
                  <div className="replay-parent" key={k}>
                    {(p.text || "").slice(0, 80) || "—"}
                  </div>
                ))}
              </div>
            )}

            <div className="replay-orb-wrap" key={"o" + i}>
              <span className="replay-shock" />
              <span className="replay-shock two" />
              <div className="replay-orb">
                <StepGlyph step={step} color={color} />
              </div>
            </div>

            <div className="replay-narration">{chapter.narration}</div>
            <div className="replay-text">{step.to ? `“${step.to}”` : <em className="muted">an empty seed</em>}</div>
          </div>
        )}

        <div className="replay-dots">
          {Array.from({ length: total }, (_, k) => (
            <button
              key={k}
              className={"replay-dot" + (k === i ? " on" : "") + (k < i ? " done" : "")}
              onClick={() => {
                setPlaying(false);
                setI(k);
              }}
            />
          ))}
        </div>

        <div className="replay-controls">
          <button
            className="ghost-btn"
            onClick={() => {
              setI(0);
              setPlaying(true);
            }}
          >
            ⟲ restart
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              setPlaying(false);
              setI((v) => Math.max(0, v - 1));
            }}
            disabled={i === 0}
          >
            ‹ prev
          </button>
          <button className="ghost-btn" onClick={() => setPlaying((v) => !v)}>
            {playing ? "❚❚ pause" : "▷ play"}
          </button>
          <button
            className="ghost-btn"
            onClick={() => {
              setPlaying(false);
              setI((v) => Math.min(total - 1, v + 1));
            }}
            disabled={i >= total - 1}
          >
            next ›
          </button>
          <div className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            close
          </button>
        </div>
      </div>
    </div>
  );
}

function DrawPad({ initialStrokes = [], accent = "#2f5d8a", onChange }) {
  const canvasRef = useRef(null);
  const [strokes, setStrokes] = useState(() => initialStrokes || []);
  const [color, setColor] = useState("#20201d");
  const [size, setSize] = useState(8);
  const [erasing, setErasing] = useState(false);
  const drawingRef = useRef(null);

  function paintStroke(ctx, stroke) {
    if (!stroke.points.length) return;
    ctx.globalCompositeOperation = stroke.erase ? "destination-out" : "source-over";
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const pts = stroke.points;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, stroke.size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function redraw(allStrokes) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    for (const s of allStrokes) paintStroke(ctx, s);
    ctx.globalCompositeOperation = "source-over";
  }

  useEffect(() => {
    redraw(strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commit(next) {
    setStrokes(next);
    redraw(next);
    const hasInk = next.some((s) => !s.erase && s.points.length);
    const image = hasInk ? canvasRef.current.toDataURL("image/png") : null;
    onChange?.(image, next);
  }

  function toCanvasCoords(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * CANVAS_SIZE,
      y: ((e.clientY - rect.top) / rect.height) * CANVAS_SIZE,
    };
  }

  function onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    canvasRef.current.setPointerCapture(e.pointerId);
    const stroke = { color, size, erase: erasing, points: [toCanvasCoords(e)] };
    drawingRef.current = stroke;
    const ctx = canvasRef.current.getContext("2d");
    paintStroke(ctx, stroke);
    ctx.globalCompositeOperation = "source-over";
  }
  function onPointerMove(e) {
    if (!drawingRef.current) return;
    drawingRef.current.points.push(toCanvasCoords(e));
    redraw([...strokes, drawingRef.current]);
  }
  function onPointerUp() {
    if (!drawingRef.current) return;
    const next = [...strokes, drawingRef.current];
    drawingRef.current = null;
    commit(next);
  }

  return (
    <div className="drawpad">
      <div className="drawpad-canvas-wrap" style={{ "--accent": accent }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="drawpad-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {strokes.length === 0 && <div className="drawpad-placeholder">draw here</div>}
      </div>

      <div className="drawpad-tools">
        <div className="pen-colors">
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              className={"pen-dot" + (!erasing && color === c ? " on" : "")}
              style={{ background: c }}
              onClick={() => {
                setColor(c);
                setErasing(false);
              }}
            />
          ))}
        </div>
        <div className="drawpad-row">
          <button className={"orb-btn tiny" + (erasing ? " on" : "")} onClick={() => setErasing((v) => !v)}>
            {erasing ? "erasing" : "eraser"}
          </button>
          <input
            className="size-slider"
            type="range"
            min="2"
            max="40"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
          />
          <button className="orb-btn tiny" onClick={() => commit(strokes.slice(0, -1))} disabled={!strokes.length}>
            undo
          </button>
          <button className="orb-btn tiny" onClick={() => commit([])} disabled={!strokes.length}>
            clear
          </button>
        </div>
      </div>
    </div>
  );
}

function SymbolEditor({ symbol, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState({ ...symbol });
  const valid = draft.name.trim() && draft.prompt.trim();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{symbol.__isNew ? "form an operator" : "edit operator"}</h2>

        <label className="field">
          <span>name</span>
          <input
            autoFocus
            value={draft.name}
            placeholder="e.g. Distill"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>

        <div className="field">
          <span>draw its glyph</span>
          <DrawPad
            initialStrokes={draft.strokes}
            accent={draft.color}
            onChange={(image, strokes) => setDraft((d) => ({ ...d, image, strokes }))}
          />
          <small className="muted">draw a mark, or leave blank to use the emoji below</small>
        </div>

        <div className="field-row">
          <div className="field">
            <span>aura color</span>
            <div className="color-grid">
              {COLOR_CHOICES.map((c) => (
                <button
                  key={c}
                  className={"color-opt" + (draft.color === c ? " on" : "")}
                  style={{ background: c }}
                  onClick={() => setDraft({ ...draft, color: c })}
                />
              ))}
            </div>
          </div>
          <div className="field">
            <span>emoji fallback</span>
            <div className="emoji-grid">
              {EMOJI_CHOICES.map((em) => (
                <button
                  key={em}
                  className={"emoji-opt" + (draft.emoji === em ? " on" : "")}
                  onClick={() => setDraft({ ...draft, emoji: em })}
                >
                  {em}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="field">
          <span>seeds spawned per run</span>
          <div className="stepper-row">
            <div className="stepper">
              <button
                className="stepper-btn"
                onClick={() => setDraft((d) => ({ ...d, count: Math.max(1, (d.count || 1) - 1) }))}
                disabled={(draft.count || 1) <= 1}
              >
                −
              </button>
              <span className="stepper-value">{draft.count || 1}</span>
              <button
                className="stepper-btn"
                onClick={() =>
                  setDraft((d) => ({ ...d, count: Math.min(MAX_RESPONSES, (d.count || 1) + 1) }))
                }
                disabled={(draft.count || 1) >= MAX_RESPONSES}
              >
                +
              </button>
            </div>
            <span className="muted small">each run scatters this many new seeds.</span>
          </div>
        </div>

        <label className="field">
          <span>prompt</span>
          <textarea
            rows={4}
            value={draft.prompt}
            placeholder="what does this operator do to a seed?"
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
          <small className="muted">the seed's text is attached automatically.</small>
        </label>

        <div className="modal-actions">
          {onDelete && (
            <button
              className="ghost-btn danger"
              onClick={() => {
                onDelete(symbol.id);
                onClose();
              }}
            >
              delete
            </button>
          )}
          <div className="spacer" />
          <button className="ghost-btn" onClick={onClose}>
            cancel
          </button>
          <button className="orb-btn solid" disabled={!valid} onClick={() => {
            const { __isNew, ...clean } = draft;
            onSave(clean);
          }}>
            save
          </button>
        </div>
      </div>
    </div>
  );
}
