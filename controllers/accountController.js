const supabase = require('../config/supabaseClient');

// --- User Management Endpoints ---
// List all users (admin only or for user management page)
exports.getUsers = async (req, res) => {
  try {
    // Use Supabase Admin API to list users from auth.users
    const { data, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
      console.error('[accounts] getUsers error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    // Map auth users to frontend format
    const users = (data?.users || []).map(u => ({
      id: u.id,
      email: u.email,
      name: u.user_metadata?.full_name || u.user_metadata?.name || '',
      status: u.banned_until ? 'blocked' : (u.email_confirmed_at ? 'active' : 'inactive'),
    }));
    
    console.log('[accounts] returning', users.length, 'users');
    res.json(users);
  } catch (err) {
    console.error('[accounts] getUsers exception:', err);
    res.status(500).json({ error: err.message });
  }
};

// Update user status (admin only)
exports.updateUserStatus = async (req, res) => {
  const { userId } = req.params;
  const { status } = req.body;
  try {
    // Map status to Supabase user ban/unban
    if (status === 'blocked') {
      // Ban user indefinitely
      const { data, error } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: '876000h' // ~100 years
      });
      if (error) return res.status(500).json({ error: error.message });
      console.log('[accounts] User blocked:', userId);
      res.json({ id: userId, status: 'blocked' });
    } else if (status === 'active') {
      // Unban user
      const { data, error } = await supabase.auth.admin.updateUserById(userId, {
        ban_duration: 'none'
      });
      if (error) return res.status(500).json({ error: error.message });
      console.log('[accounts] User activated:', userId);
      res.json({ id: userId, status: 'active' });
    } else {
      // For 'inactive' or other statuses, just return success
      console.log('[accounts] Status update to', status, 'for user:', userId);
      res.json({ id: userId, status });
    }
  } catch (err) {
    console.error('[accounts] updateUserStatus exception:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get current user profile
exports.getUserProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    
    if (error) {
      console.error('[accounts] getUserProfile error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    const user = data.user;
    const profile = {
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || user.user_metadata?.name || '',
      phone: user.phone || user.user_metadata?.phone || '',
    };
    
    console.log('[accounts] returning profile for user:', userId);
    res.json(profile);
  } catch (err) {
    console.error('[accounts] getUserProfile exception:', err);
    res.status(500).json({ error: err.message });
  }
};

// Update current user profile
exports.updateUserProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });
    
    const { name, phone } = req.body;
    
    const updates = {
      user_metadata: {
        full_name: name,
        phone: phone,
      }
    };
    
    if (phone) {
      updates.phone = phone;
    }
    
    const { data, error } = await supabase.auth.admin.updateUserById(userId, updates);
    
    if (error) {
      console.error('[accounts] updateUserProfile error:', error);
      return res.status(500).json({ error: error.message });
    }
    
    console.log('[accounts] Profile updated for user:', userId);
    res.json({ success: true, message: 'Profile updated successfully' });
  } catch (err) {
    console.error('[accounts] updateUserProfile exception:', err);
    res.status(500).json({ error: err.message });
  }
};

function getUserId(req){ return req.user && req.user.id ? req.user.id : null; }

// create account (IMAP credentials or provider info)
async function createAccount(req, res) {
  try {
    const { provider, email, status='pending', meta } = req.body;
    if (!provider || !email) return res.status(400).json({ error: 'provider and email required' });

    // IMPORTANT: if you store secret credentials (passwords / tokens), you should encrypt them.
    const payload = { user_id: getUserId(req), provider, email, status, meta };

    const { data, error } = await supabase.from('accounts').insert(payload).select().single();

    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('row-level security')) {
        return res.status(403).json({
          error: 'RLS blocked insert on accounts. Configure a server-side service role key or add an insert policy.',
          hint: 'Set SUPABASE_SERVICE_ROLE_KEY in Backend/.env for the backend only, or create an insert policy for table accounts.'
        });
      }
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function listAccounts(req, res) {
  try {
    let q = supabase.from('accounts').select('*').order('created_at', { ascending: false });
    const userId = getUserId(req);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function getAccount(req, res) {
  try {
    const { id } = req.params;
    let q = supabase.from('accounts').select('*').eq('id', id);
    const userId = getUserId(req);
    if (userId) q = q.eq('user_id', userId);
    const { data, error } = await q.single();
    if (error) return res.status(404).json({ error: 'Account not found' });
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function updateAccount(req, res) {
  try {
    const { id } = req.params;
    const updates = req.body;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('accounts').update(updates).eq('id', id).eq('user_id', getUserId(req)).select().single();
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

async function deleteAccount(req, res) {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('accounts').delete().eq('id', id).eq('user_id', getUserId(req));
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}

module.exports = { 
  createAccount, 
  listAccounts, 
  getAccount, 
  updateAccount, 
  deleteAccount,
  getUsers: exports.getUsers,
  updateUserStatus: exports.updateUserStatus,
  getUserProfile: exports.getUserProfile,
  updateUserProfile: exports.updateUserProfile
};
