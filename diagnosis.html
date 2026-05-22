// api/diagnose.js  v2
// ─────────────────────────────────────────────
// 役割: Gemini APIによる5問診断結果の分析・メニュー提案
// 変更: 503対策として gemini-2.5-flash-lite → gemini-1.5-flash
//       へのオートフォールバック + リトライ(1回)を追加
// ─────────────────────────────────────────────

import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Path-Flow メニュー一覧（クライアント差し替えポイント）──
const MENU_LIST = `
■ Path-Flow 標準プラン一覧
- スタータープラン: 月額 ¥29,800（AI診断+予約自動化 基本セット）
- スタンダードプラン: 月額 ¥49,800（+スプレッドシート蓄積+解析ダッシュボード）
- プレミアムプラン: 月額 ¥79,800（+カスタム診断設問+専任サポート）
- IT補助金活用プラン: 初期費用の最大3/4を補助（要件確認後ご案内）
`;

const PARTNER_SCORE_GUIDE = `
スコア基準（パートナー適合診断）:
A (80-100): 即戦力パートナー。活動開始を強く推奨。
B (60-79): 十分な適性あり。個別面談で活動プラン策定可能。
C (40-59): 一定の適性あり。情報収集から始めることを推奨。
`;

// 優先モデル → フォールバックモデルの順で試行
const MODEL_PRIORITY = [
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b'
];

// ── モデル呼び出し（503/429時は次モデルへ）─────
async function callGemini(apiKey, prompt) {
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of MODEL_PRIORITY) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
          maxOutputTokens: 512
        }
      });
      const result = await model.generateContent(prompt);
      const text   = result.response.text();
      const clean  = text.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(clean);
      console.log(`Gemini OK: model=${modelName}`);
      return parsed;
    } catch (e) {
      const msg = e.message || '';
      // 503 / 429 / RESOURCE_EXHAUSTED は次のモデルへ
      const isRetryable = msg.includes('503') || msg.includes('429') ||
                          msg.includes('high demand') || msg.includes('RESOURCE_EXHAUSTED') ||
                          msg.includes('quota');
      console.error(`Gemini error (model=${modelName}): ${msg}`);
      if (!isRetryable) throw e;   // 致命的エラーはここで打ち切り
      // retryable → 次モデルへ continue
    }
  }
  throw new Error('All Gemini models unavailable');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { answers, mode } = req.body;

  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'answers is required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    return res.status(200).json(buildFallback(mode));
  }

  const isPartner = mode === 'partner';

  const systemContext = isPartner
    ? `あなたはPath-Flowパートナープログラムの適合診断AIです。回答者のパートナーとしての適合スコア・強み・改善点を分析してください。\n${PARTNER_SCORE_GUIDE}`
    : `あなたはPath-Flow（AI診断・予約自動化SaaS）の営業AIです。経営者の課題を分析し、最適なプランを提案してください。\n${MENU_LIST}`;

  const answersText = answers.map((a, i) => `Q${i+1}: ${a}`).join('\n');

  const prompt = `${systemContext}

【診断回答】
${answersText}

以下のJSON形式のみで回答してください。他の文字は一切含めないこと。

{
  "score": <0-100の整数>,
  "level": "<A|B|C>",
  "headline": "<15字以内の診断タイトル>",
  "summary": "<100字以内のサマリー>",
  ${isPartner ? '' : '"recommended_menu": "<メニュー名>",\n  "recommended_price": "<価格表記>",\n  '}
  "pains": [
    {"title": "<課題タイトル>", "desc": "<50字以内の説明>"},
    {"title": "<課題タイトル>", "desc": "<50字以内の説明>"}
  ],
  "benefits": [
    {"title": "<効果タイトル>", "desc": "<50字以内の説明>"},
    {"title": "<効果タイトル>", "desc": "<50字以内の説明>"}
  ]
}`;

  try {
    const parsed = await callGemini(apiKey, prompt);
    return res.status(200).json(parsed);
  } catch (e) {
    console.error('All Gemini models failed:', e.message);
    return res.status(200).json(buildFallback(mode));
  }
}

function buildFallback(mode) {
  const isPartner = mode === 'partner';
  return {
    score: 68,
    level: 'B',
    headline: isPartner ? 'パートナー適性あり' : '営業効率化の余地あり',
    summary: isPartner
      ? 'あなたの経験・環境はPath-Flowパートナーとして十分な適性があります。個別面談でインセンティブ条件をご確認ください。'
      : 'Path-Flowの導入により、24時間AI対応と自動予約で商談機会の損失を防ぎ、営業工数を大幅に削減できます。',
    recommended_menu:  isPartner ? undefined : 'スタンダードプラン',
    recommended_price: isPartner ? undefined : '月額 ¥49,800',
    pains: [
      { title: '機会損失リスク', desc: '夜間・休日の問い合わせ対応遅れが成約率を下げています。' },
      { title: '属人化リスク',   desc: '担当者依存の構造がスケールの妨げになっています。' }
    ],
    benefits: [
      { title: '24時間自動対応', desc: 'AIが即時診断・予約まで完結し機会損失をゼロにします。' },
      { title: 'データ経営の実現', desc: '全接点のデータが蓄積され精度の高い意思決定が可能になります。' }
    ]
  };
}
