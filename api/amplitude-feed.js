// api/amplitude-feed.js  –  Amplitude Activity Feed中継
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const API_KEY = process.env.AMPLITUDE_API_KEY;
  const SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;

  if (!API_KEY || !SECRET_KEY) {
    return res.status(500).json({ error: "Amplitude keys not configured" });
  }

  try {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const pad = n => String(n).padStart(2, "0");
    const fmt = d =>
      `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

    const params = new URLSearchParams({
      api_key: API_KEY,
      secret_key: SECRET_KEY,
      start: fmt(fourHoursAgo),
      end: fmt(new Date()),
      limit: 20,
    });

    const resp = await fetch(
      `https://amplitude.com/api/2/events/list?${params}`,
      { headers: { "Content-Type": "application/json" } }
    );
    const data = await resp.json();
    return res.status(200).json(data);
  } catch (err) {
    console.error("Amplitude feed error:", err);
    return res.status(500).json({ error: err.message });
  }
}
