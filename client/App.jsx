import React, { useEffect, useRef, useState } from "react";

const SYMBOLS_KEY = "lens.symbols.v1";
const OBJECTS_KEY = "lens.objects.v1";
const CAMERA_KEY = "lens.camera.v1";
const THEME_KEY = "lens.theme";
const MAX_RESPONSES = 6;

const GRID = 26;
const NOTE_W = 268;
const SKETCH_W = 360;

const EMOJI_CHOICES = [
  "✨", "📝", "🔍", "🌍", "🎯", "💡", "🧹", "📌", "🔥", "🧠",
  "⚡", "🪄", "📖", "✂️", "🎨", "🧪", "🗜️", "💬", "🔧", "⭐",
];

const COLOR_CHOICES = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b",
  "#10b981", "#06b6d4", "#3b82f6", "#14b8a6", "#f43f5e",
];

const PEN_COLORS = ["#000000", "#ffffff", "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444"];
const CANVAS_SIZE = 256;

const DEFAULT_SYMBOLS = [
  {
    id: "sym-summarize",
    name: "Summarize",
    emoji: "📝",
    color: "#6366f1",
    prompt: "Summarize the following text concisely while keeping the key points.",
    count: 1,
  },
  {
    id: "sym-expand",
    name: "Expand",
    emoji: "🌱",
    color: "#10b981",
    prompt: "Expand this idea into a richer, more developed paragraph with concrete detail.",
    count: 2,
  },
  {
    id: "sym-remix",
    name: "Remix",
    emoji: "🪄",
    color: "#ec4899",
    prompt:
      "Riff on this idea and give a few surprising, creative variations or directions it could go.",
    count: 3,
  },
  {
    id: "sym-critique",
    name: "Critique",
    emoji: "🔍",
    color: "#f59e0b",
    prompt: "Critique this idea: what's weak, what's missing, and how could it be stronger?",
    count: 1,
  },
];

function uid() {
  return "id-" + Math.random().toString(36).slice(2, 9);
}

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSymbols() {
  const s = load(SYMBOLS_KEY, null);
  return Array.isArray(s) && s.length ? s : DEFAULT_SYMBOLS;
}

function loadObjects() {
  const o = load(OBJECTS_KEY, null);
  if (!Array.isArray(o)) {
    return [
      {
        id: uid(),
        type: "text",
        x: 60,
        y: 60,
        w: NOTE_W,
        text:
          "This is your field — an infinite canvas of half-formed ideas.\n\n• Double-click anywhere to drop a new thought.\n• Drag an operator from the left onto any card to transform it.\n• Add sketches, move things around, let ideas float.",
      },
    ];
  }
  // Clear any transient run state from a previous session.
  return o.map((obj) => ({ ...obj, loading: false, error: undefined }));
}

