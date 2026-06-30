import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { runPrompt, hasKey, MODEL } from "./claude.js";

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
    const { prompt, text, count, image, system, maxTokens, research } = req.body ?? {};
    const data = await runPrompt({ prompt, text, count, image, system, maxTokens, research });
    res.json(data);
  } catch (err) {
    console.error("[lens] /api/run failed:", err?.message || err);
    res.status(err?.status || 500).json({
      error: err?.error?.error?.message || err?.message || "Something went wrong calling Claude.",
    });
  }
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
