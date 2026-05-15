'use strict';

const GEMINI_MODEL    = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です');

    const { visits, diags, contacts, days } = req.body;

    const prompt = `
以下はNexcess（日本政策金融公庫 融資伴走サービス）のLPの直近${days || 30}日間のデータです。

ページビュー: ${visits}件
AI診断タップ: ${diags}件
LINE/TGタップ（問い合わせ）: ${contacts}件
診断完了率: ${Math.round(diags / visits * 100)}%
問い合わせ転換率: ${Math.round(contacts / visits * 100)}%

以下の2点を合計100文字以内の日本語で回答してください。
①今何が起きているか（現状の端的な整理）
②次にとるべきアクション（具体的な1つの行動）

JSONや箇条書きは不要。自然な日本語の文章のみで返してください。
`.trim();

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 256 },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Gemini APIエラー');

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.status(200).json({ summary: text.trim() });

  } catch (error) {
    console.error('[admin-summary] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
