// api/book.js  – v3.1準拠
// 終日イベント・attendees削除・colorId:6
import { google } from 'googleapis';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, email, date, date2, recommended_menu, score, level, answers, lp } = req.body;
  if (!name || !date) return res.status(400).json({ error: 'name and date are required' });

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    const authClient = await auth.getClient();
    const calendar = google.calendar({ version: 'v3', auth: authClient });

    // 終日イベント（v3.1仕様: dateTimeではなくdate形式）
    const eventDate = date; // yyyy-mm-dd

    const description = [
      `LP: ${lp || 'pathflow-v1'}`,
      `お名前: ${name}`,
      `携帯: ${phone || '-'}`,
      `メール: ${email || '-'}`,
      `希望時間帯: （担当者がLINEで確定）`,
      `希望日（第2）: ${date2 || '-'}`,
      `おすすめメニュー: ${recommended_menu || '-'}`,
      `スコア: ${score} / レベル: ${level}`,
      `診断回答: ${Array.isArray(answers) ? answers.join(' / ') : (answers || '-')}`,
    ].join('\n');

    await calendar.events.insert({
      calendarId: process.env.CALENDAR_ID,
      // attendees・sendUpdates は意図的に省略（v3.1 §5-3: GaxiosError回避）
      requestBody: {
        summary: `【仮予約】${name} 様`,
        description,
        colorId: '6', // タンジェリン（仮予約を視覚的に識別）
        start: { date: eventDate },
        end:   { date: eventDate },
      },
    });

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('book.js error:', err);
    return res.status(500).json({ error: err.message });
  }
}
