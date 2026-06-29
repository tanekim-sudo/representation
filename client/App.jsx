import React, { useEffect, useMemo, useRef, useState } from "react";

const SEEDS_KEY = "lens.seeds.v2";
const EDGES_KEY = "lens.edges.v2";
const CAMERA_KEY = "lens.camera.v2";
const SYMBOLS_KEY = "lens.operators.v2";

const MAX_RESPONSES = 6;
const CANVAS_SIZE = 256;

const STAR_COLORS = ["#8ab4ff", "#a78bfa", "#22d3ee", "#f0abfc", "#fcd34d", "#7dd3fc", "#5eead4"];

const EMOJI_CHOICES = [
  "✨", "📝", "🔍", "🌍", "🎯", "💡", "🧹", "📌", "🔥", "🧠",
  "⚡", "🪄", "📖", "✂️", "🎨", "🧪", "🗜️", "💬", "🔧", "⭐",
];
const COLOR_CHOICES = [
  "#8ab4ff", "#a78bfa", "#22d3ee", "#f0abfc", "#fcd34d",
  "#5eead4", "#fb7185", "#34d399", "#60a5fa", "#c084fc",
];
const PEN_COLORS = ["#ffffff", "#8ab4ff", "#a78bfa", "#22d3ee", "#f0abfc", "#fcd34d", "#5eead4", "#fb7185"];

const PROMPTS = {
  evolve:
    "Evolve and deepen this idea into a more developed, more interesting form. Keep it a single idea. Return only the evolved idea, no preamble.",
  branch:
    "Given this idea, propose ONE new idea that branches off it in a fresh, related but distinct direction. Return only the new idea, no preamble.",
  split:
    "Break this idea into 2 to 4 distinct sub-ideas. Return each sub-idea on its own line as a short phrase or sentence. No numbering, no bullets, no preamble.",
  combine:
    "Synthesize these two ideas into a single new idea that captures the essence of both. Return only the combined idea, no preamble.",
};

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
  return { id: uid(), type: "text", x, y, text, color: pickColor(), born: Date.now(), ...extra };
}

async function runClaude(prompt, text, count = 1) {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, text, count }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "The void did not answer.");
  return data.outputs || [];
}

