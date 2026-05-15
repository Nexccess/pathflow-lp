'use strict';

const GEMINI_MODEL    = 'gemini-2.5-flash-lite';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT = `
あなたは中小企業向けの生成AI活用型販売業務支援システムの導入適合性を診断する専門アドバイザーです。
ユーザーの入力情報をもとに導入適合スコアを算出し、以下の形式で必ずJSONのみを返してください。
マークダウンや説明文は一切含めず、JSONオブジェクトのみを返すこと。

{
  "score": 数値(0-100),
  "grade": "S/A/B/C のいずれか",
  "headline": "診断結果の一行タイトル（20字以内）",
  "next_step": "推奨する次のアクション（30字以内）",
  "summary": "診断サマリー（100〜150字）",
  "pain_points": [
    { "title": "課題タイトル", "detail": "詳細説明（40字以内）", "severity": 1〜3の数値 }
  ],
  "recommended_features": [
    { "feature": "推奨機能名", "reason": "推奨理由（40字以内）" }
  ],
  "roi_estimate": {
    "workload_reduction": "例：月40時間",
    "conversion_improvement": "例：+15%",
    "payback_period": "例：8〜12ヶ月"
  }
}

pain_pointsは2〜4件、recommended_featuresは2〜4件とすること。
`.trim();

function buildPrompt(payload) {
  return `
業種: ${payload.industry || '未回答'}
企業規模: ${payload.size || '未回答'}
地域: ${payload.area || '未回答'}
現在の課題: ${(payload.challenges || []).join('、')}
月間問い合わせ数: ${payload.monthly_inquiries || '未回答'}
現在のツール: ${payload.current_tools || '未回答'}
導入目標: ${payload.goals || '未回答'}
導入時期: ${payload.budget_timing || '未回答'}
`.trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です');

    const payload = req.body;

    const response = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildPrompt(payload) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message || 'Gemini APIエラー');

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (error) {
    console.error('[diagnose] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
