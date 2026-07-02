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
