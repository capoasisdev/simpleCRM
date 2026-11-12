import { createClient } from '@supabase/supabase-js';

const getEnvVar = (name) => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[name]) {
    return import.meta.env[name];
  }
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name];
  }
  return '';
};

const supabaseUrl = getEnvVar('VITE_SUPABASE_URL');
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('VITE_SUPABASE_PUBLISHABLE_KEY');

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Key is missing in environment variables.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'simplecrm_supabase_auth'
  }
});

// Keep Realtime socket JWT synchronized across initial load and background token refreshes
supabase.auth.onAuthStateChange((_event, session) => {
  try {
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token);
    } else {
      supabase.realtime.setAuth(null);
    }
  } catch (err) {
    console.warn('[Supabase] Unable to sync realtime auth token:', err);
  }
});

/**
 * Attaches a server-minted Supabase Auth session onto the singleton client & realtime channel.
 */
export async function attachSupabaseSession(session) {
  if (!session?.access_token || !session?.refresh_token) {
    return { error: new Error('Missing Supabase access or refresh token.') };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token
  });

  if (!error) {
    try {
      supabase.realtime.setAuth(session.access_token);
    } catch {}
  }

  return { data, error };
}

/**
 * Clears local Supabase Auth tokens and resets realtime authorization.
 */
export async function clearSupabaseSession() {
  try {
    supabase.realtime.setAuth(null);
  } catch {}
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch {}
}
