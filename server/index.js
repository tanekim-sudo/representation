import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { runPrompt, hasKey, MODEL } from "./claude.js";
import { runPipeline } from "./pipeline.js";
import { compileExecutionPlan } from "./plan.js";
import { runPhase, runExecutionPlan } from "./executor.js";
import {
  encodeShareBundle,
  decodeShareToken,
  validateShareBundle,
  buildShareUrl,
  SHARE_BUNDLE_VERSION,
} from "../shared/share-bundle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;

if (!hasKey()) {
  console.warn(
    "\n[lens] WARNING: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.\n"
  );
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "16mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: hasKey(), model: MODEL });
});

app.post("/api/run", async (req, res) => {
  try {
    const { prompt, text, count, image, system, maxTokens, research, timeoutMs } = req.body ?? {};
    const data = await runPrompt({ prompt, text, count, image, system, maxTokens, research, timeoutMs });
    res.json(data);
  } catch (err) {
    console.error("[lens] /api/run failed:", err?.message || err);
    res.status(err?.status || 500).json({
      error: err?.error?.error?.message || err?.message || "Something went wrong calling Claude.",
    });
  }
});

app.post("/api/plan", async (req, res) => {
  try {
    const { op, opMap, material } = req.body ?? {};
    if (!op) return res.status(400).json({ error: "op is required" });
    res.json({ plan: compileExecutionPlan(op, opMap || {}, material || "") });
  } catch (err) {
    console.error("[lens] /api/plan failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to compile plan." });
  }
});

app.post("/api/phase", async (req, res) => {
  try {
    const { phaseId, plan, op, opMap, operators, context, image } = req.body ?? {};
    if (!phaseId) return res.status(400).json({ error: "phaseId is required" });
    const executionPlan = plan || compileExecutionPlan(op, opMap || {}, context?.material || "");
    const result = await runPhase(phaseId, executionPlan, context || {}, { operators, op, image });
    res.json({ phaseId, ...result });
  } catch (err) {
    console.error("[lens] /api/phase failed:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Phase failed." });
  }
});

app.post("/api/execute", async (req, res) => {
  try {
    const { op, opMap, operators, material, image } = req.body ?? {};
    if (!op) return res.status(400).json({ error: "op is required" });
    const data = await runExecutionPlan({
      op,
      opMap: opMap || {},
      operators: operators || [],
      material: material || "",
      image: image || null,
    });
    res.json(data);
  } catch (err) {
    console.error("[lens] /api/execute failed:", err?.message || err);
    res.status(err?.status || 500).json({ error: err?.message || "Execution failed." });
  }
});

app.post("/api/pipeline", async (req, res) => {
  try {
    const { op, opMap, operators, material, image } = req.body ?? {};
    const steps = [];
    const data = await runPipeline({
      op,
      opMap: opMap || {},
      operators: operators || [],
      material: material || "",
      image: image || null,
      onStep: (name, i, total) => steps.push({ name, index: i, total }),
    });
    res.json({ ...data, steps });
  } catch (err) {
    console.error("[lens] /api/pipeline failed:", err?.message || err);
    res.status(err?.status || 500).json({
      error: err?.error?.error?.message || err?.message || "Pipeline failed.",
    });
  }
});

app.post("/api/share", (req, res) => {
  try {
    const body = req.body ?? {};
    let bundle = body.bundle;
    if (!bundle && body.kind) bundle = body;
    const validated = validateShareBundle(bundle);
    if (!validated.ok) return res.status(400).json({ error: validated.error });
    const token = encodeShareBundle(validated.bundle);
    const origin = `${req.protocol}://${req.get("host")}`;
    const { url, placement } = buildShareUrl(validated.bundle, origin, "/");
    res.json({ id: token, token, url, placement, v: SHARE_BUNDLE_VERSION });
  } catch (err) {
    console.error("[lens] /api/share POST failed:", err?.message || err);
    res.status(500).json({ error: err?.message || "Failed to create share link." });
  }
});

app.get("/api/share/:id", (req, res) => {
  const decoded = decodeShareToken(String(req.params.id || ""));
  if (!decoded.ok) return res.status(404).json({ error: decoded.error });
  res.json({ bundle: decoded.bundle });
});

// Serve the built client in production, if it exists.
const distDir = path.join(__dirname, "..", "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`\n[lens] server running on http://localhost:${PORT}`);
  console.log(`[lens] model: ${MODEL}`);
  if (!fs.existsSync(distDir)) {
    console.log(`[lens] dev: open the Vite client at http://localhost:5173\n`);
  }
});
