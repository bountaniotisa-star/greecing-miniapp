// api/claim.js — Claim/Unclaim a listing + notify admin via Telegram + log to assignments
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { listing_id, telegram_user_id, action } = req.body;

  if (!listing_id || !telegram_user_id || !['claim', 'unclaim'].includes(action)) {
    return res.status(400).json({ error: 'Missing or invalid parameters' });
  }

  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_KEY;
  const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  try {
    // Verify user is approved
    const userResp = await fetch(
      `${SB_URL}/rest/v1/app_users?telegram_user_id=eq.${telegram_user_id}&select=status,first_name,last_name,username`,
      { headers }
    );
    const users = await userResp.json();

    if (!users.length || users[0].status !== 'approved') {
      return res.status(403).json({ error: 'User not approved' });
    }

    const userName = [users[0].first_name, users[0].last_name].filter(Boolean).join(' ');
    const userTag = users[0].username ? `@${users[0].username}` : `ID: ${telegram_user_id}`;

    if (action === 'claim') {
      const checkResp = await fetch(
        `${SB_URL}/rest/v1/listings?listing_id=eq.${listing_id}&select=claimed_by,property_type,area,price,square_meters,listing_url`,
        { headers }
      );
      const listing = await checkResp.json();

      if (listing[0]?.claimed_by && listing[0].claimed_by !== telegram_user_id) {
        return res.status(409).json({ error: 'Already claimed by another user' });
      }

      // Update listing
      await fetch(
        `${SB_URL}/rest/v1/listings?listing_id=eq.${listing_id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            claimed_by: telegram_user_id,
            claimed_by_name: userName,
            claimed_at: new Date().toISOString()
          })
        }
      );

      // Log to assignments table
      const l = listing[0] || {};
      try {
        await fetch(`${SB_URL}/rest/v1/assignments`, {
          method: 'POST',
          headers: { ...headers, 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            listing_id,
            telegram_user_id,
            agent_name: userName,
            agent_username: users[0].username || null,
            property_type: l.property_type || null,
            area: l.area || null,
            price: l.price || null,
            square_meters: l.square_meters || null,
            listing_url: l.listing_url || `https://www.spitogatos.gr/aggelia/${listing_id}`,
            status: 'active',
            claimed_at: new Date().toISOString()
          })
        });
      } catch (aErr) {
        console.error('Assignment log error:', aErr);
      }

      // Notify admin via Telegram
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const price = l.price ? new Intl.NumberFormat('el-GR').format(Math.round(l.price)) + '€' : 'N/A';
        const sqm = l.square_meters ? `${l.square_meters}τμ` : '';
        const propInfo = [l.property_type, sqm, l.area].filter(Boolean).join(' · ');
        const link = l.listing_url || `https://www.spitogatos.gr/aggelia/${listing_id}`;

        const text = `🤝 <b>Νέα Ανάθεση</b>\n\n`
          + `👤 <b>${userName}</b> (${userTag})\n`
          + `🏠 ${propInfo}\n`
          + `💰 ${price}\n`
          + `🔗 <a href="${link}">Δες αγγελία</a>`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text,
              parse_mode: 'HTML',
              disable_web_page_preview: true
            })
          });
        } catch (tgErr) {
          console.error('Telegram notification error:', tgErr);
        }
      }
    } else {
      // Unclaim
      const checkResp = await fetch(
        `${SB_URL}/rest/v1/listings?listing_id=eq.${listing_id}&claimed_by=eq.${telegram_user_id}&select=property_type,area,price`,
        { headers }
      );
      const listing = await checkResp.json();

      await fetch(
        `${SB_URL}/rest/v1/listings?listing_id=eq.${listing_id}&claimed_by=eq.${telegram_user_id}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            claimed_by: null,
            claimed_by_name: null,
            claimed_at: null
          })
        }
      );

      // Update assignments table — mark as released
      try {
        await fetch(
          `${SB_URL}/rest/v1/assignments?listing_id=eq.${listing_id}&telegram_user_id=eq.${telegram_user_id}&status=eq.active`,
          {
            method: 'PATCH',
            headers,
            body: JSON.stringify({
              status: 'released',
              released_at: new Date().toISOString()
            })
          }
        );
      } catch (aErr) {
        console.error('Assignment update error:', aErr);
      }

      // Notify admin about unclaim
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID && listing.length) {
        const l = listing[0];
        const price = l.price ? new Intl.NumberFormat('el-GR').format(Math.round(l.price)) + '€' : 'N/A';
        const text = `↩️ <b>Ακύρωση Ανάθεσης</b>\n\n`
          + `👤 <b>${userName}</b> (${userTag})\n`
          + `🏠 ${[l.property_type, l.area].filter(Boolean).join(' · ')}\n`
          + `💰 ${price}`;

        try {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text,
              parse_mode: 'HTML'
            })
          });
        } catch (tgErr) {
          console.error('Telegram notification error:', tgErr);
        }
      }
    }

    return res.status(200).json({ success: true, listing_id, action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
