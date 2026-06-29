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

// Run a saved prompt ("symbol") against some text and return the result.
export async function runPrompt({ prompt, text }) {
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

  const content = text && String(text).trim().length > 0 ? String(text) : "";
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

  return { result, model: MODEL };
}
