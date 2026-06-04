/**
 * api/amplitude-feed.js
 * Vercel Edge Function — Amplitude Dashboard REST API v2
 *
 * 方式: LP_ID ごとに逐次APIコール → サーバー側で集計
 * フィルター: e= パラメータ内の filters フィールド（正規仕様）
 * 間隔: 300ms（429対策）
 *
 * タブ集計定義:
 *   ALL         = 全LP合算
 *   pathflow    = pathflow-v1 + pathflow-v2 + pathflow-main + pathflow-partner
 *   shigyo      = shigyo-v1 + shigyou-v1
 *   seisaku     = seisaku-v1
 *   souzoku     = souzoku-v1
 *
 * 新サイト追加:
 *   1. LP_DEFS に LP_ID を追記
 *   2. TABS の該当グループに LP_ID を追記
 *   3. admin.html の LP_LIST に同じグループIDで追記
 *
 * 必須 Vercel 環境変数:
 *   AMPLITUDE_API_KEY
 *   AMPLITUDE_SECRET_KEY
 */

export const config = { runtime: 'edge' };

// Amplitude に登録済みの event property "lp" の値
const LP_DEFS = [
  'pathflow-v1',
  'pathflow-v2',
  'pathflow-main',
  'pathflow-partner',
  'shigyo-v1',
  'shigyou-v1',
  'seisaku-v1',
  'souzoku-v1',  // 追加
];

// タブ → LP_ID の集計グループ定義
const TABS = {
  'pathflow-v1': ['pathflow-v1', 'pathflow-v2', 'pathflow-main', 'pathflow-partner'],
  'shigyou-v1':  ['shigyo-v1', 'shigyou-v1'],
  'seisaku-v1':  ['seisaku-v1'],
  'souzoku-v1':  ['souzoku-v1'],  // 追加
};

function fmtDate(d) {
  return d.getFullYear().toString()
    + String(d.getMonth() + 1).padStart(2, '0')
    + String(d.getDate()).padStart(2, '0');
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/**
 * Amplitude Event Segmentation API
 * lpId 指定時: e= 内の filters で event property "lp" を絞り込み（正規形式）
 */
async function ampFetch(auth, eventType, start, end, interval, lpId = null) {
  const eventDef = { event_type: eventType };
  if (lpId) {
    eventDef.filters = [{
      subprop_type:  'event',
      subprop_key:   'lp',
      subprop_op:    'is',
      subprop_value: [lpId],
    }];
  }

  const url = new URL('https://amplitude.com/api/2/events/segmentation');
  url.searchParams.set('e', JSON.stringify(eventDef));
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
      throw new Error(`${res.status} (${eventType}/${lpId ?? 'ALL'}): ${body.slice(0, 150)}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    if (e.name === 'AbortError') throw new Error(`タイムアウト (${eventType}/${lpId ?? 'ALL'})`);
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

  const errors = [];
  // LP_ID ごとの月次 KPI を逐次取得（300ms間隔）
  const lpData = {}; // { 'pathflow-v1': { pv, diag, book }, ... }

  for (const lpId of LP_DEFS) {
    const row = { pv: 0, diag: 0, book: 0 };

    try { row.pv = sumSeries(await ampFetch(auth, 'page_view', monthStart, today, 1, lpId)); }
    catch(e) { errors.push(e.message); }
    await wait(300);

    try { row.diag = sumSeries(await ampFetch(auth, 'diagnosis_click', monthStart, today, 1, lpId)); }
    catch(e) { errors.push(e.message); }
    await wait(300);

    try { row.book = sumSeries(await ampFetch(auth, 'booking_complete', monthStart, today, 1, lpId)); }
    catch(e) { errors.push(e.message); }
    await wait(300);

    lpData[lpId] = row;
  }

  // 週次PV（ALLのみ）
  let weeklyArr = [0, 0, 0, 0, 0];
  try { weeklyArr = weeklySlice(await ampFetch(auth, 'page_view', weekStart, today, 7)); }
  catch(e) { errors.push(e.message); }

  // タブ別に集計
  const sum = ids => ({
    pv:   ids.reduce((a, id) => a + (lpData[id]?.pv   ?? 0), 0),
    diag: ids.reduce((a, id) => a + (lpData[id]?.diag ?? 0), 0),
    book: ids.reduce((a, id) => a + (lpData[id]?.book ?? 0), 0),
  });

  const allIds = LP_DEFS;
  const kpi = {
    ALL:           sum(allIds),
    'pathflow-v1': sum(TABS['pathflow-v1']),
    'shigyou-v1':  sum(TABS['shigyou-v1']),
    'seisaku-v1':  sum(TABS['seisaku-v1']),
    'souzoku-v1':  sum(TABS['souzoku-v1']),  // 追加
  };

  const weekly = {
    ALL:           weeklyArr,
    'pathflow-v1': weeklyArr,
    'shigyou-v1':  weeklyArr,
    'seisaku-v1':  weeklyArr,
    'souzoku-v1':  weeklyArr,  // 追加
  };

  return new Response(
    JSON.stringify({
      kpi, weekly,
      _meta: {
        lpDefs: LP_DEFS,
        tabs: TABS,
        generatedAt: new Date().toISOString(),
        errors: errors.length ? errors : null,
      },
    }),
    { status: 200, headers }
  );
}