export default function App() {
  const [symbols, setSymbols] = useState(loadSymbols);
  const [objects, setObjects] = useState(loadObjects);
  const [camera, setCamera] = useState(() => load(CAMERA_KEY, { x: 0, y: 0, scale: 1 }));
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "light");
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);

  const viewportRef = useRef(null);
  const panRef = useRef(null);

  useEffect(() => localStorage.setItem(SYMBOLS_KEY, JSON.stringify(symbols)), [symbols]);
  useEffect(() => {
    const clean = objects.map((o) => ({ ...o, loading: false, error: undefined }));
    localStorage.setItem(OBJECTS_KEY, JSON.stringify(clean));
  }, [objects]);
  useEffect(() => localStorage.setItem(CAMERA_KEY, JSON.stringify(camera)), [camera]);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // ---- camera helpers ----
  function screenToWorld(sx, sy) {
    return { x: (sx - camera.x) / camera.scale, y: (sy - camera.y) / camera.scale };
  }
  function viewCenterWorld() {
    const r = viewportRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return screenToWorld(r.width / 2, r.height / 2);
  }

  // ---- panning ----
  function onViewportPointerDown(e) {
    // Only pan when the background itself is grabbed.
    if (e.target.closest(".note")) return;
    panRef.current = { x: e.clientX, y: e.clientY };
    viewportRef.current.setPointerCapture(e.pointerId);
  }
  function onViewportPointerMove(e) {
    if (!panRef.current) return;
    const dx = e.clientX - panRef.current.x;
    const dy = e.clientY - panRef.current.y;
    panRef.current = { x: e.clientX, y: e.clientY };
    setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
  }
  function onViewportPointerUp() {
    panRef.current = null;
  }

  function onWheel(e) {
    const r = viewportRef.current.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    setCamera((c) => {
      const factor = Math.exp(-e.deltaY * 0.0015);
      const scale = Math.min(2.5, Math.max(0.3, c.scale * factor));
      const wx = (sx - c.x) / c.scale;
      const wy = (sy - c.y) / c.scale;
      return { x: sx - wx * scale, y: sy - wy * scale, scale };
    });
  }

  function onBackgroundDoubleClick(e) {
    if (e.target.closest(".note")) return;
    const r = viewportRef.current.getBoundingClientRect();
    const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
    addText(w.x - NOTE_W / 2, w.y - 30);
  }

  // ---- objects ----
  function addText(x, y) {
    const c = viewCenterWorld();
    const obj = {
      id: uid(),
      type: "text",
      x: x ?? c.x - NOTE_W / 2,
      y: y ?? c.y - 30,
      w: NOTE_W,
      text: "",
    };
    setObjects((p) => [...p, obj]);
  }
  function addSketch() {
    const c = viewCenterWorld();
    setObjects((p) => [
      ...p,
      {
        id: uid(),
        type: "sketch",
        x: c.x - SKETCH_W / 2,
        y: c.y - 120,
        w: SKETCH_W,
        image: null,
        strokes: [],
        color: COLOR_CHOICES[Math.floor(Math.random() * COLOR_CHOICES.length)],
      },
    ]);
  }
  function updateObject(id, patch) {
    setObjects((p) => p.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  }
  function moveObjectBy(id, dxWorld, dyWorld) {
    setObjects((p) => p.map((o) => (o.id === id ? { ...o, x: o.x + dxWorld, y: o.y + dyWorld } : o)));
  }
  function removeObject(id) {
    setObjects((p) => p.filter((o) => o.id !== id));
  }

  // ---- run an operator on a note ----
  async function runOperator(opId, target) {
    const op = symbols.find((s) => s.id === opId);
    if (!op) return;
    const text = (target.text || "").trim();
    const n = Math.min(Math.max(op.count || 1, 1), MAX_RESPONSES);
    const startX = target.x + (target.w || NOTE_W) + 64;

    const placeholders = Array.from({ length: n }, (_, i) => ({
      id: uid(),
      type: "text",
      x: startX,
      y: target.y + i * 150,
      w: NOTE_W,
      text: "",
      loading: true,
      from: { name: op.name, color: op.color, image: op.image, emoji: op.emoji },
    }));
    setObjects((p) => [...p, ...placeholders]);
    setBusy(true);

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: op.prompt, text, count: n }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      const outs = data.outputs || [];
      setObjects((prev) => {
        const arr = [...prev];
        placeholders.forEach((ph, i) => {
          const idx = arr.findIndex((o) => o.id === ph.id);
          if (idx === -1) return;
          if (i < outs.length) arr[idx] = { ...arr[idx], loading: false, text: outs[i] };
          else arr.splice(idx, 1);
        });
        return arr;
      });
    } catch (err) {
      setObjects((prev) =>
        prev.map((o) =>
          placeholders.some((p) => p.id === o.id)
            ? { ...o, loading: false, error: err.message }
            : o
        )
      );
    } finally {
      setBusy(false);
    }
  }

  // ---- operators ----
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

  function resetView() {
    setCamera({ x: 0, y: 0, scale: 1 });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <div>
            <h1>Lens</h1>
            <p>A lab for your ideas — drag operators onto thoughts.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className="btn ghost theme-toggle"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
            title={theme === "light" ? "Switch to dark" : "Switch to light"}
          >
            {theme === "light" ? "☾" : "☀"}
          </button>
          <button className="btn primary" onClick={() => setEditing(makeBlankSymbol())}>
            + New operator
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="toolbox">
          <div className="toolbox-head">
            <h2>Operators</h2>
            <p className="hint">Your toolbox. Drag one onto an idea to transform it.</p>
          </div>
          <div className="operator-list">
            {symbols.map((s) => (
              <OperatorChip key={s.id} operator={s} onEdit={() => setEditing(s)} />
            ))}
          </div>
          <button className="btn ghost add-op" onClick={() => setEditing(makeBlankSymbol())}>
            + Form a new operator
          </button>
        </aside>

        <section className="field">
          <div
            className="viewport"
            ref={viewportRef}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={onViewportPointerUp}
            onPointerLeave={onViewportPointerUp}
            onWheel={onWheel}
            onDoubleClick={onBackgroundDoubleClick}
            style={{
              backgroundSize: `${GRID * camera.scale}px ${GRID * camera.scale}px`,
              backgroundPosition: `${camera.x}px ${camera.y}px`,
            }}
          >
            <div
              className="world"
              style={{
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
              }}
            >
              {objects.map((obj) => (
                <NoteCard
                  key={obj.id}
                  obj={obj}
                  scale={camera.scale}
                  isDropTarget={dropTarget === obj.id}
                  onMoveBy={(dx, dy) => moveObjectBy(obj.id, dx, dy)}
                  onChange={(patch) => updateObject(obj.id, patch)}
                  onRemove={() => removeObject(obj.id)}
                  onOperatorEnter={() => setDropTarget(obj.id)}
                  onOperatorLeave={() => setDropTarget((d) => (d === obj.id ? null : d))}
                  onRunOperator={(opId) => {
                    setDropTarget(null);
                    runOperator(opId, obj);
                  }}
                />
              ))}
            </div>

            {objects.length === 0 && (
              <div className="field-empty">
                Double-click anywhere to drop your first idea
              </div>
            )}

            <div className="field-toolbar">
              <button className="btn small" onClick={() => addText()}>
                + Note
              </button>
              <button className="btn small" onClick={addSketch}>
                + Sketch
              </button>
            </div>

            <div className="field-zoom">
              <button
                className="btn ghost small"
                onClick={() =>
                  setCamera((c) => ({ ...c, scale: Math.max(0.3, c.scale - 0.15) }))
                }
              >
                −
              </button>
              <button className="btn ghost small" onClick={resetView}>
                {Math.round(camera.scale * 100)}%
              </button>
              <button
                className="btn ghost small"
                onClick={() =>
                  setCamera((c) => ({ ...c, scale: Math.min(2.5, c.scale + 0.15) }))
                }
              >
                +
              </button>
            </div>
          </div>
        </section>
      </main>

      {editing && (
        <SymbolEditor
          symbol={editing}
          onSave={saveSymbol}
          onDelete={editing.id && symbols.some((s) => s.id === editing.id) ? deleteSymbol : null}
          onClose={() => setEditing(null)}
        />
      )}

      {busy && <div className="busybar" />}
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
      title="Drag onto an idea in the field"
    >
      <span className="chip-icon">
        <SymbolIcon symbol={operator} size={22} />
      </span>
      <span className="chip-name">{operator.name || "Untitled"}</span>
      {operator.count > 1 && <span className="chip-count">×{operator.count}</span>}
      <button
        className="chip-edit"
        onClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
        title="Edit operator"
      >
        ⚙
      </button>
      <div className="drag-ghost" ref={ghostRef} style={{ "--accent": operator.color }}>
        <SymbolIcon symbol={operator} size={40} />
      </div>
    </div>
  );
}

