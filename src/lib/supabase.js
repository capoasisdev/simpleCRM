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

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
