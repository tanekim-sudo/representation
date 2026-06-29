import React, { useEffect, useMemo, useRef, useState } from "react";

const SEEDS_KEY = "lens.seeds.v2";
const EDGES_KEY = "lens.edges.v2";
const CAMERA_KEY = "lens.camera.v2";

const STAR_COLORS = ["#8ab4ff", "#a78bfa", "#22d3ee", "#f0abfc", "#fcd34d", "#7dd3fc", "#5eead4"];

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

function makeSeed(x, y, text = "") {
  return { id: uid(), x, y, text, color: pickColor(), born: Date.now() };
}

async function ask(prompt, text) {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, text, count: 1 }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "The void did not answer.");
  return (data.outputs && data.outputs[0]) || "";
}

export default function App() {
  const [seeds, setSeeds] = useState(() => load(SEEDS_KEY, []));
  const [edges, setEdges] = useState(() => load(EDGES_KEY, []));
  const [camera, setCamera] = useState(() => load(CAMERA_KEY, { x: 0, y: 0, scale: 1 }));
  const [selected, setSelected] = useState(null);
  const [combineFrom, setCombineFrom] = useState(null);
  const [busyIds, setBusyIds] = useState([]);
  const [toast, setToast] = useState(null);

  const viewportRef = useRef(null);
  const panRef = useRef(null);

  useEffect(() => {
    const clean = seeds.map(({ busy, flash, ...s }) => s);
    localStorage.setItem(SEEDS_KEY, JSON.stringify(clean));
  }, [seeds]);
  useEffect(() => localStorage.setItem(EDGES_KEY, JSON.stringify(edges)), [edges]);
  useEffect(() => localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)), [camera]);

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
    setTimeout(() => setToast(null), 3200);
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
    const seed = makeSeed(w.x, w.y, "");
    setSeeds((p) => [...p, seed]);
    setSelected(seed.id);
  }

  // ---- seed ops ----
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
    const angle = total > 1 ? base + (index / total) * Math.PI * 1.6 : base;
    const radius = 150 + Math.random() * 40;
    return { x: seed.x + Math.cos(angle) * radius, y: seed.y + Math.sin(angle) * radius };
  }

  async function evolve(seed) {
    if (!seed.text.trim()) return showToast("This seed is still empty.");
    setBusy(seed.id, true);
    try {
      const out = await ask(PROMPTS.evolve, seed.text);
      updateSeed(seed.id, { text: out, color: pickColor() });
      pulse(seed.id);
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

  async function split(seed) {
    if (!seed.text.trim()) return showToast("This seed is still empty.");
    setBusy(seed.id, true);
    try {
      const out = await ask(PROMPTS.split, seed.text);
      const parts = out
        .split("\n")
        .map((l) => l.replace(/^[\s\-\*\d.\)]+/, "").trim())
        .filter(Boolean);
      const list = parts.length ? parts : [out];
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

  function pulse(id) {
    setSeeds((p) => p.map((s) => (s.id === id ? { ...s, flash: Date.now() } : s)));
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
            />
          ))}
        </div>
      </div>

      <header className="void-brand">
        <span className="void-mark">✦</span>
        <span>lens</span>
      </header>

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
          onChange={(text) => updateSeed(selectedSeed.id, { text })}
          onEvolve={() => evolve(selectedSeed)}
          onBranch={() => branch(selectedSeed)}
          onSplit={() => split(selectedSeed)}
          onCombine={() => setCombineFrom(selectedSeed.id)}
          onDelete={() => deleteSeed(selectedSeed.id)}
          onClose={() => setSelected(null)}
        />
      )}

      {toast && <div className="void-toast">{toast}</div>}
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
          <line
            key={e.id}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            className="synapse"
            stroke={a.color}
          />
        );
      })}
    </svg>
  );
}

function Seed({ seed, scale, selected, combineFrom, combineMode, busy, onActivate, onMoveBy }) {
  const drag = useRef(null);
  const size = Math.round(20 + Math.min((seed.text || "").length / 12, 26));

  function down(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
  }
  function move(e) {
    if (!drag.current) return;
    const dx = (e.clientX - drag.current.x) / scale;
    const dy = (e.clientY - drag.current.y) / scale;
    drag.current.x = e.clientX;
    drag.current.y = e.clientY;
    drag.current.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
    onMoveBy(dx, dy);
  }
  function up(e) {
    const d = drag.current;
    drag.current = null;
    if (d && d.moved < 4) onActivate();
  }

  const preview = (seed.text || "").trim().split("\n")[0].slice(0, 36);

  return (
    <div
      className={
        "seed" +
        (selected ? " selected" : "") +
        (combineFrom ? " combine-from" : "") +
        (combineMode ? " targetable" : "") +
        (busy ? " busy" : "")
      }
      style={{ left: seed.x, top: seed.y }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
    >
      <div
        className="seed-core"
        style={{
          width: size,
          height: size,
          "--glow": seed.color,
        }}
      />
      {preview && <div className="seed-label">{preview}</div>}
    </div>
  );
}

function SeedPanel({ seed, pos, flip, busy, onChange, onEvolve, onBranch, onSplit, onCombine, onDelete, onClose }) {
  const ref = useRef(null);
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
      <textarea
        ref={ref}
        autoFocus
        className="seed-input"
        value={seed.text}
        placeholder="speak the thought into being…"
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="seed-actions">
        <button className="orb-btn" onClick={onBranch} disabled={busy} title="Branch a new direction">
          branch
        </button>
        <button className="orb-btn" onClick={onEvolve} disabled={busy} title="Evolve this seed">
          evolve
        </button>
        <button className="orb-btn" onClick={onSplit} disabled={busy} title="Split into sub-ideas">
          split
        </button>
        <button className="orb-btn" onClick={onCombine} disabled={busy} title="Combine with another seed">
          combine
        </button>
      </div>
      <div className="seed-foot">
        <button className="ghost-btn" onClick={onDelete} title="Dissolve">
          dissolve
        </button>
        <button className="ghost-btn" onClick={onClose}>
          close
        </button>
      </div>
    </div>
  );
}
