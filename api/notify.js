// ═══════════════════════════════════════════════
// Greecing Real Estate — Telegram Notifications
// Vercel Serverless Function (Cron)
// ═══════════════════════════════════════════════

const EMOJI = {
  'Διαμέρισμα': '🏢', 'Μονοκατοικία': '🏡', 'Μεζονέτα': '🏘️',
  'Γραφείο': '🏢', 'Κατάστημα': '🏪', 'Γκαρσονιέρα': '🏠', 'οικία': '🏡', 'Βίλα': '🏠'
};

function fmt(n) {
  return n != null ? new Intl.NumberFormat('el-GR').format(Math.round(n)) + '€' : 'N/A';
}

async function querySupabase(url, key, query) {
  const res = await fetch(`${url}/rest/v1/listings?${query}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status} ${res.statusText}`);
  return res.json();
}

async function sendTelegram(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram error: ${res.status} — ${err}`);
  }
  return res.json();
}

function formatListingLine(l) {
  const em = EMOJI[l.property_type] || '🏠';
  const sqm = l.square_meters ? ` ${l.square_meters}τμ` : '';
  const area = l.area || '';
  return `• ${em} ${l.property_type || ''}${sqm} — ${fmt(l.price)} — ${area}`;
}

function formatPriceDropLine(l) {
  const em = EMOJI[l.property_type] || '🏠';
  const oldPrice = l.price - (l.price_change || 0);
  const pct = oldPrice > 0 ? ((Math.abs(l.price_change) / oldPrice) * 100).toFixed(1) : '?';
  return `• ${em} ${l.property_type || ''} ${l.area || ''}: ${fmt(oldPrice)} → ${fmt(l.price)} (-${pct}%)`;
}

function formatPriceUpLine(l) {
  const em = EMOJI[l.property_type] || '🏠';
  const oldPrice = l.price - (l.price_change || 0);
  const pct = oldPrice > 0 ? ((l.price_change / oldPrice) * 100).toFixed(1) : '?';
  return `• ${em} ${l.property_type || ''} ${l.area || ''}: ${fmt(oldPrice)} → ${fmt(l.price)} (+${pct}%)`;
}

export default async function handler(req, res) {
  // ─── Auth: Vercel cron sends Authorization header ───
  const authHeader = req.headers['authorization'];
  const isVercelCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManualTrigger = req.query.key === process.env.CRON_SECRET;

  if (!isVercelCron && !isManualTrigger && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    SUPABASE_URL,
    SUPABASE_KEY,
    TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHAT_ID,
    NOTIFY_INTERVAL_HOURS = '6',
    APP_URL = ''
  } = process.env;

  // ─── Validate env vars ───
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing Supabase credentials' });
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ error: 'Missing Telegram credentials' });
  }

  try {
    const hours = parseInt(NOTIFY_INTERVAL_HOURS) || 6;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    // ─── Query new listings ───
    const newListings = await querySupabase(
      SUPABASE_URL, SUPABASE_KEY,
      `select=*&change_type=eq.NEW&first_seen_date=gte.${since}&order=price.desc&limit=20`
    );

    // ─── Query price drops ───
    const priceDrops = await querySupabase(
      SUPABASE_URL, SUPABASE_KEY,
      `select=*&change_type=eq.PRICE_DROP&last_seen_date=gte.${since}&order=price_change.asc&limit=15`
    );

    // ─── Query price increases ───
    const priceUps = await querySupabase(
      SUPABASE_URL, SUPABASE_KEY,
      `select=*&change_type=eq.PRICE_UP&last_seen_date=gte.${since}&order=price_change.desc&limit=10`
    );

    // ─── Build message ───
    const hasNew = newListings.length > 0;
    const hasDrops = priceDrops.length > 0;
    const hasUps = priceUps.length > 0;

    if (!hasNew && !hasDrops && !hasUps) {
      return res.status(200).json({
        message: 'No updates to notify',
        checked_since: since,
        new: 0, drops: 0, ups: 0
      });
    }

    let msg = '🏠 <b>Greecing Real Estate — Ενημέρωση</b>\n';
    msg += `📅 Τελευταίες ${hours} ώρες\n\n`;

    if (hasNew) {
      msg += `📢 <b>${newListings.length} νέες αγγελίες:</b>\n`;
      msg += newListings.slice(0, 10).map(formatListingLine).join('\n');
      if (newListings.length > 10) msg += `\n  ...και ${newListings.length - 10} ακόμη`;
      msg += '\n\n';
    }

    if (hasDrops) {
      msg += `📉 <b>${priceDrops.length} μειώσεις τιμών:</b>\n`;
      msg += priceDrops.slice(0, 8).map(formatPriceDropLine).join('\n');
      if (priceDrops.length > 8) msg += `\n  ...και ${priceDrops.length - 8} ακόμη`;
      msg += '\n\n';
    }

    if (hasUps) {
      msg += `📈 <b>${priceUps.length} αυξήσεις τιμών:</b>\n`;
      msg += priceUps.slice(0, 5).map(formatPriceUpLine).join('\n');
      if (priceUps.length > 5) msg += `\n  ...και ${priceUps.length - 5} ακόμη`;
      msg += '\n\n';
    }

    if (APP_URL) {
      msg += `🔗 <a href="${APP_URL}">Άνοιξε την εφαρμογή</a>`;
    }

    // ─── Send to Telegram ───
    await sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, msg);

    return res.status(200).json({
      success: true,
      checked_since: since,
      new: newListings.length,
      drops: priceDrops.length,
      ups: priceUps.length
    });

  } catch (error) {
    console.error('Notification error:', error);
    return res.status(500).json({ error: error.message });
  }
                                                                                     }
