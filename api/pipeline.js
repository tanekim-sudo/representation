import { runPipeline } from "../server/pipeline.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { op, opMap, operators, material, image } = body;
    const steps = [];
    const data = await runPipeline({
      op,
      opMap: opMap || {},
      operators: operators || [],
      material: material || "",
      image: image || null,
      onStep: (name, i, total) => {
        steps.push({ name, index: i, total });
      },
    });
    res.status(200).json({ ...data, steps });
  } catch (err) {
    console.error("[lens] /api/pipeline failed:", err?.message || err);
    const status = err?.status || 500;
    const message = err?.message || "Pipeline failed.";
    if (message.includes("timeout") || message.includes("timed out")) {
      res.status(504).json({ error: "Research took too long. Try again — the pipeline runs as one request now." });
      return;
    }
    res.status(status).json({
      error: err?.error?.error?.message || message,
    });
  }
}
