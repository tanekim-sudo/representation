import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ETA_SCALE, scaleEta, ETA } from "./eta.js";

describe("eta scaling", () => {
  it("uses 45s / 2min ratio", () => {
    assert.equal(ETA_SCALE, 0.375);
    assert.equal(scaleEta(120000), 45000);
    assert.equal(ETA.onboarding, 45000);
    assert.equal(ETA.default, scaleEta(90000));
  });
});
