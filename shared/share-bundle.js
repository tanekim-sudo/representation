/** Versioned share bundles — operators, symbols, journeys, paths. */

export const SHARE_BUNDLE_VERSION = 1;
export const SHARE_QUERY_LIMIT = 1800;

const KINDS = new Set(["operator", "symbol", "journey", "path", "lens", "bundle"]);

/** @typedef {{ v: number, kind: string, operators?: object[], symbols?: object[], journey?: object, path?: object, lens?: object, meta?: object }} ShareBundle */

export function createShareMeta(name, extra = {}) {
  return { name: name || "shared", createdAt: Date.now(), ...extra };
}

export function createOperatorBundle(opTree, meta = {}) {
  if (!opTree) throw new Error("operator tree required");
  return {
    v: SHARE_BUNDLE_VERSION,
    kind: "operator",
    operators: [opTree],
    meta: createShareMeta(meta.name || opTree.name, meta),
  };
}

export function createLensShareBundle(name, opTrees, meta = {}) {
  return {
    v: SHARE_BUNDLE_VERSION,
    kind: "lens",
    lens: { name, opTrees },
    meta: createShareMeta(name, meta),
  };
}

export function createSymbolBundle(struct, meta = {}) {
  if (!struct?.items?.length) throw new Error("symbol items required");
  const { id: _id, savedAt: _savedAt, ...portable } = struct;
  return {
    v: SHARE_BUNDLE_VERSION,
    kind: "symbol",
    symbols: [portable],
    meta: createShareMeta(meta.name || struct.title, meta),
  };
}

/** Abstract journey — move sequence via op trees, no source canvas required. */
export function createJourneyBundle({ title, steps, opTrees, captureMeta, meta = {} }) {
  return {
    v: SHARE_BUNDLE_VERSION,
    kind: "journey",
    journey: { title, steps, opTrees, captureMeta: captureMeta || null },
    meta: createShareMeta(meta.name || title, meta),
  };
}

/** Full canvas path — lineage items land on recipient's board. */
export function createPathBundle(nodeId, items, meta = {}) {
  return {
    v: SHARE_BUNDLE_VERSION,
    kind: "path",
    path: { nodeId, items },
    meta: createShareMeta(meta.name, meta),
  };
}

export function validateShareBundle(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, error: "not an object" };
  if (raw.v !== SHARE_BUNDLE_VERSION) return { ok: false, error: "unsupported version" };
  if (!KINDS.has(raw.kind)) return { ok: false, error: "unknown kind" };

  switch (raw.kind) {
    case "operator":
      if (!Array.isArray(raw.operators) || !raw.operators.length) return { ok: false, error: "missing operators" };
      break;
    case "lens":
      if (!raw.lens?.opTrees?.length) return { ok: false, error: "missing lens opTrees" };
      break;
    case "symbol":
      if (!Array.isArray(raw.symbols) || !raw.symbols.length) return { ok: false, error: "missing symbols" };
      break;
    case "journey":
      if (!raw.journey?.steps?.length) return { ok: false, error: "missing journey steps" };
      break;
    case "path":
      if (!raw.path?.items?.length) return { ok: false, error: "missing path items" };
      break;
    case "bundle":
      break;
    default:
      return { ok: false, error: "invalid kind" };
  }
  return { ok: true, bundle: raw };
}

/** Legacy file formats → share bundle. */
export function normalizeLegacyShare(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.v === SHARE_BUNDLE_VERSION && KINDS.has(raw.kind)) return raw;
  if (raw.kind === "lens-path" && Array.isArray(raw.items)) {
    return createPathBundle(raw.nodeId, raw.items, { name: "shared path" });
  }
  if (raw.kind === "lens-lens" && Array.isArray(raw.opTrees)) {
    return createLensShareBundle(raw.name || "uploaded lens", raw.opTrees, { name: raw.name });
  }
  return null;
}

