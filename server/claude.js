import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";
export const REQUEST_TIMEOUT_MS = 28000;

const WEB_SEARCH_TOOL = {
  type: "web_search_20250305",
  name: "web_search",
  max_uses: 2,
};

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
  const parts = [];
  for (const block of message.content || []) {
    if (block.type === "text" && block.text) parts.push(block.text);
  }
  return parts.join("\n").trim();
}

function imageBlock(image) {
  if (!image || typeof image !== "string") return null;
  const m = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/);
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

function buildUserText(prompt, text, research) {
  const content = text && String(text).trim().length > 0 ? String(text) : "";
  const materialBlock = content
    ? `SUBJECT (transform THIS):\n"""\n${content}\n"""`
    : "SUBJECT: the attached image from the whiteboard.";

  let header = prompt || "";
  if (research) {
    header += `\n\nUse web_search once or twice with the company/entity name, then immediately write the deliverable. Do not over-research.`;
  }
  return `${header}\n\n---\n${materialBlock}`;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("Timed out — try again."), { status: 504 })), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export async function runPrompt({
  prompt,
  text,
  count = 1,
  image = null,
  system = null,
  maxTokens = null,
  research = false,
}) {
  const anthropic = getClient();
  if (!anthropic) {
    const err = new Error("Server is missing ANTHROPIC_API_KEY.");
    err.status = 500;
    throw err;
  }
  if (!prompt || typeof prompt !== "string") {
    const err = new Error("A 'prompt' string is required.");
    err.status = 400;
    throw err;
  }

  const n = Math.min(Math.max(parseInt(count, 10) || 1, 1), MAX_RESPONSES);
  const img = imageBlock(image);
  const userText = buildUserText(prompt, text, research);
  const blocks = [];
  if (img) blocks.push(img);
  blocks.push({ type: "text", text: userText });

  const max_tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 4096, 256), 8192);
  const sys =
    (system && typeof system === "string" ? system : "Return only the deliverable.") +
    (research ? " Use web_search sparingly (1–2 queries max) then answer." : "");

  const makeOne = async () => {
    const params = {
      model: MODEL,
      max_tokens,
      system: sys,
      messages: [{ role: "user", content: blocks }],
      temperature: research ? 0.3 : 0.6,
    };
    if (research) params.tools = [WEB_SEARCH_TOOL];
    const message = await withTimeout(anthropic.messages.create(params), REQUEST_TIMEOUT_MS);
    return extractText(message);
  };

  const settled = await Promise.allSettled(Array.from({ length: n }, makeOne));
  const outputs = settled.filter((s) => s.status === "fulfilled" && s.value).map((s) => s.value);

  if (outputs.length === 0) {
    const reason = settled.find((s) => s.status === "rejected")?.reason;
    const err = new Error(reason?.message || "Claude returned no output.");
    err.status = reason?.status || 500;
    throw err;
  }

  return { outputs, model: MODEL, research: !!research };
}
