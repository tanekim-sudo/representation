import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRANSFORM_PRIMITIVES,
  PRIMITIVE_NAMES,
  isFastPrimitive,
  migrateOperatorStore,
} from "./transform-primitives.js";
import { compileExecutionPlan } from "../server/plan.js";

describe("transform primitives", () => {
  it("defines the canonical grammar", () => {
    assert.equal(TRANSFORM_PRIMITIVES.length, 15);
    assert.ok(PRIMITIVE_NAMES.has("expand"));
    assert.ok(PRIMITIVE_NAMES.has("compress"));
    assert.ok(PRIMITIVE_NAMES.has("merge"));
    assert.ok(PRIMITIVE_NAMES.has("translate"));
    assert.equal(TRANSFORM_PRIMITIVES.filter((p) => p.multi).length, 1);
    assert.equal(TRANSFORM_PRIMITIVES.find((p) => p.name === "differentiate")?.multi, true);
  });

  it("marks primitives as fast-path eligible", () => {
    const expand = TRANSFORM_PRIMITIVES.find((p) => p.name === "expand");
    assert.ok(isFastPrimitive(expand));
    assert.ok(!isFastPrimitive({ primitive: true, kind: "pipeline", steps: [] }));
  });

  it("migrates legacy operator stores to canonical primitives", () => {
    const legacy = [
      { id: "op-combine", name: "combine", primitive: true, kind: "prompt" },
      { id: "x1", name: "thesis", top: true, kind: "pipeline", steps: [] },
    ];
    const next = migrateOperatorStore(legacy);
    assert.equal(next.filter((o) => o.primitive).length, 15);
    assert.ok(next.some((o) => o.name === "thesis"));
    assert.ok(!next.some((o) => o.name === "combine"));
  });

  it("compiles expand as a single synthesize phase (no research)", () => {
    const expand = TRANSFORM_PRIMITIVES.find((p) => p.name === "expand");
    const plan = compileExecutionPlan(expand, { [expand.id]: expand }, "bobyard ai startup");
    assert.equal(plan.phases.length, 1);
    assert.equal(plan.phases[0].id, "synthesize");
    assert.match(plan.phases[0].prompt, /EXPAND/i);
  });
});
