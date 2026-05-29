/**
 * api/amplitude-feed.js
 * Vercel Edge Function — Amplitude Dashboard REST API v2
 *
 * 計測済みイベント（Amplitude プロジェクト確認済み）:
 *   page_view / diagnosis_click / booking_complete
 *
 * 必須 Vercel 環境変数:
 *   AMPLITUDE_API_KEY    … Project API Key
 *   AMPLITUDE_SECRET_KEY … Secret Key
 *
 * 新サイト追加: LP_IDS に ID を追記 + admin.html の LP_LIST にも追記
 */

export const config = { runtime: 'edge' };

const LP_IDS = [
  'pathflow-v1',  // main.pathflow.org
  'shigyo-v1',    // shigyo.pathflow.org
  'seisaku-v1',   // seisakukinyukouko.site
];

function fmtDate(d) {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

async function ampSegment(auth, eventType, start, end, interval, groupProp = null) {
  const url = new URL('https://amplitude.com/api/2/events/segmentation');
  url.searchParams.set('e', JSON.stringify({ event_type: eventType }));
  url.searchParams.set('m', 'totals');
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('i', String(interval));
  if (groupProp) {
    url.searchParams.set('g', JSON.stringify({ type: 'event', value: groupProp }));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Amplitude 認証エラー (${res.status})`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Amplitude HTTP ${res.status} (${eventType}): ${body.slice(0, 200)}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error(`Amplitude タイムアウト (${eventType})`);
    }
    throw e;
  }
}

function extractGroupedTotals(raw, lpIds) {
  const out = { ALL: 0 };
  lpIds.forEach(id => (out[id] = 0));
  const series = raw?.data?.series ?? [];
  const labels = raw?.data?.seriesLabels ?? [];
  series.forEach((vals, i) => {
    const v = Array.isArray(vals)
      ? vals.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
      : 0;
    const lbl = String(labels[i] ?? '');
    out.ALL += v;
    if (Object.prototype.hasOwnProperty.call(out, lbl)) out[lbl] += v;
  });
  return out;
}

function extractGroupedWeekly(raw, lpIds) {
  const out = { ALL: [0, 0, 0, 0, 0] };
  lpIds.forEach(id => (out[id] = [0, 0, 0, 0, 0]));
  const series = raw?.data?.series ?? [];
  const labels = raw?.data?.seriesLabels ?? [];
  series.forEach((vals, i) => {
    const arr = Array.isArray(vals) ? vals.map(v => (typeof v === 'number' ? v : 0)) : [];
    const w = arr.slice(-5);
    while (w.length < 5) w.unshift(0);
    const lbl = String(labels[i] ?? '');
    for (let j = 0; j < 5; j++) {
      out.ALL[j] += w[j];
      if (Object.prototype.hasOwnProperty.call(out, lbl)) out[lbl][j] += w[j];
    }
  });
  return out;
}

export default async function handler(req) {
  const API_KEY    = process.env.AMPLITUDE_API_KEY;
  const SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
  };

  if (!API_KEY || !SECRET_KEY) {
    return new Response(
      JSON.stringify({ error: 'AMPLITUDE_API_KEY または AMPLITUDE_SECRET_KEY が未設定です。Vercel → Settings → Environment Variables を確認してください。' }),
      { status: 500, headers }
    );
  }

  const auth = btoa(`${API_KEY}:${SECRET_KEY}`);

  const now        = new Date();
  const today      = fmtDate(now);
  const monthStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const weekStart  = fmtDate(new Date(now.getTime() - 34 * 86400 * 1000));

  // 計測済み3イベント + 週次PV の計4コール（並列）
  const [pvRes, diagRes, bookRes, weeklyRes] = await Promise.allSettled([
    ampSegment(auth, 'page_view',        monthStart, today, 1, 'lp'),
    ampSegment(auth, 'diagnosis_click',  monthStart, today, 1, 'lp'),
    ampSegment(auth, 'booking_complete', monthStart, today, 1, 'lp'),
    ampSegment(auth, 'page_view',        weekStart,  today, 7, 'lp'),
  ]);

  const errors = [pvRes, diagRes, bookRes, weeklyRes]
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.message || String(r.reason));

  if (errors.length === 4) {
    return new Response(JSON.stringify({ error: errors[0] }), { status: 502, headers });
  }

  const safeRaw = r => (r.status === 'fulfilled' ? r.value : null);

  const pvTotals   = extractGroupedTotals(safeRaw(pvRes),    LP_IDS);
  const diagTotals = extractGroupedTotals(safeRaw(diagRes),  LP_IDS);
  const bookTotals = extractGroupedTotals(safeRaw(bookRes),  LP_IDS);
  const weekly     = extractGroupedWeekly(safeRaw(weeklyRes), LP_IDS);

  const kpi = {};
  ['ALL', ...LP_IDS].forEach(lp => {
    kpi[lp] = {
      pv:   pvTotals[lp]   ?? 0,
      diag: diagTotals[lp] ?? 0,
      book: bookTotals[lp] ?? 0,
    };
  });

  const lpPropertyMissing = LP_IDS.every(id => kpi[id].pv === 0) && kpi.ALL.pv > 0;

  return new Response(
    JSON.stringify({
      kpi,
      weekly,
      _meta: {
        lpIds: LP_IDS,
        generatedAt: new Date().toISOString(),
        lpPropertyMissing,
        errors: errors.length > 0 ? errors : null,
        hint: lpPropertyMissing
          ? '各サイトのトラッキングタグに event_properties.lp が未設定の可能性があります'
          : null,
      },
    }),
    { status: 200, headers }
  );
}
