// api/comments.js — CRUD for listing comments
export default async function handler(req, res) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_KEY;
  const headers = {
    'apikey': SB_KEY,
    'Authorization': `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // ─── GET: fetch comments for a listing ───
  if (req.method === 'GET') {
    const { listing_id } = req.query;
    if (!listing_id) return res.status(400).json({ error: 'Missing listing_id' });

    try {
      const r = await fetch(
        `${SB_URL}/rest/v1/comments?listing_id=eq.${encodeURIComponent(listing_id)}&select=*&order=created_at.asc`,
        { headers }
      );
      const data = await r.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ─── POST: add / edit / delete ───
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, listing_id, comment_id, telegram_user_id, body } = req.body;

  if (!telegram_user_id || !action) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

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

    // ── ADD ──
    if (action === 'add') {
      if (!listing_id || !body || !body.trim()) {
        return res.status(400).json({ error: 'Missing listing_id or body' });
      }
      if (body.length > 500) {
        return res.status(400).json({ error: 'Comment too long (max 500 chars)' });
      }

      const r = await fetch(`${SB_URL}/rest/v1/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          listing_id,
          telegram_user_id,
          user_name: userName,
          body: body.trim()
        })
      });
      const data = await r.json();
      return res.status(201).json({ success: true, comment: data[0] });
    }

    // ── EDIT ──
    if (action === 'edit') {
      if (!comment_id || !body || !body.trim()) {
        return res.status(400).json({ error: 'Missing comment_id or body' });
      }
      if (body.length > 500) {
        return res.status(400).json({ error: 'Comment too long (max 500 chars)' });
      }

      // Verify ownership
      const checkResp = await fetch(
        `${SB_URL}/rest/v1/comments?id=eq.${comment_id}&select=telegram_user_id`,
        { headers }
      );
      const existing = await checkResp.json();
      if (!existing.length) return res.status(404).json({ error: 'Comment not found' });
      if (existing[0].telegram_user_id !== telegram_user_id) {
        return res.status(403).json({ error: 'Not your comment' });
      }

      await fetch(`${SB_URL}/rest/v1/comments?id=eq.${comment_id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          body: body.trim(),
          updated_at: new Date().toISOString()
        })
      });
      return res.status(200).json({ success: true });
    }

    // ── DELETE ──
    if (action === 'delete') {
      if (!comment_id) return res.status(400).json({ error: 'Missing comment_id' });

      // Verify ownership
      const checkResp = await fetch(
        `${SB_URL}/rest/v1/comments?id=eq.${comment_id}&select=telegram_user_id`,
        { headers }
      );
      const existing = await checkResp.json();
      if (!existing.length) return res.status(404).json({ error: 'Comment not found' });
      if (existing[0].telegram_user_id !== telegram_user_id) {
        return res.status(403).json({ error: 'Not your comment' });
      }

      await fetch(`${SB_URL}/rest/v1/comments?id=eq.${comment_id}`, {
        method: 'DELETE',
        headers: { ...headers, 'Prefer': 'return=minimal' }
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
