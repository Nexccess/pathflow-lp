/**
 * api/amplitude-feed.js
 * Vercel Edge Function — Amplitude Dashboard REST API v2
 *
 * LP別内訳: Amplitude API側の制約により取得不可
 * → 全タブで合算値を表示
 *
 * 必須 Vercel 環境変数:
 *   AMPLITUDE_API_KEY    … Project API Key
 *   AMPLITUDE_SECRET_KEY … Secret Key
 */

export const config = { runtime: 'edge' };

const LP_IDS = ['pathflow-v1', 'shigyou-v1', 'seisaku-v1'];

function fmtDate(d) {
  return d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
}

async function ampFetch(auth, eventType, start, end, interval) {
  const url = new URL('https://amplitude.com/api/2/events/segmentation');
  url.searchParams.set('e', JSON.stringify({ event_type: eventType }));
  url.searchParams.set('m', 'totals');
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('i', String(interval));

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Amplitude ${res.status} (${eventType}): ${body.slice(0, 150)}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error(`タイムアウト (${eventType})`);
    throw e;
  }
}

function sumSeries(raw) {
  const v = raw?.data?.series?.[0];
  return Array.isArray(v) ? v.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0) : 0;
}

function weeklySlice(raw) {
  const v = raw?.data?.series?.[0];
  if (!Array.isArray(v)) return [0, 0, 0, 0, 0];
  const s = v.slice(-5);
  while (s.length < 5) s.unshift(0);
  return s;
}

export default async function handler() {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 's-maxage=300, stale-while-revalidate=600',
  };

  const KEY = process.env.AMPLITUDE_API_KEY;
  const SEC = process.env.AMPLITUDE_SECRET_KEY;
  if (!KEY || !SEC) {
    return new Response(
      JSON.stringify({ error: 'AMPLITUDE_API_KEY / AMPLITUDE_SECRET_KEY が Vercel 環境変数に未設定です。' }),
      { status: 500, headers }
    );
  }

  const auth = btoa(`${KEY}:${SEC}`);
  const now  = new Date();
  const today = fmtDate(now);
  const monthStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const weekStart  = fmtDate(new Date(now.getTime() - 34 * 86400 * 1000));

  const [pvR, diagR, bookR, weekR] = await Promise.allSettled([
    ampFetch(auth, 'page_view',        monthStart, today, 1),
    ampFetch(auth, 'diagnosis_click',  monthStart, today, 1),
    ampFetch(auth, 'booking_complete', monthStart, today, 1),
    ampFetch(auth, 'page_view',        weekStart,  today, 7),
  ]);

  const errors = [pvR, diagR, bookR, weekR]
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.message || String(r.reason));

  if ([pvR, diagR, bookR].every(r => r.status === 'rejected')) {
    return new Response(JSON.stringify({ error: errors[0] }), { status: 502, headers });
  }

  const safe = r => r.status === 'fulfilled' ? r.value : null;
  const kpiAll = {
    pv:   sumSeries(safe(pvR)),
    diag: sumSeries(safe(diagR)),
    book: sumSeries(safe(bookR)),
  };
  const weeklyAll = weeklySlice(safe(weekR));

  // LP別内訳は API 制約により取得不可のため全タブ合算値を返す
  const kpi = { ALL: kpiAll };
  const weekly = { ALL: weeklyAll };
  LP_IDS.forEach(id => { kpi[id] = kpiAll; weekly[id] = weeklyAll; });

  return new Response(
    JSON.stringify({
      kpi, weekly,
      _meta: { lpIds: LP_IDS, generatedAt: new Date().toISOString(), errors: errors.length ? errors : null },
    }),
    { status: 200, headers }
  );
}
