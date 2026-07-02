import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isInternalMetadataOutput,
  deliverableRewritePrompt,
  defaultDeliverLeaf,
} from "./deliverable-quality.js";
import {
  matchRoleTemplate,
  isResolveOnlyFunction,
  INVESTOR_FUNCTION_TREES,
} from "./role-templates.js";

describe("deliverable quality", () => {
  it("detects internal ENTITY/SEARCH metadata", () => {
    const junk = `ENTITY: Legora
SECTOR: Legal tech
SEARCHTERMS: "Legora funding"`;
    assert.ok(isInternalMetadataOutput(junk));
    assert.ok(!isInternalMetadataOutput("## Thesis\nLegora is a legal tech platform."));
  });

  it("provides default deliver leaf when pipeline has only resolve steps", () => {
    const leaf = defaultDeliverLeaf("Build Thesis", "Full thesis");
    assert.match(leaf.prompt, /deliverable/i);
  });
});

describe("role templates", () => {
  it("matches private equity investor roles", () => {
    const t = matchRoleTemplate("private equity investor");
    assert.ok(t);
    assert.equal(t.id, "investor");
    assert.ok(t.trees.length >= 4);
  });

  it("curated investor trees have research + deliver steps", () => {
    for (const fn of INVESTOR_FUNCTION_TREES) {
      assert.ok(fn.steps?.length >= 2, fn.name);
      assert.ok(fn.steps.some((s) => s.research), fn.name);
      assert.ok(fn.steps.some((s) => !s.research && s.prompt), fn.name);
    }
  });

  it("flags resolve-only junk functions", () => {
    const op = { id: "x", top: true, name: "Identify Subject Entity and Comp Universe", kind: "pipeline", steps: ["l1"] };
    const opMap = {
      x: op,
      l1: { id: "l1", kind: "prompt", prompt: "Return ENTITY: and SEARCH_TERMS:" },
    };
    assert.ok(isResolveOnlyFunction(op, opMap));
  });
});
