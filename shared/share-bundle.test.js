import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SHARE_BUNDLE_VERSION,
  createOperatorBundle,
  createSymbolBundle,
  createJourneyBundle,
  createPathBundle,
  createLensShareBundle,
  encodeShareBundle,
  decodeShareToken,
  buildShareUrl,
  parseShareFromLocation,
  normalizeLegacyShare,
} from "./share-bundle.js";

describe("share-bundle", () => {
  it("round-trips operator bundle", () => {
    const bundle = createOperatorBundle(
      { name: "garden lens", description: "see as garden", prompt: "GOAL: garden" },
      { name: "garden lens" }
    );
    assert.equal(bundle.v, SHARE_BUNDLE_VERSION);
    assert.equal(bundle.kind, "operator");
    const token = encodeShareBundle(bundle);
    const decoded = decodeShareToken(token);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.bundle.kind, "operator");
    assert.equal(decoded.bundle.operators[0].name, "garden lens");
  });

  it("round-trips symbol bundle", () => {
    const bundle = createSymbolBundle({
      title: "pattern",
      kind: "idea",
      items: [{ type: "text", x: 0, y: 0, text: "hello", w: 200 }],
    });
    const token = encodeShareBundle(bundle);
    const decoded = decodeShareToken(token);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.bundle.symbols[0].title, "pattern");
  });

  it("round-trips journey bundle", () => {
    const bundle = createJourneyBundle({
      title: "a thought",
      steps: [{ caption: "through merge", via: { name: "merge" } }],
      opTrees: [{ name: "merge", description: "combine" }],
      captureMeta: { stepCount: 1 },
    });
    const token = encodeShareBundle(bundle);
    const decoded = decodeShareToken(token);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.bundle.journey.title, "a thought");
  });

  it("normalizes legacy lens-path", () => {
    const legacy = { kind: "lens-path", version: 2, nodeId: "n1", items: [{ id: "n1", type: "text", text: "hi" }] };
    const bundle = normalizeLegacyShare(legacy);
    assert.equal(bundle.kind, "path");
    const token = encodeShareBundle(bundle);
    const decoded = decodeShareToken(token);
    assert.equal(decoded.ok, true);
    assert.equal(decoded.bundle.path.items.length, 1);
  });

  it("normalizes legacy lens-lens", () => {
    const legacy = { kind: "lens-lens", version: 1, name: "my lens", opTrees: [{ name: "move" }] };
    const bundle = normalizeLegacyShare(legacy);
    assert.equal(bundle.kind, "lens");
    const token = encodeShareBundle(createLensShareBundle("my lens", [{ name: "move" }]));
    assert.equal(decodeShareToken(token).ok, true);
  });

  it("buildShareUrl uses query for small payloads", () => {
    const bundle = createOperatorBundle({ name: "x", prompt: "p" });
    const { url, placement } = buildShareUrl(bundle, "https://lens.app", "/");
    assert.equal(placement, "query");
    assert.match(url, /^https:\/\/lens\.app\/\?share=/);
  });

  it("parseShareFromLocation reads query and hash", () => {
    const bundle = createOperatorBundle({ name: "x", prompt: "p" });
    const token = encodeShareBundle(bundle);
    const fromQuery = parseShareFromLocation({ search: `?share=${token}`, hash: "" });
    assert.equal(fromQuery.token, token);
    const fromHash = parseShareFromLocation({ search: "", hash: `#share=${token}` });
    assert.equal(fromHash.token, token);
  });
});
