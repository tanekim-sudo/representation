import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.warn(
    "\n[lens] WARNING: ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.\n"
  );
}

const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, hasKey: Boolean(apiKey), model: MODEL });
});

// Run a saved prompt ("symbol") against some text.
app.post("/api/run", async (req, res) => {
  try {
    if (!anthropic) {
      return res
        .status(500)
        .json({ error: "Server is missing ANTHROPIC_API_KEY. Add it to .env and restart." });
    }

    const { prompt, text } = req.body ?? {};
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "A 'prompt' string is required." });
    }

    const content = text && text.trim().length > 0 ? text : "";

    const userMessage = content
      ? `${prompt}\n\n---\nHere is the text to work on:\n"""\n${content}\n"""`
      : prompt;

    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: userMessage }],
    });

    const result = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    res.json({ result, model: MODEL });
  } catch (err) {
    console.error("[lens] /api/run failed:", err?.message || err);
    const status = err?.status || 500;
    res.status(status).json({
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