function AutoTextarea({ value, onChange, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, [value]);
  return <textarea ref={ref} value={value} onChange={onChange} {...rest} />;
}

function NoteCard({
  obj,
  scale,
  isDropTarget,
  onMoveBy,
  onChange,
  onRemove,
  onRunOperator,
  onOperatorEnter,
  onOperatorLeave,
}) {
  const last = useRef(null);
  const accent = obj.from?.color || obj.color;

  function onHandleDown(e) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = { x: e.clientX, y: e.clientY };
  }
  function onHandleMove(e) {
    if (!last.current) return;
    const dx = (e.clientX - last.current.x) / scale;
    const dy = (e.clientY - last.current.y) / scale;
    last.current = { x: e.clientX, y: e.clientY };
    onMoveBy(dx, dy);
  }
  function onHandleUp() {
    last.current = null;
  }

  return (
    <div
      className={"note" + (isDropTarget ? " drop-target" : "") + (obj.from ? " result" : "")}
      style={{ left: obj.x, top: obj.y, width: obj.w, "--accent": accent || "var(--border)" }}
      onDragOver={(e) => {
        e.preventDefault();
        onOperatorEnter();
      }}
      onDragLeave={onOperatorLeave}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData("text/lens-operator");
        if (id) onRunOperator(id);
      }}
    >
      <div
        className="note-handle"
        onPointerDown={onHandleDown}
        onPointerMove={onHandleMove}
        onPointerUp={onHandleUp}
        onPointerLeave={onHandleUp}
      >
        {obj.from ? (
          <span className="note-from">
            <SymbolIcon symbol={obj.from} size={15} /> {obj.from.name}
          </span>
        ) : (
          <span className="note-grip">⋮⋮</span>
        )}
        <button
          className="note-close"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onRemove}
          title="Delete"
        >
          ×
        </button>
      </div>

      {obj.type === "sketch" ? (
        <div className="note-body sketch" onPointerDown={(e) => e.stopPropagation()}>
          <DrawPad
            initialStrokes={obj.strokes}
            accent={accent}
            onChange={(image, strokes) => onChange({ image, strokes })}
          />
        </div>
      ) : obj.loading ? (
        <div className="note-body note-loading">Thinking…</div>
      ) : obj.error ? (
        <div className="note-body note-error">{obj.error}</div>
      ) : (
        <AutoTextarea
          className="note-body note-text"
          value={obj.text}
          placeholder="an idea…"
          onPointerDown={(e) => e.stopPropagation()}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      )}
    </div>
  );
}

