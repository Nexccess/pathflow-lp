/**
 * api/amplitude-feed.js
 * Vercel Serverless Function — Amplitude Dashboard REST API v2
 *
 * 必須 Vercel 環境変数:
 *   AMPLITUDE_API_KEY    … Amplitude Project API Key（SDKキーと同一）
 *   AMPLITUDE_SECRET_KEY … Amplitude Project Secret Key
 *
 * 新しいサイト（LP）を追加する場合は LP_IDS 配列に ID を追記すること。
 * admin.html の LP_LIST と ID が完全一致している必要がある。
 *
 * Amplitude Event Segmentation API
 *   GET https://amplitude.com/api/2/events/segmentation
 *   Auth: Basic base64(API_KEY:SECRET_KEY)
 */

// ────────────────────────────────────────
//  LP 設定（admin.html の LP_LIST と同期）
// ────────────────────────────────────────
const LP_IDS = [
  'pathflow-v1',  // main.pathflow.org
  'shigyo-v1',    // shigyo.pathflow.org
  'seisaku-v1',   // seisakukinyukouko.site
];

// 追跡対象イベント
const EVENT_TYPES = [
  'page_view',
  'diagnosis_click',
  'booking_complete',
  'fcb_click_line',
];

// ────────────────────────────────────────
//  ユーティリティ
// ────────────────────────────────────────
function fmtDate(d) {
  return (
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * Amplitude Event Segmentation API 呼び出し
 * @param {string} auth      Base64 encoded "apiKey:secretKey"
 * @param {string} eventType イベント名
 * @param {string} start     YYYYMMDD
 * @param {string} end       YYYYMMDD
 * @param {number} interval  1=daily, 7=weekly
 * @param {string|null} groupProp  グループ化するイベントプロパティ名（null = グループなし）
 */
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

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('Amplitude 認証エラー。API_KEY / SECRET_KEY を確認してください。');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Amplitude API HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * グループ別集計（月次合計）を抽出
 * seriesLabels の各ラベルが LP ID に対応する
 */
function extractGroupedTotals(raw, lpIds) {
  const out = { ALL: 0 };
  lpIds.forEach((id) => (out[id] = 0));

  const series = raw?.data?.series ?? [];
  const labels = raw?.data?.seriesLabels ?? [];

  series.forEach((vals, i) => {
    const v = Array.isArray(vals)
      ? vals.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0)
      : 0;
    const lbl = String(labels[i] ?? '');
    out.ALL += v;
    if (Object.prototype.hasOwnProperty.call(out, lbl)) {
      out[lbl] += v;
    }
  });

  return out;
}

/**
 * グループ別週次 PV を抽出（直近5週分）
 */
function extractGroupedWeekly(raw, lpIds) {
  const out = { ALL: [0, 0, 0, 0, 0] };
  lpIds.forEach((id) => (out[id] = [0, 0, 0, 0, 0]));

  const series = raw?.data?.series ?? [];
  const labels = raw?.data?.seriesLabels ?? [];

  series.forEach((vals, i) => {
    const arr = Array.isArray(vals) ? vals.map((v) => (typeof v === 'number' ? v : 0)) : [];
    const w = arr.slice(-5);
    while (w.length < 5) w.unshift(0);
    const lbl = String(labels[i] ?? '');
    for (let j = 0; j < 5; j++) {
      out.ALL[j] += w[j];
      if (Object.prototype.hasOwnProperty.call(out, lbl)) {
        out[lbl][j] += w[j];
      }
    }
  });

  return out;
}

// ────────────────────────────────────────
//  メインハンドラ
// ────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const API_KEY    = process.env.AMPLITUDE_API_KEY;
  const SECRET_KEY = process.env.AMPLITUDE_SECRET_KEY;

  if (!API_KEY || !SECRET_KEY) {
    return res.status(500).json({
      error:
        'AMPLITUDE_API_KEY または AMPLITUDE_SECRET_KEY が Vercel 環境変数に未設定です。' +
        'Vercel Dashboard → Settings → Environment Variables で設定してください。',
    });
  }

  const auth = Buffer.from(`${API_KEY}:${SECRET_KEY}`).toString('base64');

  const now        = new Date();
  const today      = fmtDate(now);
  // 当月1日～今日（月次 KPI）
  const monthStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  // 35日前～今日（週次 5 週分）
  const weekStart  = fmtDate(new Date(now.getTime() - 34 * 86400 * 1000));

  try {
    // 5本の API コールを並列実行
    const [pvRaw, diagRaw, bookRaw, lineRaw, weeklyRaw] = await Promise.all([
      ampSegment(auth, 'page_view',        monthStart, today, 1, 'lp'),
      ampSegment(auth, 'diagnosis_click',  monthStart, today, 1, 'lp'),
      ampSegment(auth, 'booking_complete', monthStart, today, 1, 'lp'),
      ampSegment(auth, 'fcb_click_line',   monthStart, today, 1, 'lp'),
      ampSegment(auth, 'page_view',        weekStart,  today, 7, 'lp'),
    ]);

    const pvTotals   = extractGroupedTotals(pvRaw,   LP_IDS);
    const diagTotals = extractGroupedTotals(diagRaw,  LP_IDS);
    const bookTotals = extractGroupedTotals(bookRaw,  LP_IDS);
    const lineTotals = extractGroupedTotals(lineRaw,  LP_IDS);
    const weekly     = extractGroupedWeekly(weeklyRaw, LP_IDS);

    // LP ごとの KPI オブジェクトを構築
    const kpi = {};
    ['ALL', ...LP_IDS].forEach((lp) => {
      kpi[lp] = {
        pv:   pvTotals[lp]   ?? 0,
        diag: diagTotals[lp] ?? 0,
        book: bookTotals[lp] ?? 0,
        line: lineTotals[lp] ?? 0,
      };
    });

    // LP プロパティが未設定でも ALL には反映されるが
    // 各 LP の内訳が 0 になる場合のデバッグ用ヒントを付与
    const lpPropertyMissing = LP_IDS.every((id) => kpi[id].pv === 0) && kpi.ALL.pv > 0;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      kpi,
      weekly,
      _meta: {
        lpIds: LP_IDS,
        generatedAt: new Date().toISOString(),
        lpPropertyMissing,
        hint: lpPropertyMissing
          ? '全サイトのトラッキングタグに event_properties.lp が未設定の可能性があります'
          : null,
      },
    });
  } catch (err) {
    console.error('[amplitude-feed]', err);
    return res.status(500).json({ error: err.message });
  }
};
