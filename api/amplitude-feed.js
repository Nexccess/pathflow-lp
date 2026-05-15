'use strict';

// ══ Amplitude Export API 中継 ══
// admin.html からの fetch を受け取り、
// Amplitude Export API を叩いて Activity Feed 用データを返す

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const AMP_API_KEY    = process.env.AMPLITUDE_API_KEY;
    const AMP_SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;
    if (!AMP_API_KEY || !AMP_SECRET_KEY) throw new Error('Amplitude keys not configured');

    // 取得時間幅：過去4時間
    const now   = new Date();
    const start = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    // Amplitude Export API は UTC 時間・形式 YYYYMMDDTHH
    const fmt = d => d.toISOString().slice(0, 13).replace(/-/g, '');
    const startStr = fmt(start);
    const endStr   = fmt(now);

    const auth = Buffer.from(`${AMP_API_KEY}:${AMP_SECRET_KEY}`).toString('base64');
    const url  = `https://amplitude.com/api/2/export?start=${startStr}&end=${endStr}`;

    const ampRes = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (ampRes.status === 404) {
      // データなし（期間内にイベントがない）
      return res.status(200).json({ events: [], empty: true });
    }
    if (!ampRes.ok) {
      throw new Error(`Amplitude API error: ${ampRes.status}`);
    }

    // Export APIはgzip圧縮のndjsonを返す
    // fetch で text() として読み込み、各行をパース
    const raw = await ampRes.text();
    const lines = raw.split('\n').filter(l => l.trim());

    const events = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        events.push({
          time:       e.client_event_time || e.server_upload_time,
          event:      e.event_type,
          lp:         e.event_properties?.lp || e.user_properties?.lp_name || '–',
          city:       e.city || '–',
          country:    e.country || '–',
          device:     e.device_family || '–',
          session_id: e.session_id,
          // 診断スコアなど追加プロパティ
          score:      e.event_properties?.score || null,
          level:      e.event_properties?.level || null,
        });
      } catch { /* パース失敗行はスキップ */ }
    }

    // 新しい順にソートして最大50件
    events.sort((a, b) => new Date(b.time) - new Date(a.time));
    const limited = events.slice(0, 50);

    return res.status(200).json({ events: limited, total: events.length, empty: events.length === 0 });

  } catch (error) {
    console.error('[amplitude-feed] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
