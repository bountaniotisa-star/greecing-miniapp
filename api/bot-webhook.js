// ═══════════════════════════════════════════════
// Greecing Real Estate — Telegram Bot Webhook
// Handles approval/rejection callback queries
// ═══════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).json({ ok: true });

  const { SUPABASE_URL, SUPABASE_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!SUPABASE_URL || !SUPABASE_KEY || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(200).json({ ok: false, error: 'Missing env' });
  }

  try {
    const update = req.body;
    if (!update) return res.status(200).json({ ok: true });

    // ─── Handle callback queries (Approve / Reject buttons) ───
    if (update.callback_query) {
      const cb = update.callback_query;
      const fromId = String(cb.from.id);
      const adminId = String(TELEGRAM_CHAT_ID);

      // Only admin can approve/reject
      if (fromId !== adminId) {
        await answerCallback(TELEGRAM_BOT_TOKEN, cb.id, '⛔ Μόνο ο admin μπορεί να κάνει αυτή την ενέργεια.');
        return res.status(200).json({ ok: true });
      }

      const data = cb.data || '';
      const isApprove = data.startsWith('approve_');
      const isReject = data.startsWith('reject_');
      if (!isApprove && !isReject) {
        return res.status(200).json({ ok: true });
      }

      const userId = data.replace('approve_', '').replace('reject_', '');
      const newStatus = isApprove ? 'approved' : 'rejected';

      // Update user status in Supabase
      const patchBody = { status: newStatus };
      if (isApprove) patchBody.approved_at = new Date().toISOString();

      const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/app_users?telegram_user_id=eq.${userId}`,
        {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(patchBody)
        }
      );

      if (!patchRes.ok) {
        const errText = await patchRes.text();
        console.error('Supabase patch error:', errText);
        await answerCallback(TELEGRAM_BOT_TOKEN, cb.id, '❌ Σφάλμα βάσης δεδομένων');
        return res.status(200).json({ ok: false });
      }

      const updated = await patchRes.json();
      const user = updated[0] || {};
      const name = user.first_name || 'Χρήστης';
      const tag = user.username ? `@${user.username}` : `ID: ${userId}`;

      // Answer callback
      const emoji = isApprove ? '✅' : '❌';
      await answerCallback(TELEGRAM_BOT_TOKEN, cb.id, `${emoji} ${isApprove ? 'Εγκρίθηκε' : 'Απορρίφθηκε'}!`);

      // Edit original message to show result
      const newText = isApprove
        ? `✅ <b>Εγκρίθηκε:</b> ${name} (${tag})`
        : `❌ <b>Απορρίφθηκε:</b> ${name} (${tag})`;

      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cb.message.chat.id,
          message_id: cb.message.message_id,
          text: newText,
          parse_mode: 'HTML'
        })
      });

      return res.status(200).json({ ok: true, action: newStatus });
    }

    // ─── Handle /start command ───
    if (update.message && update.message.text === '/start') {
      const chatId = update.message.chat.id;
      await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: '👋 Καλωσήρθες στο <b>Private Adds Attica</b>!\n\nΆνοιξε τις αγγελίες πατώντας το κουμπί <b>🏠 Αγγελίες</b> στο μενού.',
          parse_mode: 'HTML'
        })
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(200).json({ ok: false, error: error.message });
  }
}

async function answerCallback(token, callbackId, text) {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackId, text, show_alert: false })
  });
}
