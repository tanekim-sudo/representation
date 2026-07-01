import { compileExecutionPlan } from "../server/plan.js";
import { runPhase } from "../server/executor.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { phaseId, plan: clientPlan, op, opMap, operators, context, image } = body;
    if (!phaseId) {
      res.status(400).json({ error: "phaseId is required" });
      return;
    }
    const plan = clientPlan || compileExecutionPlan(op, opMap || {}, context?.material || "");
    const result = await runPhase(phaseId, plan, context || {}, { operators, op, image });
    res.status(200).json({ phaseId, ...result });
  } catch (err) {
    console.error("[lens] /api/phase failed:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Phase failed." });
  }
}
