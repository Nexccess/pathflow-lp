/**
 * api/amplitude-feed.js
 * Vercel Edge Function — Amplitude Dashboard REST API v2
 *
 * 現在の実装: グループ集計なし（全サイト合算のみ）
 * LP別内訳を表示するには、各LPのトラッキングタグで
 * event_properties.lp = 'pathflow-v1' 等を送信する必要がある。
 * その実装完了後に本ファイルを更新すること。
 *
 * 必須 Vercel 環境変数:
 *   AMPLITUDE_API_KEY    … Project API Key
 *   AMPLITUDE_SECRET_KEY … Secret Key
 */

export const config = { runtime: 'edge' };

function fmtDate(d) {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * Amplitude Event Segmentation API — グループなし
 * 返値: { data: { series: [[n,n,...]], xValues: ['YYYY-MM-DD',...] } }
 */
async function ampSegment(auth, eventType, start, end, interval) {
  const url = new URL('https://amplitude.com/api/2/events/segmentation');
  url.searchParams.set('e', JSON.stringify({ event_type: eventType }));
  url.searchParams.set('m', 'totals');
  url.searchParams.set('start', start);
  url.searchParams.set('end', end);
  url.searchParams.set('i', String(interval));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) {
      throw new Error(`Amplitude 認証エラー (${res.status}) — API_KEY / SECRET_KEY を確認してください`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Amplitude HTTP ${res.status} (${eventType}): ${body.slice(0, 300)}`);
    }
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error(`Amplitude タイムアウト (${eventType})`);
    throw e;
  }
}

/** series[0] の合計値を返す */
function sumSeries(raw) {
  const vals = raw?.data?.series?.[0];
  if (!Array.isArray(vals)) return 0;
  return vals.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
}

/** 直近 n 週分の週次集計値を返す（interval=7 のレスポンス想定） */
function weeklySlice(raw, n = 5) {
  const vals = raw?.data?.series?.[0];
  if (!Array.isArray(vals)) return Array(n).fill(0);
  const sliced = vals.slice(-n);
  while (sliced.length < n) sliced.unshift(0);
  return sliced;
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
      JSON.stringify({
        error: 'AMPLITUDE_API_KEY または AMPLITUDE_SECRET_KEY が未設定です。Vercel → Settings → Environment Variables を確認してください。',
      }),
      { status: 500, headers }
    );
  }

  const auth = btoa(`${API_KEY}:${SECRET_KEY}`);

  const now        = new Date();
  const today      = fmtDate(now);
  const monthStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const weekStart  = fmtDate(new Date(now.getTime() - 34 * 86400 * 1000));

  const [pvRes, diagRes, bookRes, weeklyRes] = await Promise.allSettled([
    ampSegment(auth, 'page_view',        monthStart, today, 1),
    ampSegment(auth, 'diagnosis_click',  monthStart, today, 1),
    ampSegment(auth, 'booking_complete', monthStart, today, 1),
    ampSegment(auth, 'page_view',        weekStart,  today, 7),
  ]);

  const errors = [pvRes, diagRes, bookRes, weeklyRes]
    .filter(r => r.status === 'rejected')
    .map(r => r.reason?.message || String(r.reason));

  if (errors.length === 4) {
    return new Response(JSON.stringify({ error: errors[0] }), { status: 502, headers });
  }

  const safe = r => (r.status === 'fulfilled' ? r.value : null);

  const pv   = sumSeries(safe(pvRes));
  const diag = sumSeries(safe(diagRes));
  const book = sumSeries(safe(bookRes));
  const weekly = weeklySlice(safe(weeklyRes));

  // LP別内訳は未実装のため全て全体値を返す
  // （各LPタブで同一の合算値を表示する仕様）
  const LP_IDS = ['pathflow-v1', 'shigyo-v1', 'seisaku-v1'];
  const kpiAll = { pv, diag, book };
  const kpi = { ALL: kpiAll };
  LP_IDS.forEach(id => { kpi[id] = kpiAll; });

  const weeklyAll = { ALL: weekly };
  LP_IDS.forEach(id => { weeklyAll[id] = weekly; });

  return new Response(
    JSON.stringify({
      kpi,
      weekly: weeklyAll,
      _meta: {
        lpIds: LP_IDS,
        generatedAt: new Date().toISOString(),
        lpBreakdownAvailable: false,
        note: 'LP別内訳はevent_properties.lpの実装後に有効化されます',
        errors: errors.length > 0 ? errors : null,
      },
    }),
    { status: 200, headers }
  );
}
