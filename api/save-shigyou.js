// api/save-shigyou.js  – v3.1準拠 / Resend対応
import { google } from 'googleapis';
import { Resend } from 'resend';

const SHEET_NAME = 'AI診断結果';
const HEADERS = [
  '送信日時','LP_ID','お名前','携帯電話','メールアドレス',
  '希望日時（第1）','希望日時（第2）','おすすめメニュー',
  'スコア','レベル','診断回答'
];

function formatDate(d, t) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${y}/${m}/${day}${t ? ' ' + t : ''}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, email, date, time, date2, time2,
          recommended_menu, score, level, answers, lp } = req.body;

  if (!name || !email) return res.status(400).json({ error: 'name and email required' });

  const answersStr = Array.isArray(answers) ? answers.join(' / ') : (answers || '');
  const date1Str   = formatDate(date, time);
  const date2Str   = date2 ? formatDate(date2, time2 || '') : '-';
  const now        = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/calendar',
      ],
    });
    const authClient = await auth.getClient();

    // ── 1. Spreadsheet書込み ──────────────────────────────
    const sheets  = google.sheets({ version: 'v4', auth: authClient });
    const SHEET_ID = process.env.SHIGYOU_SPREADSHEET_ID;

    const checkRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
    });
    const firstCell = ((checkRes.data.values || [[]])[0] || [])[0];
    if (!firstCell) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${SHEET_NAME}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [HEADERS] },
      });
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${SHEET_NAME}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[
          now, lp || 'pathflow-v1', name, phone || '', email,
          date1Str, date2Str, recommended_menu || '',
          score || '', level || '', answersStr,
        ]],
      },
    });

    // ── 2. Googleカレンダー登録 ────────────────────────────
    if (date) {
      const calendar = google.calendar({ version: 'v3', auth: authClient });
      await calendar.events.insert({
        calendarId: process.env.CALENDAR_ID,
        requestBody: {
          summary: `【仮予約】${name} 様`,
          description: [
            `LP: ${lp || 'pathflow-v1'}`,
            `お名前: ${name}`,
            `携帯: ${phone || '-'}`,
            `メール: ${email}`,
            `希望日時（第1）: ${date1Str}`,
            `希望日時（第2）: ${date2Str}`,
            `おすすめメニュー: ${recommended_menu || '-'}`,
            `スコア: ${score} / レベル: ${level}`,
            `診断回答: ${answersStr}`,
          ].join('\n'),
          colorId: '6',
          start: { date },
          end:   { date },
        },
      });
    }

    // ── 3. Resendメール通知 ───────────────────────────────
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Path-Flow <info@nexccess.com>',
        to:   ['info@nexccess.com'],
        replyTo: email,
        subject: `【Path-Flow 予約通知】${name} 様 / ${date1Str}`,
        text: [
          '■ Path-Flow AI診断 予約通知',
          '',
          `お名前：${name}`,
          `携帯電話：${phone || '-'}`,
          `メール：${email}`,
          '',
          `希望日時（第1）：${date1Str}`,
          `希望日時（第2）：${date2Str}`,
          '',
          `おすすめメニュー：${recommended_menu || '-'}`,
          `スコア：${score} / レベル：${level}`,
          '',
          `診断回答：${answersStr}`,
          '',
          `LP識別：${lp || 'pathflow-v1'}`,
          `送信日時：${now}`,
        ].join('\n'),
      });
    } catch (mailErr) {
      // メール失敗はSS書込み成功後のため非致命的
      console.error('Resend error (non-fatal):', mailErr.message);
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('save-shigyou error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
