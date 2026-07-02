import { runExecutionPlan } from "../server/executor.js";

/** One server round-trip for full resolve → research → synthesize plans. */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { op, opMap, operators, material, image } = body;
    if (!op) {
      res.status(400).json({ error: "op is required" });
      return;
    }
    const data = await runExecutionPlan({
      op,
      opMap: opMap || {},
      operators: operators || [],
      material: material || "",
      image: image || null,
    });
    res.status(200).json(data);
  } catch (err) {
    console.error("[lens] /api/execute failed:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Execution failed." });
  }
}
