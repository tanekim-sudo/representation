import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSFORM_PRIMITIVES,
  PRIMITIVE_NAMES,
  isTransformPrimitive,
  migrateOperatorStore,
  primitiveNeedsResearch,
  primitiveNeedsResolve,
  estimatePrimitiveMs,
} from "./transform-primitives.js";
import { scaleEta, ETA } from "./eta.js";
import { compileExecutionPlan } from "../server/plan.js";

describe("transform primitives", () => {
  it("defines the canonical grammar", () => {
    assert.equal(TRANSFORM_PRIMITIVES.length, 22);
    assert.ok(PRIMITIVE_NAMES.has("expand"));
    assert.ok(PRIMITIVE_NAMES.has("compress"));
    assert.ok(PRIMITIVE_NAMES.has("collapse scales"));
    assert.ok(PRIMITIVE_NAMES.has("elevate the overlooked"));
    assert.equal(TRANSFORM_PRIMITIVES.filter((p) => p.move).length, 7);
    assert.ok(PRIMITIVE_NAMES.has("merge"));
    assert.ok(PRIMITIVE_NAMES.has("translate"));
    assert.equal(TRANSFORM_PRIMITIVES.filter((p) => p.multi).length, 1);
  });

  it("marks primitives as transform-eligible", () => {
    const expand = TRANSFORM_PRIMITIVES.find((p) => p.name === "expand");
    assert.ok(isTransformPrimitive(expand));
    assert.ok(!isTransformPrimitive({ primitive: true, kind: "pipeline", steps: [] }));
  });

  it("migrates legacy operator stores to canonical primitives", () => {
    const legacy = [
      { id: "op-combine", name: "combine", primitive: true, kind: "prompt" },
      { id: "x1", name: "thesis", top: true, kind: "pipeline", steps: [] },
    ];
    const next = migrateOperatorStore(legacy);
    assert.equal(next.filter((o) => o.primitive).length, 22);
    assert.ok(next.some((o) => o.name === "thesis"));
    assert.ok(!next.some((o) => o.name === "combine"));
  });

  it("routes expand on sparse entity through resolve + research + transform", () => {
    const expand = TRANSFORM_PRIMITIVES.find((p) => p.name === "expand");
    const material = "bobyard ai startup";
    assert.ok(primitiveNeedsResolve(expand, material));
    assert.ok(primitiveNeedsResearch(expand, material));
    assert.ok(estimatePrimitiveMs(expand, material) >= ETA.sameness);
    assert.ok(estimatePrimitiveMs(expand, material) < 60000);

    const plan = compileExecutionPlan(expand, { [expand.id]: expand }, material);
    assert.equal(plan.phases.length, 3);
    assert.equal(plan.phases[0].id, "resolve");
    assert.equal(plan.phases[1].id, "research");
    assert.equal(plan.phases[2].id, "synthesize");
    assert.match(plan.phases[2].prompt, /EXPAND/i);
  });

  it("routes compress on rich text as direct transform only", () => {
    const compress = TRANSFORM_PRIMITIVES.find((p) => p.name === "compress");
    const material = "A".repeat(600);
    assert.ok(!primitiveNeedsResearch(compress, material));
    assert.ok(!primitiveNeedsResolve(compress, material));

    const plan = compileExecutionPlan(compress, { [compress.id]: compress }, material);
    assert.equal(plan.phases.length, 1);
    assert.equal(plan.phases[0].id, "synthesize");
  });

  it("routes invert as direct transform even on sparse input", () => {
    const invert = TRANSFORM_PRIMITIVES.find((p) => p.name === "invert");
    const plan = compileExecutionPlan(invert, { [invert.id]: invert }, "bobyard ai startup");
    assert.equal(plan.phases.length, 1);
  });
});
