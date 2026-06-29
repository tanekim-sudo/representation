import React, { useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY = "lens.symbols.v1";
const MAX_RESPONSES = 6;

const EMOJI_CHOICES = [
  "✨", "📝", "🔍", "🌍", "🎯", "💡", "🧹", "📌", "🔥", "🧠",
  "⚡", "🪄", "📖", "✂️", "🎨", "🧪", "🗜️", "💬", "🔧", "⭐",
];

const COLOR_CHOICES = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b",
  "#10b981", "#06b6d4", "#3b82f6", "#14b8a6", "#f43f5e",
];

const DEFAULT_SYMBOLS = [
  {
    id: "sym-summarize",
    name: "Summarize",
    emoji: "📝",
    color: "#6366f1",
    prompt: "Summarize the following text concisely while keeping the key points.",
  },
  {
    id: "sym-grammar",
    name: "Fix grammar",
    emoji: "🧹",
    color: "#10b981",
    prompt:
      "Fix the spelling and grammar of the following text. Return only the corrected text, with no commentary.",
  },
  {
    id: "sym-french",
    name: "To French",
    emoji: "🌍",
    color: "#06b6d4",
    prompt:
      "Translate the following text into natural, fluent French. Return only the translation.",
  },
  {
    id: "sym-eli5",
    name: "Explain simply",
    emoji: "💡",
    color: "#f59e0b",
    prompt: "Explain the following text in simple terms a 10-year-old could understand.",
  },
];

function loadSymbols() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SYMBOLS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_SYMBOLS;
  } catch {
    return DEFAULT_SYMBOLS;
  }
}

function uid() {
  return "sym-" + Math.random().toString(36).slice(2, 9);
}

export default function App() {
  const [symbols, setSymbols] = useState(loadSymbols);
  const [text, setText] = useState(
    "Paste or type any text here.\n\nThen drag a symbol from the left onto this box to transform it with Claude. Tip: select part of the text first to only transform that part."
  );
  const [results, setResults] = useState([]);
  const [responseCount, setResponseCount] = useState(1);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState(null); // symbol being edited or "new"
  const [theme, setTheme] = useState(() => localStorage.getItem("lens.theme") || "light");

  const textRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
  }, [symbols]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("lens.theme", theme);
  }, [theme]);

  const captureSelection = () => {
    const el = textRef.current;
    if (!el) return;
    selectionRef.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  const getTarget = () => {
    const { start, end } = selectionRef.current;
    if (end > start) {
      return { value: text.slice(start, end), start, end, isSelection: true };
    }
    return { value: text, start: 0, end: text.length, isSelection: false };
  };

  async function runSymbol(symbol) {
    const target = getTarget();
    if (!target.value.trim()) {
      pushResult({ symbol, error: "There's no text to work on. Type something first." });
      return;
    }
    const runId = uid();
    const count = responseCount;
    setBusy(true);
    pushResult({
      id: runId,
      symbol,
      input: target.value,
      isSelection: target.isSelection,
      selection: { start: target.start, end: target.end },
      count,
      loading: true,
    });

    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: symbol.prompt, text: target.value, count }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      updateResult(runId, { loading: false, outputs: data.outputs || [] });
    } catch (err) {
      updateResult(runId, { loading: false, error: err.message });
    } finally {
      setBusy(false);
    }
  }

  function pushResult(r) {
    setResults((prev) => [{ id: r.id || uid(), time: Date.now(), ...r }, ...prev]);
  }
  function updateResult(id, patch) {
    setResults((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function applyResult(r, output) {
    if (!output) return;
    if (r.isSelection && r.selection) {
      const { start, end } = r.selection;
      setText((t) => t.slice(0, start) + output + t.slice(end));
    } else {
      setText(output);
    }
  }

  // Drag and drop
  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const id = e.dataTransfer.getData("text/lens-symbol");
    const symbol = symbols.find((s) => s.id === id);
    if (symbol) runSymbol(symbol);
  }

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◎</span>
          <div>
            <h1>Lens</h1>
            <p>Drag a prompt symbol onto your text.</p>
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
            + New symbol
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className="palette">
          <h2>Symbols</h2>
          <p className="hint">Drag one onto the text →</p>
          <div className="symbol-list">
            {symbols.map((s) => (
              <SymbolChip
                key={s.id}
                symbol={s}
                onEdit={() => setEditing(s)}
                onRun={() => runSymbol(s)}
              />
            ))}
          </div>
        </aside>

        <section className="workspace">
          <div
            className={"text-card" + (dragOver ? " drag-over" : "")}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="card-head">
              <span>Your text</span>
              <div className="head-right">
                <div className="stepper" title="How many options Claude generates per run">
                  <span className="stepper-label">Responses</span>
                  <button
                    className="stepper-btn"
                    onClick={() => setResponseCount((c) => Math.max(1, c - 1))}
                    disabled={responseCount <= 1}
                  >
                    −
                  </button>
                  <span className="stepper-value">{responseCount}</span>
                  <button
                    className="stepper-btn"
                    onClick={() => setResponseCount((c) => Math.min(MAX_RESPONSES, c + 1))}
                    disabled={responseCount >= MAX_RESPONSES}
                  >
                    +
                  </button>
                </div>
                <span className="muted">{text.length} chars</span>
              </div>
            </div>
            <textarea
              ref={textRef}
              value={text}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
              onSelect={captureSelection}
              onKeyUp={captureSelection}
              onMouseUp={captureSelection}
              placeholder="Type or paste text here…"
            />
            {dragOver && <div className="drop-veil">Drop to apply this lens</div>}
          </div>

          <div className="results">
            <div className="card-head">
              <span>Results</span>
              {results.length > 0 && (
                <button className="btn ghost small" onClick={() => setResults([])}>
                  Clear
                </button>
              )}
            </div>
            {results.length === 0 && (
              <div className="empty">Results from dropped symbols show up here.</div>
            )}
            {results.map((r) => (
              <ResultCard key={r.id} result={r} onApply={(output) => applyResult(r, output)} />
            ))}
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
    image: null, // hand-drawn PNG data URL
    strokes: [], // vector strokes, so the drawing stays editable
    prompt: "",
    __isNew: true,
  };
}

