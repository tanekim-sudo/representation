import { runPrompt } from "../server/claude.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const { prompt, text, count, image, system, maxTokens, research, timeoutMs } = body;
    const data = await runPrompt({ prompt, text, count, image, system, maxTokens, research, timeoutMs });
    res.status(200).json(data);
  } catch (err) {
    console.error("[lens] /api/run failed:", err?.message || err);
    res.status(err?.status || 500).json({
      error: err?.error?.error?.message || err?.message || "Something went wrong calling Claude.",
    });
  }
}
