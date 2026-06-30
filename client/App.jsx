import React, { useEffect, useMemo, useRef, useState } from "react";

const ARTIFACT_KEY = "lens.artifact.v1";
const OPERATORS_KEY = "lens.board.operators.v1";
const ONBOARDED_KEY = "lens.onboarded.v1";

const DEFAULT_OPERATORS = [
  { id: "op-sharpen", name: "sharpen", kind: "prompt", prompt: "Rewrite this more sharply and precisely, preserving the meaning. Return only the rewritten text." },
  { id: "op-expand", name: "expand", kind: "prompt", prompt: "Expand this idea with depth, specifics and a fresh angle. Return only the expanded text." },
  { id: "op-counter", name: "counter", kind: "prompt", prompt: "Give the single strongest counter-argument or opposing view to this. Return only that argument." },
  { id: "op-simplify", name: "simplify", kind: "prompt", prompt: "Explain this as simply and concretely as possible, like to a smart friend. Return only the explanation." },
];

const ROLES = ["investor", "founder", "tutor", "artist", "researcher", "writer", "designer", "therapist", "student", "strategist"];

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function parseJSON(raw) {
  let s = (raw || "").trim();
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1) s = s.slice(a, b + 1);
  return JSON.parse(s);
}

const LENS_SYSTEM = `You are the function-architect for "lens", a thinking lab where a person works on ONE artifact at a time.

HOW LENS WORKS:
- The lab bench holds a single thread — one living artifact. The user inserts text, images, and ideas into it, then applies TRANSFORMATIONS from their toolbox.
- A FUNCTION is a composition of smaller functions down to PRIMITIVE OPERATORS. Pipelines chain steps: each output feeds the next.
- A PRIMITIVE is a leaf with a precise "prompt" that transforms input text and returns ONLY the result.
- The user highlights part of the artifact (or applies to the whole thread), picks a transformation, and the result goes back into the artifact.
- Functions comprise functions. Every layer must be legible; every leaf must be a reusable, expert-grade prompt.

YOUR STANDARDS:
- TRUE USEFULNESS for this person's real workflow. No generic fluff.
- DECOMPOSE TO PRIMITIVES — one clear thing per leaf.
- MAX-STRENGTH PROMPTS tailored to the user's personal library.
- OUTPUT: ONLY valid JSON, no markdown fences.`;

function summarizeLibrary(operators, opMap, { compact = false } = {}) {
  if (!operators?.length) return "";
  const tops = operators.filter((o) => o.top);
  const lines = [];
  if (tops.length) {
    lines.push(compact ? "Functions:" : "Top-level functions:");
    for (const t of tops.slice(0, compact ? 10 : 20)) {
      let line = `• ${t.name}${t.description ? ` — ${t.description}` : ""}`;
      if (!compact && t.kind === "pipeline" && t.steps?.length) {
        lines.push(`${line}\n  steps: ${t.steps.map((id) => opMap[id]?.name).filter(Boolean).join(" → ")}`);
      } else lines.push(line);
    }
  }
  const leaves = operators.filter((o) => (o.kind === "prompt" || !o.kind) && o.prompt);
  if (leaves.length && !compact) {
    lines.push("\nPrimitive patterns:");
    for (const p of leaves.slice(0, 30)) {
      lines.push(`• "${p.name}": ${p.prompt.slice(0, 110)}${p.prompt.length > 110 ? "…" : ""}`);
    }
  } else if (leaves.length && compact) {
    lines.push(`Primitives: ${leaves.map((p) => p.name).slice(0, 24).join(", ")}`);
  }
  return lines.join("\n");
}

function librarySystem(operators, opMap) {
  const summary = summarizeLibrary(operators, opMap);
  if (!summary) return LENS_SYSTEM;
  return `${LENS_SYSTEM}\n\n---\nTHE USER'S PERSONAL LIBRARY — tailor everything to this:\n${summary}`;
}

function executionSystem(operators, opMap, activeOp) {
  const compact = summarizeLibrary(operators, opMap, { compact: true });
  let sys = "You transform material in a thinking lab. Return ONLY the result.";
  if (activeOp?.name) sys += `\nActive transform: "${activeOp.name}"${activeOp.description ? ` — ${activeOp.description}` : ""}.`;
  if (compact) sys += `\n\nUser's library (match their style):\n${compact}`;
  return sys;
}

