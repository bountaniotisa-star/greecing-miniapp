// ═══════════════════════════════════════════════
// Greecing Real Estate — Health Check
// ═══════════════════════════════════════════════

export default async function handler(req, res) {
  const { SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;

  const checks = {
    supabase_url: !!SUPABASE_URL,
    supabase_key: !!SUPABASE_KEY,
    telegram_bot: !!TELEGRAM_BOT_TOKEN,
    telegram_chat: !!TELEGRAM_CHAT_ID,
    timestamp: new Date().toISOString()
  };

  // Test Supabase connectivity
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/listings?select=listing_id&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      checks.supabase_connected = r.ok;
      checks.supabase_status = r.status;
    } catch (e) {
      checks.supabase_connected = false;
      checks.supabase_error = e.message;
    }
  }

  // Test Telegram Bot
  if (TELEGRAM_BOT_TOKEN) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`);
      const data = await r.json();
      checks.telegram_connected = data.ok;
      if (data.ok) checks.telegram_bot_name = data.result.username;
    } catch (e) {
      checks.telegram_connected = false;
      checks.telegram_error = e.message;
    }
  }

  const allOk = checks.supabase_connected && checks.telegram_connected;
  return res.status(allOk ? 200 : 503).json({
    status: allOk ? 'healthy' : 'degraded',
    ...checks
  });
}
