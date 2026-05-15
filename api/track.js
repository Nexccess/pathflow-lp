module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const gasUrl = process.env.GAS_WEBHOOK_URL;
  if (!gasUrl) return res.status(200).json({ ok: true });

  try {
    await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...req.body,
        timestamp: new Date().toISOString()
      })
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: true }); // トラッキング失敗はサイレント
  }
};