function SymbolIcon({ symbol, size = 22 }) {
  if (symbol.image) {
    return (
      <img
        className="symbol-icon"
        src={symbol.image}
        alt={symbol.name || "symbol"}
        width={size}
        height={size}
        draggable={false}
      />
    );
  }
  return (
    <span className="symbol-icon emoji" style={{ fontSize: size * 0.9 }}>
      {symbol.emoji}
    </span>
  );
}

function SymbolChip({ symbol, onEdit, onRun }) {
  const ghostRef = useRef(null);
  return (
    <div
      className="symbol-chip"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lens-symbol", symbol.id);
        e.dataTransfer.effectAllowed = "copy";
        if (ghostRef.current) {
          e.dataTransfer.setDragImage(ghostRef.current, 28, 28);
        }
      }}
      style={{ "--accent": symbol.color }}
      title="Drag onto the text, or double-click to run on all text"
      onDoubleClick={onRun}
    >
      <span className="chip-icon" style={{ background: symbol.color + "22" }}>
        <SymbolIcon symbol={symbol} size={22} />
      </span>
      <span className="chip-name">{symbol.name || "Untitled"}</span>
      {/* Off-screen drag ghost showing the hand-drawn symbol */}
      <div className="drag-ghost" ref={ghostRef} style={{ "--accent": symbol.color }}>
        <SymbolIcon symbol={symbol} size={40} />
      </div>
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
    </div>
  );
}

function ResultCard({ result, onApply }) {
  const { symbol } = result;
  const outputs = result.outputs || [];
  const multi = outputs.length > 1;
  const [chosen, setChosen] = useState(null);
  const count = result.count || 1;

  return (
    <div className="result-card" style={{ "--accent": symbol.color }}>
      <div className="result-head">
        <span className="result-symbol">
          <SymbolIcon symbol={symbol} size={18} /> {symbol.name}
        </span>
        <span className="muted small">
          {result.isSelection ? "on selection" : "on full text"}
          {multi ? ` · ${outputs.length} options` : ""}
        </span>
      </div>

      {result.loading && (
        <div className="result-body loading">
          Thinking…{count > 1 ? ` generating ${count} options` : ""}
        </div>
      )}
      {result.error && <div className="result-body error">{result.error}</div>}

      {outputs.length > 0 && (
        <div className={"options" + (multi ? " grid" : "")}>
          {outputs.map((out, i) => (
            <OptionCard
              key={i}
              index={i}
              total={outputs.length}
              text={out}
              selected={chosen === i}
              onChoose={() => setChosen(i)}
              onApply={() => {
                setChosen(i);
                onApply(out);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OptionCard({ index, total, text, selected, onApply, onChoose }) {
  const [copied, setCopied] = useState(false);
  const multi = total > 1;
  return (
    <div
      className={"option" + (selected ? " selected" : "")}
      onClick={multi ? onChoose : undefined}
    >
      {multi && (
        <div className="option-head">
          <span className="option-num">Option {index + 1}</span>
          {selected && <span className="option-chosen">✓ chosen</span>}
        </div>
      )}
      <div className="result-body">{text}</div>
      <div className="result-actions">
        <button
          className="btn small"
          onClick={(e) => {
            e.stopPropagation();
            onApply();
          }}
        >
          {multi ? "Use this" : "Replace text"}
        </button>
        <button
          className="btn ghost small"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

const PEN_COLORS = ["#000000", "#ffffff", "#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#ef4444"];
const CANVAS_SIZE = 256;

function DrawPad({ initialStrokes = [], accent = "#6366f1", onChange }) {
  const canvasRef = useRef(null);
  const [strokes, setStrokes] = useState(() => initialStrokes || []);
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(8);
  const [erasing, setErasing] = useState(false);
  const drawingRef = useRef(null); // active stroke while pointer is down

  // Draw a single stroke onto a 2d context.
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
          <button
            className="btn ghost small"
            onClick={() => commit(strokes.slice(0, -1))}
            disabled={!strokes.length}
          >
            Undo
          </button>
          <button
            className="btn ghost small"
            onClick={() => commit([])}
            disabled={!strokes.length}
          >
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
        <h2>{symbol.__isNew ? "New symbol" : "Edit symbol"}</h2>

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
          <span>Draw your symbol</span>
          <DrawPad
            initialStrokes={draft.strokes}
            accent={draft.color}
            onChange={(image, strokes) => setDraft((d) => ({ ...d, image, strokes }))}
          />
          <small className="muted">
            Draw anything — it becomes this symbol's icon. Leave it blank to use the emoji below.
          </small>
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

        <label className="field">
          <span>Prompt</span>
          <textarea
            rows={5}
            value={draft.prompt}
            placeholder="Describe what Claude should do with the text…"
            onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
          />
          <small className="muted">
            The text you drop on gets attached automatically — just describe the action.
          </small>
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
