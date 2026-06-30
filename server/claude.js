import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

let client = null;
function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export const MAX_RESPONSES = 6;

function extractText(message) {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// Run a saved prompt ("symbol") against some text.
// `count` controls how many independent variations Claude generates (1..MAX_RESPONSES);
// they are produced in parallel and returned as `outputs`.
function imageBlock(image) {
  if (!image || typeof image !== "string") return null;
  const m = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/);
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

// Run a saved prompt against text and/or an image (Claude vision).
export async function runPrompt({ prompt, text, count = 1, image = null, system = null, maxTokens = null }) {
  const anthropic = getClient();
  if (!anthropic) {
    const err = new Error(
      "Server is missing ANTHROPIC_API_KEY. Set it in your environment (or Vercel project settings)."
    );
    err.status = 500;
    throw err;
  }

  if (!prompt || typeof prompt !== "string") {
    const err = new Error("A 'prompt' string is required.");
    err.status = 400;
    throw err;
  }

  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), MAX_RESPONSES);

  const content = text && String(text).trim().length > 0 ? String(text) : "";
  const img = imageBlock(image);
  const userText = content
    ? `${prompt}\n\n---\nHere is the material to work on:\n"""\n${content}\n"""`
    : img
    ? `${prompt}\n\n---\nWork on the image above.`
    : prompt;

  const blocks = [];
  if (img) blocks.push(img);
  blocks.push({ type: "text", text: userText });

  const max_tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 4096, 256), 8192);
  const sys = system && typeof system === "string" ? system : undefined;

  const makeOne = () =>
    anthropic.messages
      .create({
        model: MODEL,
        max_tokens,
        ...(sys ? { system: sys } : {}),
        // Higher temperature when asking for several options, so they differ.
        temperature: n > 1 ? 1 : 0.7,
        messages: [{ role: "user", content: blocks }],
      })
      .then(extractText);

  const settled = await Promise.allSettled(Array.from({ length: n }, makeOne));
  const outputs = settled
    .filter((s) => s.status === "fulfilled" && s.value)
    .map((s) => s.value);

  if (outputs.length === 0) {
    const reason = settled.find((s) => s.status === "rejected")?.reason;
    const err = new Error(reason?.message || "Claude returned no output.");
    err.status = reason?.status || 500;
    throw err;
  }

  return { outputs, model: MODEL };
}
