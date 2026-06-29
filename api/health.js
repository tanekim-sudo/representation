import { hasKey, MODEL } from "../server/claude.js";

export default function handler(_req, res) {
  res.status(200).json({ ok: true, hasKey: hasKey(), model: MODEL });
}
