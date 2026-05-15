'use strict';

const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar',
    ],
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const {
      company          = '',
      name             = '',
      email            = '',
      phone            = '',
      position         = '',
      preferred_date   = '',
      preferred_time   = '',
      message          = '',
      diagnosis_score  = '',
      diagnosis_grade  = '',
    } = req.body;

    if (!name)           throw new Error('お名前は必須です');
    if (!email)          throw new Error('メールアドレスは必須です');
    if (!preferred_date) throw new Error('希望日は必須です');
    if (!preferred_time) throw new Error('希望時間は必須です');

    const calendarId = process.env.CALENDAR_ID;
    if (!calendarId) throw new Error('CALENDAR_ID が未設定です');

    const auth     = getAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    // ISO datetime を組み立て（JST）
    const datetimeStr = `${preferred_date}T${preferred_time}:00+09:00`;
    const startDt = new Date(datetimeStr);
    if (isNaN(startDt.getTime())) throw new Error('日時の形式が不正です');
    const endDt = new Date(startDt.getTime() + 60 * 60 * 1000); // 1時間

    const event = {
      summary: `【相談予約】${company ? company + ' ' : ''}${name}`,
      description: [
        `会社名: ${company}`,
        `氏名: ${name}`,
        `メール: ${email}`,
        `電話: ${phone}`,
        `役職: ${position}`,
        `診断スコア: ${diagnosis_score}点 (${diagnosis_grade}ランク)`,
        message ? `メッセージ: ${message}` : '',
      ].filter(Boolean).join('\n'),
      start: { dateTime: startDt.toISOString(), timeZone: 'Asia/Tokyo' },
      end:   { dateTime: endDt.toISOString(),   timeZone: 'Asia/Tokyo' },
    };

    const response = await calendar.events.insert({
      calendarId,
      requestBody: event,
    });

    const bookingId = `BK-${Date.now()}`;

    return res.status(200).json({
      success:    true,
      booking_id: bookingId,
      eventId:    response.data.id,
      eventLink:  response.data.htmlLink,
    });

  } catch (error) {
    console.error('[book] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
