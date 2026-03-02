// api/claim.js
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
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };

  try {
    // Verify user is approved
    const userResp = await fetch(
      `${SB_URL}/rest/v1/app_users?telegram_user_id=eq.${telegram_user_id}&select=status,first_name,last_name`,
      { headers }
    );
    const users = await userResp.json();

    if (!users.length || users[0].status !== 'approved') {
      return res.status(403).json({ error: 'User not approved' });
    }

    const userName = [users[0].first_name, users[0].last_name].filter(Boolean).join(' ');

    if (action === 'claim') {
      // Check if already claimed by someone else
      const checkResp = await fetch(
        `${SB_URL}/rest/v1/listings?listing_id=eq.${listing_id}&select=claimed_by`,
        { headers }
      );
      const listing = await checkResp.json();

      if (listing[0]?.claimed_by && listing[0].claimed_by !== telegram_user_id) {
        return res.status(409).json({ error: 'Already claimed by another user' });
      }

      // Claim it
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
    } else {
      // Unclaim - only if same user
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
    }

    return res.status(200).json({ success: true, listing_id, action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
