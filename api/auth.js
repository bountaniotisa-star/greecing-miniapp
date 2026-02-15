// ═══════════════════════════════════════════════
// Greecing Real Estate — User Auth / Registration
// ═══════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS for Mini App
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ error: 'Missing env vars' });
  }

  try {
    const { telegram_user_id, username, first_name, last_name } = req.body || {};
    if (!telegram_user_id) return res.status(400).json({ error: 'Missing telegram_user_id' });

    const uid = String(telegram_user_id);

    // ─── Check if user exists ───
    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/app_users?telegram_user_id=eq.${uid}&select=*`,
      { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
    );
    if (!checkRes.ok) throw new Error(`Supabase check error: ${checkRes.status}`);
    const users = await checkRes.json();

    if (users.length > 0) {
      // User exists — return current status
      return res.status(200).json({ status: users[0].status });
    }

    // ─── New user — insert as pending ───
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/app_users`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        telegram_user_id: uid,
        username: username || null,
        first_name: first_name || null,
        last_name: last_name || null,
        status: 'pending'
      })
    });
    if (!insertRes.ok) {
      const errText = await insertRes.text();
      throw new Error(`Supabase insert error: ${insertRes.status} — ${errText}`);
    }

    // ─── Notify admin via Telegram ───
    const displayName = first_name
      ? `${first_name}${last_name ? ' ' + last_name : ''}`
      : 'Άγνωστο';
    const userTag = username ? `@${username}` : 'χωρίς username';

    const text = `🆕 <b>Νέο αίτημα πρόσβασης</b>\n\n`
      + `👤 <b>${displayName}</b> (${userTag})\n`
      + `🆔 ID: <code>${uid}</code>\n\n`
      + `Θέλεις να εγκρίνεις αυτόν τον χρήστη;`;

    const keyboard = {
      inline_keyboard: [[
        { text: '✅ Έγκριση', callback_data: `approve_${uid}` },
        { text: '❌ Απόρριψη', callback_data: `reject_${uid}` }
      ]]
    };

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
        reply_markup: keyboard
      })
    });

    return res.status(200).json({ status: 'pending' });

  } catch (error) {
    console.error('Auth error:', error);
    return res.status(500).json({ error: error.message });
  }
}
