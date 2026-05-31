/**
 * api/amplitude-feed.js
 * Vercel Edge Function — Amplitude Dashboard REST API v2
 *
 * タブ別集計定義（Amplitude event property "lp" の実測値に基づく）:
 *   ALL          … フィルターなし（全件合算）
 *   pathflow-v1  … pathflow-v1, pathflow-v2, pathflow-main, pathflow-partner
 *   shigyou-v1   … shigyo-v1, shigyou-v1
 *   seisaku-v1   … seisaku-v1
 *
 * 新サイト追加時: GROUPS に追記 + admin.html の LP_LIST にも追記
 *
 * 必須 Vercel 環境変数:
 *   AMPLITUDE_API_KEY
 *   AMPLITUDE_SECRET_KEY
 */

export const config = { runtime: 'edge' };

// グループ定義（タブID → フィルター対象 lp 値の配列）
// null = フィルターなし（全件）
const GROUPS = {
  'ALL':           null,
  'pathflow-v1':   ['pathflow-v1', 'pathflow-v2', 'pathflow-main', 'pathflow-partner'],
  'shigyou-v1':    ['shigyo-v1', 'shigyou-v1'],
  'seisaku-v1':    ['seisaku-v1'],
};

const GROUP_IDS = Object.keys(GROUPS);

function fmtDate(d) {
  return d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
}

async function ampFetch(auth, eventType, start, end, interval, lpValues = null) {
  const url = new URL('https://amplitude.com/api/2/events/segmentation');
  url.searchParams.set('e', JSON.stringify({ event_type: eventType }));
  url.searchParams.set('m', 'totals');
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('i', String(interval));

  if (lpValues && lpValues.length > 0) {
    url.searchParams.set('s', JSON.stringify([
      { prop: 'lp', op: 'is', values: lpValues, type: 'event' }
    ]));
  }

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
      throw new Error(`${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error(`タイムアウト`);
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
      JSON.stringify({ error: 'AMPLITUDE_API_KEY / AMPLITUDE_SECRET_KEY が未設定です。' }),
      { status: 500, headers }
    );
  }

  const auth = btoa(`${KEY}:${SEC}`);
  const now        = new Date();
  const today      = fmtDate(now);
  const monthStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const weekStart  = fmtDate(new Date(now.getTime() - 34 * 86400 * 1000));

  // 全グループ × 3イベント + ALL週次 = 計13コール並列
  const calls = [];
  for (const [gid, lpValues] of Object.entries(GROUPS)) {
    calls.push(ampFetch(auth, 'page_view',        monthStart, today, 1, lpValues));
    calls.push(ampFetch(auth, 'diagnosis_click',  monthStart, today, 1, lpValues));
    calls.push(ampFetch(auth, 'booking_complete', monthStart, today, 1, lpValues));
  }
  // ALL週次のみ追加
  calls.push(ampFetch(auth, 'page_view', weekStart, today, 7, null));

  const results = await Promise.allSettled(calls);
  const errors  = results.filter(r => r.status === 'rejected').map(r => r.reason?.message);
  const safe    = r => r.status === 'fulfilled' ? r.value : null;

  // 結果をグループごとに組み立て
  const kpi    = {};
  const weekly = {};
  let idx = 0;

  for (const gid of GROUP_IDS) {
    const pvR   = results[idx++];
    const diagR = results[idx++];
    const bookR = results[idx++];
    kpi[gid] = {
      pv:   sumSeries(safe(pvR)),
      diag: sumSeries(safe(diagR)),
      book: sumSeries(safe(bookR)),
    };
    weekly[gid] = [0, 0, 0, 0, 0]; // 週次は後でALLを流用
  }

  // 週次は全グループ共通でALL値を使用
  const allWeekly = weeklySlice(safe(results[results.length - 1]));
  for (const gid of GROUP_IDS) weekly[gid] = allWeekly;

  // ALL集計が全滅の場合のみエラー
  if (kpi['ALL'].pv === 0 && errors.length > 0 && results.slice(0, 3).every(r => r.status === 'rejected')) {
    return new Response(JSON.stringify({ error: errors[0] }), { status: 502, headers });
  }

  return new Response(
    JSON.stringify({
      kpi, weekly,
      _meta: {
        groups: GROUPS,
        generatedAt: new Date().toISOString(),
        errors: errors.length ? errors : null,
      },
    }),
    { status: 200, headers }
  );
}
