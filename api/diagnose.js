// api/diagnose.js  – v3.4準拠
// Gemini 3段フォールバック: gemini-2.5-flash-lite → gemini-1.5-flash → gemini-1.5-flash-8b
const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { answers, mode } = req.body;
  if (!answers || !Array.isArray(answers)) return res.status(400).json({ error: 'Invalid answers' });

  const totalScore = answers.reduce((s, a) => s + (parseInt(a.score) || 0), 0);
  const level = totalScore >= 14 ? 'A' : totalScore >= 9 ? 'B' : 'C';

  const MENUS = mode === 'partner' ? [
    { name: 'パートナー個別相談（30分）', price: '無料' },
    { name: 'Path-Flow 導入プレゼン',    price: '無料' },
    { name: 'Path-Flow 標準パッケージ',  price: '要見積' },
  ] : [
    { name: 'AI診断・自動予約 導入相談（30分）', price: '無料' },
    { name: 'Path-Flow スターターパッケージ',    price: '要見積' },
    { name: 'Path-Flow フルパッケージ',          price: '450万円〜' },
  ];

  const menuList   = MENUS.map(m => `・${m.name}（${m.price}）`).join('\n');
  const answerText = answers.map((a, i) => `Q${i + 1}: ${a.text}`).join('\n');
  const isPartner  = mode === 'partner';

  const prompt = `あなたはPath-Flowの営業コンサルタントです。
${isPartner ? '代理店・パートナー候補' : '中小企業経営者'}の診断回答を分析し、最適なメニューを1つ推薦してください。

回答:
${answerText}

スコア: ${totalScore} / レベル: ${level}

利用可能なメニュー:
${menuList}

必ず以下のJSON形式のみで回答してください。マークダウン・コードブロック・前置き文は一切不要です:
{"score":${totalScore},"level":"${level}","recommended_menu":"メニュー名をそのまま記載","recommended_price":"価格をそのまま記載","headline":"20字以内の課題見出し","reason":"推薦理由を2文で","pains":[{"title":"課題タイトル","desc":"50字以内"},{"title":"課題タイトル","desc":"50字以内"}]}`;

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // 3段フォールバック（v3.4 §5-2）
  for (const modelName of MODELS) {
    try {
      const model  = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      const text   = result.response.text().replace(/```json|```/g, '').trim();
      const match  = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      const data = JSON.parse(match[0]);
      console.log(`Gemini OK: ${modelName}`);
      return res.status(200).json(data);
    } catch (err) {
      const code = err?.status || err?.message || '';
      console.warn(`Gemini ${modelName} failed: ${code}`);
      // 429/503 → 次モデルへ。それ以外はフォールバックへ
      if (String(code).includes('429') || String(code).includes('503') || String(code).includes('No JSON')) continue;
      break;
    }
  }

  // ルールベースフォールバック（全モデル失敗時）
  console.error('All Gemini models failed. Using rule-based fallback.');
  const menuIdx = level === 'A' ? 2 : 0;
  const menu    = MENUS[menuIdx];
  return res.status(200).json({
    score: totalScore,
    level,
    recommended_menu:   menu.name,
    recommended_price:  menu.price,
    headline:  level === 'A' ? '営業自動化の即戦力候補' : level === 'B' ? '営業効率化の余地あり' : '基盤整備が最優先',
    reason:    'Path-Flowの導入により、AI診断と自動予約で営業工数を大幅に削減し、商談化率の向上が見込めます。まずは無料相談でご確認ください。',
    pains: [
      { title: '機会損失リスク', desc: '夜間・休日の問い合わせへの対応遅れが成約率を下げています。' },
      { title: '属人化リスク',   desc: '担当者依存の営業構造はスケールの妨げになります。' },
    ],
  });
}
