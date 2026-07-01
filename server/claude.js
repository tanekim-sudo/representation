import Anthropic from "@anthropic-ai/sdk";

export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-5-20250929";

// Prefer newer web search with higher search budget; falls back in tool config
const WEB_SEARCH_TOOL = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 10,
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
    if (block.type === "text" && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join("\n").trim();
}

function countWebSearches(message) {
  let n = 0;
  for (const block of message.content || []) {
    if (block.type === "server_tool_use" && block.name === "web_search") n++;
  }
  return n;
}

function imageBlock(image) {
  if (!image || typeof image !== "string") return null;
  const m = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/);
  if (!m) return null;
  return { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } };
}

function buildUserText(prompt, text, { research = false, forceSearch = false } = {}) {
  const content = text && String(text).trim().length > 0 ? String(text) : "";
  const materialBlock = content
    ? `MATERIAL TO TRANSFORM (transform THIS specific subject — produce a substantive deliverable, never meta-commentary about missing data):\n"""\n${content}\n"""`
    : "MATERIAL TO TRANSFORM: the attached image/sketch from the user's whiteboard.";

  let header = prompt || "";
  if (research || forceSearch) {
    header = `${header}

WEB SEARCH REQUIRED: Use the web_search tool before writing. Search for the exact company, product, or entity named in the material. Run multiple searches if needed. Do not answer from memory alone — verify with current web sources.`;
  }

  return `${header}\n\n---\n${materialBlock}`;
}

// Run a saved prompt against text and/or an image. Optional web search for research workflows.
export async function runPrompt({
  prompt,
  text,
  count = 1,
  image = null,
  system = null,
  maxTokens = null,
  research = false,
  forceSearch = false,
}) {
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
  const img = imageBlock(image);
  const userText = buildUserText(prompt, text, { research, forceSearch });
  const blocks = [];
  if (img) blocks.push(img);
  blocks.push({ type: "text", text: userText });

  const max_tokens = Math.min(Math.max(parseInt(maxTokens, 10) || (research ? 8192 : 4096), 256), 8192);
  let sys = system && typeof system === "string" ? system : undefined;
  if ((research || forceSearch) && sys) {
    sys += `\n\nYou have the web_search tool. You MUST use it when researching companies, startups, products, or people. Search before claiming you lack information.`;
  } else if (research || forceSearch) {
    sys = `You have the web_search tool. You MUST use it to find current facts. Search before answering.`;
  }

  const useSearch = research || forceSearch;

  const makeOne = async () => {
    const params = {
      model: MODEL,
      max_tokens,
      ...(sys ? { system: sys } : {}),
      messages: [{ role: "user", content: blocks }],
      temperature: n > 1 ? 1 : useSearch ? 0.3 : 0.7,
    };
    if (useSearch) {
      params.tools = [WEB_SEARCH_TOOL];
    }
    const message = await anthropic.messages.create(params);
    const searches = countWebSearches(message);
    if (useSearch && searches === 0) {
      console.warn("[lens] web search enabled but Claude made 0 searches — retrying with force prompt");
      const retryParams = {
        ...params,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You did not search the web. STOP. Use web_search NOW to look up: "${(text || prompt).slice(0, 200)}"\n\nThen complete the task:\n\n${userText}`,
              },
            ],
          },
        ],
      };
      const retry = await anthropic.messages.create(retryParams);
      const retrySearches = countWebSearches(retry);
      console.log(`[lens] research retry: ${retrySearches} web searches`);
      return extractText(retry);
    }
    if (useSearch) {
      console.log(`[lens] web search: ${searches} searches performed`);
    }
    return extractText(message);
  };

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

  return { outputs, model: MODEL, research: !!useSearch };
}
