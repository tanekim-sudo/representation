import { compileExecutionPlan } from "../server/plan.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { op, opMap, material } = body;
    if (!op) {
      res.status(400).json({ error: "op is required" });
      return;
    }
    const plan = compileExecutionPlan(op, opMap || {}, material || "");
    res.status(200).json({ plan });
  } catch (err) {
    console.error("[lens] /api/plan failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to compile plan." });
  }
}