async function ask(prompt, text) {
  const outs = await runClaude(prompt, text, 1);
  return outs[0] || "";
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
  const [combineFrom, setCombineFrom] = useState(null);
  const [busyIds, setBusyIds] = useState([]);
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toolboxOpen, setToolboxOpen] = useState(true);

  const viewportRef = useRef(null);
  const panRef = useRef(null);

  useEffect(() => {
    const clean = seeds.map(({ busy, flash, loading, error, ...s }) => s);
    localStorage.setItem(SEEDS_KEY, JSON.stringify(clean));
  }, [seeds]);
  useEffect(() => localStorage.setItem(EDGES_KEY, JSON.stringify(edges)), [edges]);
  useEffect(() => localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)), [camera]);
  useEffect(() => localStorage.setItem(SYMBOLS_KEY, JSON.stringify(symbols)), [symbols]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") {
        setSelected(null);
        setCombineFrom(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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

  function onPointerDown(e) {
    if (e.target.closest(".seed") || e.target.closest(".seed-panel")) return;
    panRef.current = { x: e.clientX, y: e.clientY, moved: 0 };
    viewportRef.current.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.x;
    const dy = e.clientY - panRef.current.y;
    panRef.current.x = e.clientX;
    panRef.current.y = e.clientY;
    panRef.current.moved += Math.abs(dx) + Math.abs(dy);
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }
  function onPointerUp() {
    const p = panRef.current;
    panRef.current = null;
    if (p && p.moved < 4) {
      setSelected(null);
      setCombineFrom(null);
    }
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
  function plantText(x, y) {
    const c = x == null ? viewCenterWorld() : { x, y };
    const seed = makeSeed(c.x, c.y, "");
    setSeeds((p) => [...p, seed]);
    setSelected(seed.id);
  }
  function plantSketch() {
    const c = viewCenterWorld();
    const seed = makeSeed(c.x, c.y, "", { type: "sketch", image: null, strokes: [] });
    setSeeds((p) => [...p, seed]);
    setSelected(seed.id);
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
    if (combineFrom === id) setCombineFrom(null);
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

  async function evolve(seed) {
    if (!seed.text.trim()) return showToast("This seed is still empty.");
    setBusy(seed.id, true);
    try {
      const out = await ask(PROMPTS.evolve, seed.text);
      updateSeed(seed.id, { text: out, color: pickColor() });
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(seed.id, false);
    }
  }

  async function branch(seed) {
    if (!seed.text.trim()) return showToast("This seed is still empty.");
    setBusy(seed.id, true);
    try {
      const out = await ask(PROMPTS.branch, seed.text);
      const pos = placeNear(seed);
      const child = makeSeed(pos.x, pos.y, out);
      setSeeds((p) => [...p, child]);
      connect(seed.id, child.id);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(seed.id, false);
    }
  }

  function parseLines(out) {
    const parts = out
      .split("\n")
      .map((l) => l.replace(/^[\s\-*\d.)]+/, "").trim())
      .filter(Boolean);
    return parts.length ? parts : [out];
  }

  async function split(seed) {
    if (!seed.text.trim()) return showToast("This seed is still empty.");
    setBusy(seed.id, true);
    try {
      const out = await ask(PROMPTS.split, seed.text);
      const list = parseLines(out);
      const children = list.map((t, i) => {
        const pos = placeNear(seed, i, list.length);
        return makeSeed(pos.x, pos.y, t);
      });
      setSeeds((p) => [...p, ...children]);
      setEdges((p) => [...p, ...children.map((c) => ({ id: uid(), a: seed.id, b: c.id }))]);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(seed.id, false);
    }
  }

  async function combine(a, b) {
    setBusy(a.id, true);
    setBusy(b.id, true);
    try {
      const out = await ask(PROMPTS.combine, `Idea A:\n${a.text}\n\nIdea B:\n${b.text}`);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 40 };
      const child = makeSeed(mid.x, mid.y, out);
      setSeeds((p) => [...p, child]);
      setEdges((p) => [
        ...p,
        { id: uid(), a: a.id, b: child.id },
        { id: uid(), a: b.id, b: child.id },
      ]);
      setSelected(child.id);
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(a.id, false);
      setBusy(b.id, false);
    }
  }

  // ---- custom operator applied to a seed ----
  async function applyOperator(opId, seed) {
    const op = symbols.find((s) => s.id === opId);
    if (!op) return;
    const text = (seed.text || "").trim();
    if (!text && seed.type !== "sketch") return showToast("This seed is still empty.");
    const n = Math.min(Math.max(op.count || 1, 1), MAX_RESPONSES);

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
          if (i < outs.length) arr[idx] = { ...arr[idx], loading: false, text: outs[i] };
          else arr.splice(idx, 1);
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
    if (combineFrom && combineFrom !== id) {
      const a = seeds.find((s) => s.id === combineFrom);
      const b = seeds.find((s) => s.id === id);
      setCombineFrom(null);
      if (a && b) combine(a, b);
      return;
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

  return (
    <div className="void-app">
      <Starfield />
      <div className="nebula" />

      <div
        className="viewport"
        ref={viewportRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
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
              combineFrom={combineFrom === s.id}
              combineMode={Boolean(combineFrom)}
              busy={busyIds.includes(s.id)}
              onActivate={() => onSeedActivate(s.id)}
              onMoveBy={(dx, dy) => moveSeedBy(s.id, dx, dy)}
              onDropOperator={(opId) => applyOperator(opId, s)}
            />
          ))}
        </div>
      </div>

      <header className="void-brand">
        <span className="void-mark">✦</span>
        <span>lens</span>
      </header>

      {/* Toolbox of operators */}
      <aside className={"toolbox" + (toolboxOpen ? "" : " collapsed")}>
        <div className="toolbox-head">
          <h2>operators</h2>
          <button className="toolbox-toggle" onClick={() => setToolboxOpen((v) => !v)}>
            {toolboxOpen ? "‹" : "›"}
          </button>
        </div>
        {toolboxOpen && (
          <>
            <p className="toolbox-hint">drag a glyph onto a seed</p>
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
      </aside>

      {/* plant controls */}
      <div className="plant-bar">
        <button className="plant-btn" onClick={() => plantText()}>
          ✦ seed
        </button>
        <button className="plant-btn" onClick={plantSketch}>
          ✎ sketch
        </button>
      </div>

      {seeds.length === 0 && (
        <div className="void-hint">
          <p>emptiness, full of potential</p>
          <span>double&#8209;click anywhere to plant a seed of light</span>
        </div>
      )}

      {combineFrom && (
        <div className="combine-banner">
          choose another seed to combine · <em>esc to cancel</em>
        </div>
      )}

      {selectedSeed && screenPos && (
        <SeedPanel
          seed={selectedSeed}
          pos={screenPos}
          flip={screenPos.x > window.innerWidth - 340}
          busy={busyIds.includes(selectedSeed.id)}
          onChange={(patch) => updateSeed(selectedSeed.id, patch)}
          onEvolve={() => evolve(selectedSeed)}
          onBranch={() => branch(selectedSeed)}
          onSplit={() => split(selectedSeed)}
          onCombine={() => setCombineFrom(selectedSeed.id)}
          onDelete={() => deleteSeed(selectedSeed.id)}
          onClose={() => setSelected(null)}
        />
      )}

      {editing && (
        <SymbolEditor
          symbol={editing}
          onSave={saveSymbol}
          onDelete={editing.id && symbols.some((s) => s.id === editing.id) ? deleteSymbol : null}
          onClose={() => setEditing(null)}
        />
      )}

      {toast && <div className="void-toast">{toast}</div>}
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

function Starfield() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas.getContext("2d");
    let raf;
    let w = 0;
    let h = 0;
    let stars = [];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function init() {
      const n = Math.floor((w * h) / (9000 * dpr));
      stars = Array.from({ length: Math.max(80, Math.min(260, n)) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.5 * dpr + 0.2,
        a: Math.random() * Math.PI * 2,
        tw: Math.random() * 0.02 + 0.004,
        vx: (Math.random() - 0.5) * 0.05 * dpr,
        vy: (Math.random() - 0.5) * 0.05 * dpr,
      }));
    }
    function resize() {
      w = canvas.width = canvas.offsetWidth * dpr;
      h = canvas.height = canvas.offsetHeight * dpr;
      init();
    }
    function tick() {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        s.a += s.tw;
        s.x += s.vx;
        s.y += s.vy;
        if (s.x < 0) s.x += w;
        if (s.x > w) s.x -= w;
        if (s.y < 0) s.y += h;
        if (s.y > h) s.y -= h;
        const alpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(s.a));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(205, 222, 255, ${alpha})`;
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

function Seed({ seed, scale, selected, combineFrom, combineMode, busy, onActivate, onMoveBy, onDropOperator }) {
  const drag = useRef(null);
  const [over, setOver] = useState(false);
  const isSketch = seed.type === "sketch";
  const size = isSketch
    ? 60
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

  const preview = isSketch ? "" : (seed.text || "").trim().split("\n")[0].slice(0, 36);

  return (
    <div
      className={
        "seed" +
        (selected ? " selected" : "") +
        (combineFrom ? " combine-from" : "") +
        (combineMode ? " targetable" : "") +
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
      {isSketch && seed.image ? (
        <div
          className="seed-sketch"
          style={{ width: size, height: size, "--glow": seed.color, backgroundImage: `url(${seed.image})` }}
        />
      ) : (
        <div className="seed-core" style={{ width: size, height: size, "--glow": seed.color }} />
      )}
      {preview && <div className="seed-label">{preview}</div>}
    </div>
  );
}

function SeedPanel({ seed, pos, flip, busy, onChange, onEvolve, onBranch, onSplit, onCombine, onDelete, onClose }) {
  const ref = useRef(null);
  const isSketch = seed.type === "sketch";
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 220) + "px";
    }
  }, [seed.text]);

  return (
    <div
      className={"seed-panel" + (flip ? " left" : "")}
      style={{ left: pos.x, top: pos.y, "--glow": seed.color }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="seed-panel-glow" />

      {isSketch ? (
        <DrawPad
          initialStrokes={seed.strokes}
          accent={seed.color}
          onChange={(image, strokes) => onChange({ image, strokes })}
        />
      ) : (
        <textarea
          ref={ref}
          autoFocus
          className="seed-input"
          value={seed.text}
          placeholder="speak the thought into being…"
          onChange={(e) => onChange({ text: e.target.value })}
        />
      )}

      {!isSketch && (
        <div className="seed-actions">
          <button className="orb-btn" onClick={onBranch} disabled={busy}>
            branch
          </button>
          <button className="orb-btn" onClick={onEvolve} disabled={busy}>
            evolve
          </button>
          <button className="orb-btn" onClick={onSplit} disabled={busy}>
            split
          </button>
          <button className="orb-btn" onClick={onCombine} disabled={busy}>
            combine
          </button>
        </div>
      )}

      <div className="seed-foot">
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

function DrawPad({ initialStrokes = [], accent = "#8ab4ff", onChange }) {
  const canvasRef = useRef(null);
  const [strokes, setStrokes] = useState(() => initialStrokes || []);
  const [color, setColor] = useState("#ffffff");
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
          <label className="pen-dot custom" title="Custom color">
            <input
              type="color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
                setErasing(false);
              }}
            />
          </label>
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
