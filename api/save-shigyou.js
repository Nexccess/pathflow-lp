// api/save-shigyou.js
// ─────────────────────────────────────────────
// 役割: スプレッドシート書込み + Googleカレンダー仮予約登録
//       + Resendでオーナー通知メール送信（返信PASSなし）
// ※ EmailJS（フロントエンド送信）は使用しない
// ─────────────────────────────────────────────

import { google } from 'googleapis';
import { Resend }  from 'resend';

const SHEET_NAME = 'AI診断結果'; // ← SSのシート名と完全一致させること

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const {
    name, phone, email, company,
    date, time, date2,
    recommended_menu, score, level,
    answers, mode, lp
  } = req.body;

  // ── 認証 ──────────────────────────────────────
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    console.error('GOOGLE_SERVICE_ACCOUNT_JSON parse error:', e);
    return res.status(500).json({ error: 'Invalid service account JSON' });
  }

  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccount,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar'
    ]
  });
  const authClient = await auth.getClient();

  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const answersStr = Array.isArray(answers) ? answers.join(' / ') : (answers || '');

  // ── スプレッドシート書込み ──────────────────────
  const sheets = google.sheets({ version: 'v4', auth: authClient });
  const spreadsheetId = process.env.SHIGYOU_SPREADSHEET_ID;

  // ヘッダー行の確認（初回のみ自動挿入）
  try {
    const checkRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${SHEET_NAME}!A1:K1`
    });
    const firstRow = (checkRes.data.values || [])[0] || [];
    if (firstRow.length === 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        resource: {
          values: [[
            '送信日時', 'LP_ID', 'お名前', '携帯電話', 'メールアドレス',
            '希望日時（第1）', '希望日時（第2）', 'おすすめメニュー',
            'スコア', 'レベル', '診断回答'
          ]]
        }
      });
    }
  } catch (e) {
    console.error('Header check error (non-fatal):', e.message);
  }

  // データ書込み
  const dateFormatted = date ? date.replace(/-/g, '/') + (time ? ' ' + time : '') : '';
  const date2Formatted = date2 ? date2.replace(/-/g, '/') : '';

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      resource: {
        values: [[
          now,
          lp || '',
          name || '',
          phone || '',
          email || '',
          dateFormatted,
          date2Formatted,
          recommended_menu || '',
          score || '',
          level || '',
          answersStr
        ]]
      }
    });
  } catch (e) {
    console.error('Sheets append error:', e.message);
    // 書込み失敗でもCalendar・メールは続行
  }

  // ── Googleカレンダー仮予約（顧客モードのみ） ────
  if (mode === 'customer' && date) {
    const calendar = google.calendar({ version: 'v3', auth: authClient });
    try {
      await calendar.events.insert({
        calendarId: process.env.CALENDAR_ID,
        resource: {
          summary: `【仮予約】${name} 様`,
          description: [
            `希望時間: ${time || '未指定'}`,
            `メニュー: ${recommended_menu || '未定'}`,
            `TEL: ${phone || ''}`,
            `Email: ${email || ''}`,
            `会社: ${company || ''}`,
            `スコア: ${score} / レベル: ${level}`,
            `第2希望: ${date2Formatted || 'なし'}`,
            `LP: ${lp || ''}`
          ].join('\n'),
          start: { date: date },
          end:   { date: date },
          colorId: '6'           // タンジェリン（仮予約識別色）
          // ⚠ attendees・sendUpdates は使用禁止
          //   （サービスアカウントはDomain-Wide Delegation不要のため）
        }
      });
    } catch (e) {
      console.error('Calendar insert error (non-fatal):', e.message);
    }
  }

  // ── Resend オーナー通知メール ─────────────────
  // 返信PASがない（reply-toのみ設定）
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    const subjectMap = {
      customer: `【Path-Flow】新規予約: ${name} 様`,
      partner:  `【Path-Flow】パートナー申込: ${name} 様`
    };
    const bodyLines = [
      `送信日時　: ${now}`,
      `モード　　: ${mode === 'partner' ? 'パートナー申込' : '顧客予約'}`,
      `お名前　　: ${name}`,
      `TEL　　　: ${phone || '—'}`,
      `Email　　: ${email}`,
      `会社名　　: ${company || '—'}`,
      `希望日時　: ${dateFormatted || '—'}`,
      `第2希望　 : ${date2Formatted || '—'}`,
      `メニュー　: ${recommended_menu || '—'}`,
      `スコア　　: ${score} / レベル: ${level}`,
      `診断回答　: ${answersStr}`,
      `LP ID　　: ${lp}`
    ].join('\n');

    // Resendテンプレートを使用
    // https://resend.com/templates/e9b021fa-1ef0-40b3-a210-7a98f03b36b9/editor
    await resend.emails.send({
      from:     'Path-Flow <noreply@main.pathflow.org>',
      to:       [process.env.OWNER_EMAIL || 'info.nexccess@gmail.com'],
      reply_to: email,          // 返信はPAS不使用・reply-toで直接返信
      subject:  subjectMap[mode] || `【Path-Flow】新規受付: ${name} 様`,
      text:     bodyLines
      // ※ html テンプレートはResendダッシュボード側で管理
    });
  } catch (e) {
    console.error('Resend send error (non-fatal):', e.message);
  }

  return res.status(200).json({ ok: true });
}