function labSystem(operators, opMap) {
  const compact = summarizeLibrary(operators, opMap, { compact: true });
  let sys = "You operate on the user's lab artifact. Return ONLY the requested result.";
  if (compact) sys += `\n\nUser's library:\n${compact}`;
  return sys;
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

async function generateFunctionList(role, operators, opMap) {
  const hasLib = operators?.length > 0;
  const prompt = `The user is a: ${role}. Design 10 FUNCTIONS for their lens lab — high-leverage transformations on a single working artifact.
${hasLib ? "Complement their existing library; do not duplicate.\n" : ""}
Return ONLY JSON: {"functions":[{"name":"2-4 words","description":"one sentence"}]} — exactly 10, ordered by frequency.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 2000 });
  const j = parseJSON(out);
  return Array.isArray(j.functions) ? j.functions.slice(0, 10) : [];
}

async function decomposeFunction(role, fn, operators, opMap) {
  const prompt = `User is a: ${role}. Decompose this function into a tree ending in primitive operators (pipeline execution).

FUNCTION: ${fn.name} — ${fn.description}

Return ONLY JSON: {"name":"...","description":"...","steps":[{"name":"...","description":"...","steps":[...] OR "prompt":"..."}]}`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 6000 });
  return parseJSON(out);
}

function materializeTree(node, role, top, out) {
  const id = uid();
  const name = (node.name || "function").trim();
  const description = (node.description || "").trim();
  if (Array.isArray(node.steps) && node.steps.length) {
    const steps = node.steps.map((s) => materializeTree(s, role, false, out));
    out.push({ id, name, description, kind: "pipeline", steps, role, top });
  } else {
    const prompt = (node.prompt || "").trim() || `Apply "${name}" to the input and return only the result.`;
    out.push({ id, name, description, kind: "prompt", prompt, role, top });
  }
  return id;
}

function serializeTree(node, opMap, depth = 0) {
  if (!node) return "";
  const pad = "  ".repeat(depth);
  let line = `${pad}• ${node.name}${node.description ? ` — ${node.description}` : ""}`;
  if (node.kind === "prompt" && node.prompt) line += `\n${pad}  prompt: ${node.prompt.slice(0, 220)}`;
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

async function createFunctionFromProse(description, operators, opMap) {
  const prompt = `CREATE a new lab transformation from the user's description:\n"""\n${description}\n"""\n\nReturn ONLY JSON with full decomposition to primitives.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 6000 });
  return parseJSON(out);
}

async function editFunctionWithProse(op, opMap, instruction, operators) {
  const prompt = `EDIT this function:\n${serializeTree(op, opMap)}\n\nUser wants:\n"""\n${instruction}\n"""\n\nReturn ONLY JSON for the complete updated function.`;
  const out = await runClaude(prompt, "", { system: librarySystem(operators, opMap), maxTokens: 6000 });
  return parseJSON(out);
}

function treeToOperators(node, opts = {}) {
  const out = [];
  materializeTree(node, opts.role || null, opts.top || false, out);
  return { ops: out };
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
        resolve({ src: canvas.toDataURL(file.type === "image/png" ? "image/png" : "image/jpeg", 0.86), w, h });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function migrateToArtifact() {
  const old = load("lens.board.items.v1", null);
  if (!Array.isArray(old) || !old.length) return { title: "", text: "", objects: [] };
  const texts = old.filter((i) => i.type === "text" && i.text?.trim()).map((i) => i.text.trim());
  const images = old
    .filter((i) => i.type === "image" && i.src)
    .map((i) => ({ id: uid(), kind: "image", label: "image", src: i.src, w: i.w || 220 }));
  return {
    title: texts[0]?.slice(0, 48) || "",
    text: texts.join("\n\n———\n\n"),
    objects: images,
  };
}

function descriptorOf(text) {
  const line = (text || "").split("\n").find((l) => l.trim()) || "";
  if (!line) return "new thread";
  return line.length > 48 ? line.slice(0, 46).trimEnd() + "…" : line;
}

// ---- main app: one artifact, lab bench, transformation rail ----
export default function App() {
  const [artifact, setArtifact] = useState(() => load(ARTIFACT_KEY, null) || migrateToArtifact());
  const [operators, setOperators] = useState(() => {
    const s = load(OPERATORS_KEY, null);
    return Array.isArray(s) ? s : DEFAULT_OPERATORS;
  });

  const [highlight, setHighlight] = useState(null); // { text, rect }
  const [selectedObjects, setSelectedObjects] = useState([]); // object ids for multi-ops
  const [aiBusy, setAiBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [opEditor, setOpEditor] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [onboard, setOnboard] = useState(() => (localStorage.getItem(ONBOARDED_KEY) ? null : { step: "role" }));
  const [insertText, setInsertText] = useState("");

  const bodyRef = useRef(null);
  const fileInputRef = useRef(null);
  const artifactRef = useRef(artifact);
  const skipBodySync = useRef(false);
  artifactRef.current = artifact;

  useEffect(() => localStorage.setItem(ARTIFACT_KEY, JSON.stringify(artifact)), [artifact]);
  useEffect(() => localStorage.setItem(OPERATORS_KEY, JSON.stringify(operators)), [operators]);

  // sync DOM when artifact.text changes externally (transform, drop, etc.)
  useEffect(() => {
    if (skipBodySync.current) {
      skipBodySync.current = false;
      return;
    }
    const el = bodyRef.current;
    if (el && el.innerText !== artifact.text) {
      el.innerHTML = escapeHtml(artifact.text);
    }
  }, [artifact.text]);

  const opMap = useMemo(() => Object.fromEntries(operators.map((o) => [o.id, o])), [operators]);
  const topFunctions = useMemo(() => {
    const tops = operators.filter((o) => o.top);
    if (tops.length) return tops;
    const childIds = new Set();
    for (const o of operators) o.steps?.forEach((id) => childIds.add(id));
    return operators.filter((o) => o.role && !childIds.has(o.id));
  }, [operators]);
  const basics = operators.filter((o) => !o.role && !o.top);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast((t) => (t === msg ? null : t)), 3200);
  }

  function syncBodyFromDom() {
    const el = bodyRef.current;
    if (!el) return;
    skipBodySync.current = true;
    const text = el.innerText || "";
    setArtifact((a) => ({ ...a, text, title: a.title || descriptorOf(text) }));
  }

  // capture text selection in the artifact
  useEffect(() => {
    function capture() {
      const sel = window.getSelection();
      const text = sel && !sel.isCollapsed ? sel.toString().trim() : "";
      if (!text || text.length < 2 || !sel.rangeCount) {
        setHighlight(null);
        return;
      }
      const range = sel.getRangeAt(0);
      let node = range.startContainer;
      if (node.nodeType === 3) node = node.parentElement;
      if (!node?.closest?.("[data-artifact-body]")) {
        setHighlight(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setHighlight({ text, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
    }
    function onUp(e) {
      if (e.target.closest?.(".palette")) return;
      setTimeout(capture, 0);
    }
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  async function applyOpTree(op, material, image) {
    if (!op) return material;
    if (op.kind === "pipeline" && op.steps?.length) {
      let cur = material;
      let img = image;
      for (const sid of op.steps) {
        cur = await applyOpTree(opMap[sid], cur, img);
        img = null;
      }
      return cur;
    }
    return await runClaude(op.prompt || "", material, { image, system: executionSystem(operators, opMap, op) });
  }

  function replaceInArtifact(result, scope) {
    const clean = (result || "").trim();
    if (!clean) return;
    if (scope === "selection" && highlight?.text) {
      const el = bodyRef.current;
      if (el) {
        const full = el.innerText || "";
        const idx = full.indexOf(highlight.text);
        if (idx >= 0) {
          skipBodySync.current = true;
          setArtifact((a) => ({
            ...a,
            text: full.slice(0, idx) + clean + full.slice(idx + highlight.text.length),
          }));
          setHighlight(null);
          window.getSelection()?.removeAllRanges();
          return;
        }
      }
    }
    skipBodySync.current = true;
    setArtifact((a) => ({ ...a, text: clean }));
    setHighlight(null);
  }

  function materialForTransform() {
    if (highlight?.text) return { text: highlight.text, scope: "selection", image: null };
    const selObjs = artifact.objects.filter((o) => selectedObjects.includes(o.id));
    if (selObjs.length) {
      const text = selObjs
        .filter((o) => o.kind === "text")
        .map((o) => o.content)
        .join("\n\n———\n\n");
      const img = selObjs.find((o) => o.kind === "image")?.src || null;
      if (text || img) return { text, scope: "objects", image: img };
    }
    return { text: artifact.text, scope: "whole", image: null };
  }

  async function runTransform(op) {
    const { text, scope, image } = materialForTransform();
    if (!text?.trim() && !image) {
      showToast("add something to the artifact first, or highlight text");
      return;
    }
    setAiBusy(true);
    try {
      const out = await applyOpTree(op, text, image);
      if (scope === "objects") {
        appendToThread(out);
      } else {
        replaceInArtifact(out, scope);
      }
      showToast(`applied · ${op.name}`);
    } catch (err) {
      showToast(err.message || "transform failed");
    } finally {
      setAiBusy(false);
    }
  }

  async function runLabPrompt(prompt, { append = false } = {}) {
    const { text, image } = materialForTransform();
    if (!text?.trim() && !image) {
      showToast("nothing to work on");
      return;
    }
    setAiBusy(true);
    try {
      const out = await runClaude(prompt, text, { image, system: labSystem(operators, opMap) });
      if (append) appendToThread(out);
      else replaceInArtifact(out, highlight?.text ? "selection" : "whole");
    } catch (err) {
      showToast(err.message || "failed");
    } finally {
      setAiBusy(false);
    }
  }

  function appendToThread(chunk) {
    const clean = (chunk || "").trim();
    if (!clean) return;
    skipBodySync.current = true;
    setArtifact((a) => ({
      ...a,
      text: a.text.trim() ? a.text.trimEnd() + "\n\n" + clean : clean,
      title: a.title || descriptorOf(clean),
    }));
  }

  function insertObject(obj) {
    setArtifact((a) => ({ ...a, objects: [...a.objects, obj] }));
  }

  function dropIntoThread(id) {
    const obj = artifact.objects.find((o) => o.id === id);
    if (!obj) return;
    if (obj.kind === "text") appendToThread(obj.content);
    else appendToThread(`[image: ${obj.label}]`);
    setArtifact((a) => ({ ...a, objects: a.objects.filter((o) => o.id !== id) }));
    showToast("dropped into thread");
  }

  async function addImageFile(file) {
    try {
      const { src, w } = await fileToImage(file);
      insertObject({ id: uid(), kind: "image", label: file.name?.slice(0, 24) || "image", src, w: Math.min(w, 280) });
      showToast("object added — drop into thread or select + transform");
    } catch {
      showToast("could not load image");
    }
  }

  function newThread() {
    if (artifact.text.trim() || artifact.objects.length) {
      if (!confirm("Start a fresh thread? Current artifact will be cleared.")) return;
    }
    setArtifact({ title: "", text: "", objects: [] });
    setHighlight(null);
    setSelectedObjects([]);
  }

  async function runOnboarding(role) {
    setOnboard({ step: "working", role, done: 0, total: 10 });
    try {
      const list = await generateFunctionList(role, operators, opMap);
      if (!list.length) throw new Error("Could not build functions.");
      setOnboard((o) => ({ ...o, total: list.length }));
      let done = 0;
      const trees = await Promise.all(
        list.map(async (fn) => {
          let tree;
          try {
            tree = await decomposeFunction(role, fn, operators, opMap);
          } catch {
            tree = { name: fn.name, description: fn.description, prompt: `Apply "${fn.name}" and return only the result.` };
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
      setOnboard({ step: "error", message: err.message });
    }
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
    showToast("function saved");
  }

  function saveManualOp(op) {
    setOperators((arr) => {
      const exists = arr.some((o) => o.id === op.id);
      return exists ? arr.map((o) => (o.id === op.id ? op : o)) : [...arr, op];
    });
    setOpEditor(null);
  }

  function deleteFunction(rootId) {
    const map = Object.fromEntries(operators.map((o) => [o.id, o]));
    setOperators((arr) => arr.filter((o) => !collectSubtreeIds(rootId, map).has(o.id)));
    setOpEditor(null);
  }

  // paste / drop globally into lab
  useEffect(() => {
    function onPaste(e) {
      const items = e.clipboardData?.items || [];
      for (const it of items) {
        if (it.type?.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            addImageFile(f);
            return;
          }
        }
      }
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (text && !document.activeElement?.closest?.("[data-artifact-body]")) {
        e.preventDefault();
        insertObject({ id: uid(), kind: "text", label: descriptorOf(text), content: text });
        showToast("pasted as object — drop into thread or transform");
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  const palettePos = highlight
    ? { left: highlight.rect.left + highlight.rect.width / 2, top: highlight.rect.top - 8 }
    : null;

  return (
    <div className="lab-app">
      {/* left rail: transformations */}
      <aside className="lab-rail">
        <div className="rail-head">
          <div className="rail-title">Transformations</div>
          <div className="rail-sub">{topFunctions.length ? `${topFunctions.length} functions` : "build your lab"}</div>
          <button className="rail-icon" title="set up for role" onClick={() => setOnboard({ step: "role" })}>
            ↻
          </button>
        </div>

        <button className="rail-create" onClick={() => setOpEditor({ mode: "create" })}>
          + create function
        </button>

        <div className="rail-scroll">
          {topFunctions.length ? (
            topFunctions.map((op) => (
              <FunctionCard
                key={op.id}
                op={op}
                opMap={opMap}
                expanded={expanded}
                onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                onApply={() => runTransform(op)}
                onEdit={() => setOpEditor({ mode: "edit", op })}
                busy={aiBusy}
              />
            ))
          ) : (
            <p className="rail-empty">Tap ↻ to generate 10 functions for your role.</p>
          )}

          {basics.length > 0 && (
            <>
              <div className="rail-section">basics</div>
              {basics.map((op) => (
                <FunctionCard
                  key={op.id}
                  op={op}
                  opMap={opMap}
                  expanded={expanded}
                  onToggle={(id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))}
                  onApply={() => runTransform(op)}
                  onEdit={() => setOpEditor({ mode: "edit", op })}
                  busy={aiBusy}
                />
              ))}
            </>
          )}
        </div>

        {(highlight || selectedObjects.length > 0) && (
          <div className="rail-hint">
            {highlight ? "highlight active" : `${selectedObjects.length} object${selectedObjects.length > 1 ? "s" : ""} selected`}
          </div>
        )}
      </aside>

      {/* center: the one artifact */}
      <main className="lab-bench">
        <header className="bench-head">
          <input
            className="thread-title"
            placeholder="thread name…"
            value={artifact.title}
            onChange={(e) => setArtifact((a) => ({ ...a, title: e.target.value }))}
          />
          <div className="bench-actions">
            <button className="bench-btn" onClick={newThread} title="new thread">
              new thread
            </button>
          </div>
        </header>

        <div
          className="artifact-vessel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) addImageFile(e.dataTransfer.files[0]);
          }}
        >
          <div
            ref={bodyRef}
            className="artifact-body"
            data-artifact-body
            contentEditable
            suppressContentEditableWarning
            onInput={syncBodyFromDom}
            onBlur={syncBodyFromDom}
          />
          {!artifact.text.trim() && (
            <div className="artifact-placeholder">your thread lives here — type, paste, or drop objects in</div>
          )}
        </div>

        {/* objects on the bench (not yet in thread) */}
        {artifact.objects.length > 0 && (
          <div className="objects-tray">
            <div className="tray-label">objects on the bench</div>
            <div className="objects-row">
              {artifact.objects.map((obj) => (
                <ObjectChip
                  key={obj.id}
                  obj={obj}
                  selected={selectedObjects.includes(obj.id)}
                  onSelect={() =>
                    setSelectedObjects((ids) =>
                      ids.includes(obj.id) ? ids.filter((x) => x !== obj.id) : [...ids, obj.id]
                    )
                  }
                  onDropIn={() => dropIntoThread(obj.id)}
                  onRemove={() => setArtifact((a) => ({ ...a, objects: a.objects.filter((o) => o.id !== obj.id) }))}
                />
              ))}
            </div>
          </div>
        )}

        {/* insert bar */}
        <div className="insert-bar">
          <input
            className="insert-input"
            placeholder="insert text, idea, fragment…"
            value={insertText}
            onChange={(e) => setInsertText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && insertText.trim()) {
                insertObject({ id: uid(), kind: "text", label: descriptorOf(insertText), content: insertText.trim() });
                setInsertText("");
                showToast("object added");
              }
            }}
          />
          <button
            className="insert-btn"
            disabled={!insertText.trim()}
            onClick={() => {
              insertObject({ id: uid(), kind: "text", label: descriptorOf(insertText), content: insertText.trim() });
              setInsertText("");
            }}
          >
            add
          </button>
          <button className="insert-btn" onClick={() => fileInputRef.current?.click()}>
            image
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && addImageFile(e.target.files[0])} />
        </div>

        {aiBusy && (
          <div className="lab-working">
            <span className="spinner" /> transforming…
          </div>
        )}
      </main>

      {palettePos && (
        <LabPalette
          pos={palettePos}
          busy={aiBusy}
          onTransform={() => runLabPrompt("Transform the highlighted material. Return only the result.")}
          onAsk={(q) => runLabPrompt(`Answer about this material:\n${q}`)}
          onSplit={() => runLabPrompt("Split into distinct sub-ideas, one per line, no numbering.", { append: true })}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      {onboard && <Onboarding state={onboard} onStart={runOnboarding} onSkip={() => { localStorage.setItem(ONBOARDED_KEY, "1"); setOnboard(null); }} onClose={() => setOnboard(null)} />}
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

function ObjectChip({ obj, selected, onSelect, onDropIn, onRemove }) {
  return (
    <div className={"object-chip" + (selected ? " sel" : "")}>
      <button className="chip-body" onClick={onSelect} title="select for transform">
        <span className="chip-ring" />
        <span className="chip-label">{obj.label}</span>
      </button>
      <button className="chip-drop" onClick={onDropIn} title="drop into thread">
        ↓
      </button>
      <button className="chip-x" onClick={onRemove}>
        ×
      </button>
      {obj.kind === "image" && <img className="chip-preview" src={obj.src} alt="" />}
    </div>
  );
}

function FunctionCard({ op, opMap, expanded, onToggle, onApply, onEdit, busy }) {
  const steps = op.kind === "pipeline" && op.steps ? op.steps.map((id) => opMap[id]).filter(Boolean) : [];
  return (
    <div className="fn-card">
      <div className="fn-card-row">
        <button className="fn-card-apply" disabled={busy} onClick={onApply}>
          <span className="fn-card-name">{op.name}</span>
          {op.description && <span className="fn-card-desc">{op.description}</span>}
        </button>
        {steps.length > 0 && (
          <button className="fn-card-toggle" onClick={() => onToggle(op.id)}>
            {expanded[op.id] ? "▾" : "▸"}
          </button>
        )}
        <button className="fn-card-edit" onClick={onEdit}>
          ⚙
        </button>
      </div>
      {expanded[op.id] && steps.length > 0 && (
        <div className="fn-card-steps">
          {steps.map((s) => (
            <div key={s.id} className="fn-step">
              <span className="fn-step-name">{s.name}</span>
              {s.description && <span className="fn-step-desc">{s.description}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LabPalette({ pos, busy, onTransform, onAsk, onSplit }) {
  const [mode, setMode] = useState(null);
  const [q, setQ] = useState("");
  const style = { left: clamp(pos.left, 100, window.innerWidth - 100), top: Math.max(60, pos.top) };

  if (busy) return <div className="palette busy" style={style}><span className="spinner" /> working…</div>;

  if (mode === "ask") {
    return (
      <div className="palette" style={style}>
        <input autoFocus className="palette-input" placeholder="ask about this…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { onAsk(q.trim()); setMode(null); } }} />
        <button className="p-btn" onClick={() => setMode(null)}>←</button>
      </div>
    );
  }

  return (
    <div className="palette" style={style}>
      <button className="p-btn" onClick={onTransform}>transform</button>
      <button className="p-btn" onClick={onSplit}>split out</button>
      <button className="p-btn" onClick={() => setMode("ask")}>ask</button>
    </div>
  );
}

function escapeHtml(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

function Onboarding({ state, onStart, onSkip, onClose }) {
  const [custom, setCustom] = useState("");
  if (state.step === "role") {
    return (
      <div className="onboard-scrim">
        <div className="onboard">
          <div className="onboard-mark">lens</div>
          <h2>What do you do?</h2>
          <p className="onboard-sub">I'll build transformations for your lab — functions composed of smaller functions, tuned to how you work.</p>
          <div className="role-grid">{ROLES.map((r) => <button key={r} className="role-btn" onClick={() => onStart(r)}>{r}</button>)}</div>
          <div className="onboard-custom">
            <input placeholder="or type your profession…" value={custom} onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && custom.trim() && onStart(custom.trim())} />
            <button disabled={!custom.trim()} onClick={() => custom.trim() && onStart(custom.trim())}>build</button>
          </div>
          <button className="onboard-skip" onClick={onSkip}>skip</button>
        </div>
      </div>
    );
  }
  if (state.step === "working") {
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0;
    return (
      <div className="onboard-scrim">
        <div className="onboard">
          <h2>Building your lab</h2>
          <p className="onboard-sub">designing {state.total} transformations for {state.role}…</p>
          <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
          <div className="progress-label">{state.done}/{state.total}</div>
        </div>
      </div>
    );
  }
  if (state.step === "done") {
    return (
      <div className="onboard-scrim">
        <div className="onboard">
          <h2>Lab ready</h2>
          <p className="onboard-sub">{state.count} functions are in the left rail. Add material to your thread, highlight, and apply a transformation.</p>
          <button className="onboard-go" onClick={onClose}>start experimenting</button>
        </div>
      </div>
    );
  }
  return (
    <div className="onboard-scrim">
      <div className="onboard">
        <h2>Something went wrong</h2>
        <p className="onboard-sub">{state.message}</p>
        <button className="onboard-go" onClick={() => onStart("founder")}>retry</button>
      </div>
    </div>
  );
}

function FunctionEditor({ editor, opMap, operators, onClose, onSaveTree, onSaveManual, onDelete }) {
  const isCreate = editor.mode === "create";
  const op = editor.op || null;
  const isPipeline = op?.kind === "pipeline";
  const [tab, setTab] = useState("describe");
  const [prose, setProse] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [name, setName] = useState(op?.name || "");
  const [description, setDescription] = useState(op?.description || "");
  const [prompt, setPrompt] = useState(op?.prompt || "");

  async function runDescribe() {
    if (!prose.trim()) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const tree = isCreate
        ? await createFunctionFromProse(prose.trim(), operators, opMap)
        : await editFunctionWithProse(op, opMap, prose.trim(), operators);
      setPreview(tree);
      setName(tree.name || name);
      setDescription(tree.description || description);
      if (tree.prompt) setPrompt(tree.prompt);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="fn-editor" onClick={(e) => e.stopPropagation()}>
        <div className="fn-head">
          <h3>{isCreate ? "create function" : "edit function"}</h3>
          <button className="fn-close" onClick={onClose}>×</button>
        </div>
        <div className="fn-tabs">
          <button className={"fn-tab" + (tab === "describe" ? " on" : "")} onClick={() => setTab("describe")}>describe</button>
          <button className={"fn-tab" + (tab === "manual" ? " on" : "")} onClick={() => setTab("manual")}>manual</button>
        </div>
        {tab === "describe" ? (
          <div className="fn-pane">
            <p className="fn-hint">{isCreate ? "Describe the transformation in plain English." : "Say what to change."}</p>
            {!isCreate && op && <pre className="fn-current">{serializeTree(op, opMap)}</pre>}
            <textarea className="fn-prose" rows={4} autoFocus placeholder="e.g. take rough notes and extract action items with owners" value={prose} onChange={(e) => setProse(e.target.value)} />
            {error && <div className="fn-error">{error}</div>}
            <button className="fn-generate" disabled={busy || !prose.trim()} onClick={runDescribe}>{busy ? "building…" : isCreate ? "generate" : "apply"}</button>
            {preview && (
              <div className="fn-preview">
                <div className="fn-preview-name">{preview.name}</div>
                <button className="fn-primary" onClick={() => onSaveTree(isCreate ? null : op.id, treeToOperators(preview, { role: op?.role, top: isCreate ? true : !!op?.top }).ops)}>
                  {isCreate ? "add to lab" : "save"}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="fn-pane">
            <label>name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} />
            <label>description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} />
            {!isPipeline && (
              <>
                <label>prompt</label>
                <textarea rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              </>
            )}
          </div>
        )}
        <div className="fn-foot">
          {!isCreate && op && <button className="fn-del" onClick={() => onDelete(op.id)}>delete</button>}
          <span style={{ flex: 1 }} />
          <button className="fn-secondary" onClick={onClose}>cancel</button>
          {tab === "manual" && (
            <button className="fn-primary" disabled={!name.trim() || (!isPipeline && !prompt.trim())}
              onClick={() => isPipeline ? onSaveManual({ ...op, name: name.trim(), description: description.trim() })
                : onSaveManual({ id: op?.id || uid(), kind: "prompt", name: name.trim(), description: description.trim(), prompt: prompt.trim(), top: isCreate ? true : op?.top })}>
              save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
