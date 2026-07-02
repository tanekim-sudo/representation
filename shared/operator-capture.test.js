import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TRANSFORM_PRIMITIVES } from "./transform-primitives.js";
import {
  viaFromOp,
  abstractStepFromVia,
  buildCaptureMetadata,
  hydrateOperatorMap,
  resolveMoveRef,
} from "./operator-capture.js";

describe("operator capture abstraction", () => {
  it("stamps compact via metadata on transforms", () => {
    const expand = TRANSFORM_PRIMITIVES.find((p) => p.name === "expand");
    const via = viaFromOp(expand, ["n1"]);
    assert.equal(via.moveRef.kind, "primitive");
    assert.equal(via.moveRef.name, "expand");
    assert.equal(via.inputShape, "single");
    assert.equal(via.parentCount, 1);
  });

  it("abstracts primitive steps without copying prompts", () => {
    const compress = TRANSFORM_PRIMITIVES.find((p) => p.name === "compress");
    const via = viaFromOp(compress, ["n1"]);
    const step = abstractStepFromVia(via, {}, TRANSFORM_PRIMITIVES);
    assert.equal(step.name, "compress");
    assert.ok(step.moveRef);
    assert.equal(step.prompt, undefined);
  });

  it("hydrates moveRef leaves at execution time", () => {
    const expand = TRANSFORM_PRIMITIVES.find((p) => p.name === "expand");
    const id = "leaf1";
    const map = {
      root: { id: "root", kind: "pipeline", steps: [id] },
      [id]: { id, kind: "prompt", name: "expand", moveRef: { kind: "primitive", id: expand.id, name: "expand" } },
    };
    const hydrated = hydrateOperatorMap(map, TRANSFORM_PRIMITIVES, "root");
    assert.match(hydrated[id].prompt, /What else/i);
    assert.ok(hydrated[id].primitive);
  });

  it("builds structural capture metadata", () => {
    const journey = {
      nodeId: "n3",
      steps: [
        { focusId: "n1", itemIds: ["n1"] },
        { focusId: "n2", itemIds: ["n1", "n2"] },
        { focusId: "n3", itemIds: ["n2"] },
      ],
    };
    const vias = [
      { name: "expand", moveRef: { kind: "primitive", name: "expand" }, inputShape: "single" },
      { name: "compress", moveRef: { kind: "primitive", name: "compress" }, inputShape: "single" },
    ];
    const items = [{ id: "n3", bornFrom: ["n2"] }];
    const meta = buildCaptureMetadata(journey, vias, items);
    assert.equal(meta.stepCount, 2);
    assert.equal(meta.moveChain.length, 2);
    assert.equal(meta.provenance, "thread-capture");
    assert.equal(meta.convergences.length, 1);
  });

  it("resolves canonical primitive by name when id is stale", () => {
    const ref = { kind: "primitive", id: "old-id", name: "invert" };
    const resolved = resolveMoveRef(ref, []);
    assert.equal(resolved.name, "invert");
    assert.equal(resolved.prompt, "Opposite view.");
  });
});