export function toBase64Url(str) {
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(str, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(token) {
  let b64 = String(token).replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64").toString("utf8");
  return decodeURIComponent(escape(atob(b64)));
}

export function encodeShareBundle(bundle) {
  const validated = validateShareBundle(bundle);
  if (!validated.ok) throw new Error(validated.error);
  return toBase64Url(JSON.stringify(bundle));
}

export function decodeShareToken(token) {
  if (!token || typeof token !== "string") return { ok: false, error: "empty token" };
  try {
    const raw = JSON.parse(fromBase64Url(token.trim()));
    const legacy = normalizeLegacyShare(raw);
    const candidate = legacy || raw;
    const validated = validateShareBundle(candidate);
    if (!validated.ok) return validated;
    return { ok: true, bundle: validated.bundle };
  } catch {
    return { ok: false, error: "invalid token" };
  }
}

/** Build a share URL; large payloads use hash fragment. */
export function buildShareUrl(bundle, origin = "", pathname = "/") {
  const token = encodeShareBundle(bundle);
  const base = `${origin || ""}${pathname || "/"}`;
  if (token.length <= SHARE_QUERY_LIMIT) {
    return { url: `${base}?share=${token}`, token, placement: "query" };
  }
  return { url: `${base}#share=${token}`, token, placement: "hash" };
}

export function parseShareFromLocation(loc = {}) {
  const search = loc.search || "";
  const hash = loc.hash || "";
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fromQuery = q.get("share");
  if (fromQuery) return { token: fromQuery, placement: "query" };
  const hashMatch = hash.match(/[#&]share=([^&]+)/);
  if (hashMatch) return { token: hashMatch[1], placement: "hash" };
  return null;
}

export function clearShareFromLocation(loc = {}) {
  const url = new URL(loc.href || "http://local/");
  url.searchParams.delete("share");
  url.hash = url.hash.replace(/[#&]?share=[^&]*/g, "").replace(/^#$/, "");
  return url.pathname + url.search + url.hash;
}

function cap(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Display name for any share bundle kind. */
export function getBundleDisplayName(bundle) {
  if (!bundle) return "shared";
  switch (bundle.kind) {
    case "operator":
      return bundle.operators?.[0]?.name || bundle.meta?.name || "function";
    case "lens":
      return bundle.lens?.name || bundle.meta?.name || "lens";
    case "journey":
      return bundle.journey?.title || bundle.meta?.name || "journey";
    case "symbol":
      return bundle.symbols?.[0]?.title || bundle.meta?.name || "structure";
    case "path":
      return bundle.meta?.name || "shared path";
    default:
      return bundle.meta?.name || "shared";
  }
}

/** One-line tagline for the reveal step. */
export function shareTagline(bundle) {
  const name = getBundleDisplayName(bundle);
  switch (bundle.kind) {
    case "operator":
      return `A reusable move — ${name}`;
    case "lens": {
      const n = bundle.lens?.opTrees?.length || 0;
      return `${n} move${n === 1 ? "" : "s"} in sequence — ${name}`;
    }
    case "journey":
      return `See how ${name} was built, step by step`;
    case "symbol":
      return `A reusable template — ${name}`;
    case "path":
      return "A thought path someone shared with you";
    default:
      return `${name} was shared with you`;
  }
}

const KEYWORD_USE_CASES = [
  {
    re: /compress|condense|distill|summar|tighten|shrink/,
    cases: (n) => [`Compress messy notes with “${n}”`, "Distill meeting takeaways", "Sharpen before sharing"],
  },
  {
    re: /expand|elaborat|develop|grow|flesh/,
    cases: (n) => [`Expand rough ideas with “${n}”`, "Flesh out half-formed thoughts", "Build on a single spark"],
  },
  {
    re: /invert|flip|reverse|opposite|counter/,
    cases: (n) => [`Flip assumptions using “${n}”`, "Stress-test your first take", "Find the counter-view"],
  },
  {
    re: /compare|contrast|weigh|balance/,
    cases: (n) => [`Weigh options with “${n}”`, "See two sides clearly", "Decide with sharper tradeoffs"],
  },
  {
    re: /garden|nature|organic|grow/,
    cases: (n) => [`See ideas as living systems with “${n}”`, "Find what wants to grow", "Tend messy notes like a garden"],
  },
  {
    re: /merge|combine|blend|synth/,
    cases: (n) => [`Combine threads with “${n}”`, "Merge overlapping notes", "Find the through-line"],
  },
  {
    re: /question|probe|ask|interrog/,
    cases: (n) => [`Ask sharper questions with “${n}”`, "Probe weak spots in an argument", "Turn notes into inquiry"],
  },
];

/** 2–3 auto-generated use-case bullets (no LLM). */
export function shareUseCases(bundle) {
  const name = getBundleDisplayName(bundle);
  const lower = name.toLowerCase();

  for (const kw of KEYWORD_USE_CASES) {
    if (kw.re.test(lower)) return kw.cases(name).slice(0, 3);
  }

  const desc = bundle.operators?.[0]?.description || bundle.lens?.description || "";
  if (desc) {
    const parts = desc
      .split(/[.!?\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8);
    if (parts.length >= 2) return parts.slice(0, 3).map(cap);
  }

  switch (bundle.kind) {
    case "operator":
      return [
        `Apply “${name}” to any note on your board`,
        "Drop it on text to transform in one gesture",
        "Combine with other moves in a lens",
      ];
    case "lens": {
      const n = bundle.lens?.opTrees?.length || 0;
      return [
        `Run ${n} move${n === 1 ? "" : "s"} in sequence`,
        "Switch perspectives without retyping prompts",
        "Save hours on repetitive thinking patterns",
      ];
    }
    case "journey":
      return [
        "Replay how this idea was built",
        "Learn the move sequence behind the result",
        "Branch off and make it yours",
      ];
    case "symbol":
      return [
        "Reuse this template on new material",
        "Keep structure, swap the content",
        "Build a library of thinking frameworks",
      ];
    case "path":
      return [
        "Walk the full thought path on your canvas",
        "See every note in context",
        "Continue from where they left off",
      ];
    default:
      return ["Explore it on your board", "Make it part of your workflow"];
  }
}

/** Preview chips for the pipeline / move chain step. */
export function sharePreviewItems(bundle) {
  switch (bundle.kind) {
    case "operator": {
      const op = bundle.operators?.[0];
      const steps = op?.steps || [];
      if (steps.length) return steps.map((s) => s.name || "step");
      return [op?.name || "function"];
    }
    case "lens":
      return (bundle.lens?.opTrees || []).map((t) => t.name || "move");
    case "journey": {
      const trees = bundle.journey?.opTrees || [];
      if (trees.length) return trees.map((t) => t.name || "move");
      return (bundle.journey?.steps || []).map((s, i) => s.caption || s.via?.name || `step ${i + 1}`);
    }
    case "symbol": {
      const sym = bundle.symbols?.[0];
      const n = sym?.items?.length || 0;
      return [sym?.kind || "template", `${n} item${n === 1 ? "" : "s"}`];
    }
    case "path": {
      const n = bundle.path?.items?.length || 0;
      return [`${n} note${n === 1 ? "" : "s"}`, "full canvas path"];
    }
    default:
      return [];
  }
}

/** Where the item lands: functions rail, structures tab, or canvas. */
export function shareDestinationKind(bundle) {
  switch (bundle?.kind) {
    case "symbol":
      return "structures";
    case "path":
      return "canvas";
    default:
      return "functions";
  }
}

/** Human label for the destination (laboratory, etc.). */
export function shareDestinationLabel(bundle) {
  switch (shareDestinationKind(bundle)) {
    case "structures":
      return "structures";
    case "canvas":
      return "canvas";
    default:
      return "laboratory";
  }
}

/** Kind badge shown in the overlay header. */
export function shareKindLabel(bundle) {
  switch (bundle?.kind) {
    case "operator":
      return "function";
    case "lens":
      return "lens";
    case "journey":
      return "journey";
    case "symbol":
      return "structure";
    case "path":
      return "path";
    default:
      return "share";
  }
}