function DrawPad({ initialStrokes = [], accent = "#6366f1", onChange }) {
  const canvasRef = useRef(null);
  const [strokes, setStrokes] = useState(() => initialStrokes || []);
  const [color, setColor] = useState("#000000");
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
              title={c}
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
          <button
            className={"btn ghost small" + (erasing ? " active" : "")}
            onClick={() => setErasing((v) => !v)}
          >
            {erasing ? "Erasing" : "Eraser"}
          </button>
          <input
            className="size-slider"
            type="range"
            min="2"
            max="40"
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            title="Brush size"
          />
          <button className="btn ghost small" onClick={() => commit(strokes.slice(0, -1))} disabled={!strokes.length}>
            Undo
          </button>
          <button className="btn ghost small" onClick={() => commit([])} disabled={!strokes.length}>
            Clear
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
        <h2>{symbol.__isNew ? "Form a new operator" : "Edit operator"}</h2>

        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={draft.name}
            placeholder="e.g. Make formal"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>

        <div className="field">
          <span>Draw its glyph</span>
          <DrawPad
            initialStrokes={draft.strokes}
            accent={draft.color}
            onChange={(image, strokes) => setDraft((d) => ({ ...d, image, strokes }))}
          />
          <small className="muted">Draw the operator's mark, or leave blank to use the emoji below.</small>
        </div>

        <div className="field-row">
          <div className="field">
            <span>Accent color</span>
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
            <span>Emoji fallback</span>
            <div className="emoji-grid small">
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
          <span>Responses per run</span>
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
            <span className="muted small">Spawns this many idea-cards each run.</span>
          </div>
        </div>

        <label className="field">
          <span>Prompt</span>
          <textarea
            rows={4}
            value={draft.prompt}
            placeholder="Describe what this operator does to an idea…"
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
          <small className="muted">The idea you drop it on is attached automatically.</small>
        </label>

        <div className="modal-actions">
          {onDelete && (
            <button
              className="btn danger ghost"
              onClick={() => {
                onDelete(symbol.id);
                onClose();
              }}
            >
              Delete
            </button>
          )}
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!valid}
            onClick={() => {
              const { __isNew, ...clean } = draft;
              onSave(clean);
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
