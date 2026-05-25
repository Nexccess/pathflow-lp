// api/amplitude-feed.js
export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const callerToken = req.headers["x-internal-token"];
  if (callerToken !== process.env.INTERNAL_API_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const API_KEY    = process.env.AMPLITUDE_API_KEY;
  const SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;

  if (!API_KEY || !SECRET_KEY) {
    return res.status(500).json({ error: "Amplitude keys not configured" });
  }

  // ── 監視対象タグ ───────────────────────────────────────────────
  const WATCHED_TAGS = [
    "shigyo-v1",
    "pathflow-main",
    "pathflow-v1",
    "pathflow-v2",
  ];

  const rawLimit = parseInt(req.query.limit ?? "20", 10);
  const limit    = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), 100)
    : 20;

  try {
    const pad = (n) => String(n).padStart(2, "0");

    const fmtUTC = (d) =>
      `${d.getUTCFullYear()}` +
      `${pad(d.getUTCMonth() + 1)}` +
      `${pad(d.getUTCDate())}` +
      `T${pad(d.getUTCHours())}` +
      `${pad(d.getUTCMinutes())}` +
      `${pad(d.getUTCSeconds())}`;

    const now          = new Date();
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      start: fmtUTC(fourHoursAgo),
      end:   fmtUTC(now),
      limit: String(limit),
    });

    const credentials = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString("base64");

    const upstream = await fetch(
      `https://amplitude.com/api/2/events/list?${params}`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept:        "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error(`Amplitude ${upstream.status}:`, body);
      return res.status(502).json({
        error:  "Upstream Amplitude error",
        status: upstream.status,
      });
    }

    const data = await upstream.json();

    // ── WATCHED_TAGS に一致するイベントのみ抽出 ────────────────────
    const filtered = {
      ...data,
      events: (data.events ?? []).filter((event) =>
        (event.tags ?? []).some((tag) => WATCHED_TAGS.includes(tag))
      ),
    };

    // ── タグごとに件数をログ出力（監視用） ─────────────────────────
    const tagCounts = WATCHED_TAGS.reduce((acc, tag) => {
      acc[tag] = filtered.events.filter((e) =>
        (e.tags ?? []).includes(tag)
      ).length;
      return acc;
    }, {});
    console.info("Amplitude tag counts:", tagCounts);

    return res
      .status(200)
      .setHeader("Cache-Control", "private, no-store")
      .json(filtered);

  } catch (err) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.error("Amplitude request timed out");
      return res.status(504).json({ error: "Upstream request timed out" });
    }
    console.error("Amplitude feed error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
