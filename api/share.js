import {
  encodeShareBundle,
  decodeShareToken,
  validateShareBundle,
  buildShareUrl,
  SHARE_BUNDLE_VERSION,
} from "../shared/share-bundle.js";

export default function handler(req, res) {
  if (req.method === "GET") {
    const id = req.query?.id || req.query?.share;
    if (!id) {
      return res.status(400).json({ error: "id required", v: SHARE_BUNDLE_VERSION });
    }
    const decoded = decodeShareToken(String(id));
    if (!decoded.ok) return res.status(404).json({ error: decoded.error });
    return res.status(200).json({ bundle: decoded.bundle });
  }

  if (req.method === "POST") {
    const body = req.body ?? {};
    let bundle = body.bundle;
    if (!bundle && body.kind) bundle = body;
    const validated = validateShareBundle(bundle);
    if (!validated.ok) return res.status(400).json({ error: validated.error });
    const token = encodeShareBundle(validated.bundle);
    const origin = req.headers["x-forwarded-host"]
      ? `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"]}`
      : "";
    const { url, placement } = buildShareUrl(validated.bundle, origin, "/");
    return res.status(200).json({ id: token, token, url, placement, v: SHARE_BUNDLE_VERSION });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "method not allowed" });
}
