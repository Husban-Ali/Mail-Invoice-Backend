const { createClient } = require('@supabase/supabase-js');
const { env } = require('../config/env');

function getClients() {
  const url = env.SUPABASE_URL;
  const anon = env.SUPABASE_ANON_KEY;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon) throw new Error('Supabase env vars missing (SUPABASE_URL / SUPABASE_ANON_KEY)');
  const supabaseAnon = createClient(url, anon);
  const supabaseAdmin = service ? createClient(url, service) : null;
  return { supabaseAnon, supabaseAdmin };
}

const signUpUser = async (name, email, password) => {
  // Basic input validation (server-side)
  if (!name || !email || !password) {
    throw new Error('Name, email and password are required');
  }
  const emailRegex = /^\S+@\S+\.\S+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  const { supabaseAnon, supabaseAdmin } = getClients();

  // If we have a service role client, prefer using admin API (server-side)
  if (supabaseAdmin) {
    try {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        user_metadata: { full_name: name },
        email_confirm: true,
      });
      console.log('supabase admin create response:', { data, error });
      if (error) {
        const msg = error.message || '';
        if (/already exists/i.test(msg) || (error.details && /already exists/i.test(error.details))) {
          throw new Error('Email is already registered');
        }
        throw new Error(msg || 'Failed to create user');
      }
      return data.user || data;
    } catch (err) {
      throw new Error(err.message || 'Signup failed');
    }
  }

  // Fallback to anon signUp
  const { data, error } = await supabaseAnon.auth.signUp({
    email,
    password,
    options: { data: { full_name: name } },
  });

  // debug log to aid diagnosing Supabase errors
  console.log('signUp response:', { data, error });

  if (error) throw new Error(error.message || JSON.stringify(error));
  return data.user || data;
};

const signInUser = async (email, password) => {
  if (!email || !password) throw new Error('Email and password are required');

  const { supabaseAnon } = getClients();
  const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password });
  console.log('signIn response:', { data, error });
  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('email') && msg.includes('confirm')) {
      throw new Error('Email not confirmed. Please verify your email before logging in.');
    }
    if (msg.includes('invalid login credentials')) {
      throw new Error('Invalid email or password');
    }
    throw new Error(error.message || JSON.stringify(error));
  }
  return data.session;
};

const getOrCreateGoogleUser = async (email, name, googleProfile) => {
  const { supabaseAnon, supabaseAdmin } = getClients();
  
  try {
    // Try to sign in with OAuth provider (Supabase handles Google OAuth)
    // First, check if user exists
    if (supabaseAdmin) {
      // Use admin client to check if user exists
      const { data: existingUser, error: fetchError } = await supabaseAdmin.auth.admin.getUserByEmail(email);
      
      if (!existingUser || fetchError) {
        // User doesn't exist, create them
        console.log('[oauth] Creating new user for:', email);
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: {
            full_name: name,
            avatar_url: googleProfile.photos?.[0]?.value,
            provider: 'google'
          }
        });
        
        if (createError) {
          console.error('[oauth] Error creating user:', createError);
          throw new Error(createError.message);
        }
        
        console.log('[oauth] User created:', newUser.user.id);
      } else {
        console.log('[oauth] User exists:', existingUser.user.id);
      }
      
      // Generate a session using admin client
      const { data: sessionData, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email
      });
      
      if (sessionError) {
        console.error('[oauth] Error generating session:', sessionError);
        throw new Error(sessionError.message);
      }
      
      // Now sign in with anon client to get a proper session
      const { data: signInData, error: signInError } = await supabaseAnon.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false
        }
      });
      
      // Instead of OTP, let's use admin to create a session directly
      // Create a temporary password and sign in
      const tempPassword = require('crypto').randomBytes(32).toString('hex');
      
      // Update user password
      await supabaseAdmin.auth.admin.updateUserById(
        existingUser?.user?.id || newUser?.user?.id,
        { password: tempPassword }
      );
      
      // Sign in with the temporary password
      const { data: finalSession, error: finalError } = await supabaseAnon.auth.signInWithPassword({
        email,
        password: tempPassword
      });
      
      if (finalError) {
        console.error('[oauth] Error signing in:', finalError);
        throw new Error(finalError.message);
      }
      
      return finalSession.session;
    }
    
    throw new Error('Admin client not available for OAuth');
  } catch (error) {
    console.error('[oauth] getOrCreateGoogleUser error:', error);
    throw error;
  }
};

module.exports = { signUpUser, signInUser, getOrCreateGoogleUser };
