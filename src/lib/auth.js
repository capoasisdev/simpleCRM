import { attachSupabaseSession, clearSupabaseSession, supabase } from './supabase.js';
import {
  ACTIVE_COMPANY_STORAGE_KEY,
  clearTenantCaches,
  getActiveCompany,
  getActiveCompanyId,
  setActiveCompanyCache
} from './tenant.js';

export { ACTIVE_COMPANY_STORAGE_KEY, clearTenantCaches, getActiveCompany, getActiveCompanyId, setActiveCompanyCache };

/**
 * Clears auth, company, and tenant browser caches cleanly on logout.
 */
export async function clearAuthSessionStorage() {
  try {
    localStorage.removeItem('simplecrm_user_session');
    localStorage.removeItem(ACTIVE_COMPANY_STORAGE_KEY);
  } catch {}
  clearTenantCaches();
  await clearSupabaseSession();
}

/**
 * Enterprise-grade cryptographic helper using the standard Web Crypto API (SubtleCrypto).
 * Provides PBKDF2-HMAC-SHA256 password hashing with random salt and 100,000 iterations.
 * Works natively in all modern web browsers, Node 18+, and Capacitor Android WebViews.
 */

const PBKDF2_ITERATIONS = 100000;
const SALT_BYTE_LENGTH = 16;
const HASH_BIT_LENGTH = 256;

/**
 * Convert a Uint8Array buffer into a hexadecimal string
 */
function bufferToHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Convert a hexadecimal string back into a Uint8Array buffer
 */
function hexToBuffer(hex) {
  if (!hex || hex.length % 2 !== 0) return new Uint8Array();
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Securely hashes a plain-text password using PBKDF2-HMAC-SHA256 with a unique random salt.
 * Output format: `pbkdf2:<iterations>:<saltHex>:<hashHex>`
 *
 * @param {string} password - Raw plain text password
 * @returns {Promise<string>} Encoded hashed password string
 */
export async function hashPassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }

  const cryptoObj = (typeof window !== 'undefined' && window.crypto) || globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error('Web Crypto API (crypto.subtle) is not supported in this environment.');
  }

  const encoder = new TextEncoder();
  const salt = cryptoObj.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const saltHex = bufferToHex(salt);

  const keyMaterial = await cryptoObj.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await cryptoObj.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    HASH_BIT_LENGTH
  );

  const hashHex = bufferToHex(derivedBits);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${saltHex}:${hashHex}`;
}

/**
 * Verifies a plain-text candidate password against a stored PBKDF2 hash string.
 *
 * @param {string} password - Candidate plain text password
 * @param {string} storedHash - Stored hash string (pbkdf2:<iterations>:<saltHex>:<hashHex>)
 * @returns {Promise<boolean>} True if password matches hash
 */
export async function verifyPassword(password, storedHash) {
  if (!password || !storedHash || typeof storedHash !== 'string') {
    return false;
  }

  if (!storedHash.startsWith('pbkdf2:')) {
    return false;
  }

  const parts = storedHash.split(':');
  if (parts.length !== 4) return false;

  const iterations = parseInt(parts[1], 10);
  const saltHex = parts[2];
  const originalHashHex = parts[3];

  if (!iterations || !saltHex || !originalHashHex) return false;

  const cryptoObj = (typeof window !== 'undefined' && window.crypto) || globalThis.crypto;
  if (!cryptoObj?.subtle) return false;

  try {
    const encoder = new TextEncoder();
    const saltBytes = hexToBuffer(saltHex);

    const keyMaterial = await cryptoObj.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await cryptoObj.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: saltBytes,
        iterations,
        hash: 'SHA-256'
      },
      keyMaterial,
      HASH_BIT_LENGTH
    );

    const derivedHashHex = bufferToHex(derivedBits);

    // Constant-time length and character comparison
    if (derivedHashHex.length !== originalHashHex.length) return false;
    let diff = 0;
    for (let i = 0; i < derivedHashHex.length; i++) {
      diff |= derivedHashHex.charCodeAt(i) ^ originalHashHex.charCodeAt(i);
    }
    return diff === 0;
  } catch (err) {
    console.warn('Error during password verification:', err);
    return false;
  }
}

/**
 * Validates password strength & complexity.
 * Minimum 6 characters (recommended 8+).
 */
export function validatePasswordStrength(password) {
  if (!password || typeof password !== 'string') {
    return { isValid: false, message: 'Password cannot be empty.' };
  }
  if (password.length < 6) {
    return { isValid: false, message: 'Password must be at least 6 characters long.' };
  }
  return { isValid: true, message: 'Password meets minimum requirements.' };
}

/**
 * Generates a human-friendly temporary password using the user's name.
 * Format: `FirstName@4Digits` (e.g. "Rahul@4892", "Priya@7103")
 * Meets all complexity requirements (uppercase, lowercase, symbol, 4 numbers).
 *
 * @param {string} name - User's full or first name
 * @returns {string} Human-friendly temporary initial password
 */
export function generateHumanPassword(name = '') {
  const cleanName = (name || '')
    .trim()
    .split(/\s+/)[0]
    .replace(/[^a-zA-Z]/g, '');

  const formattedName = cleanName.length >= 2
    ? cleanName.charAt(0).toUpperCase() + cleanName.slice(1).toLowerCase()
    : 'Welcome';

  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return `${formattedName}@${randomDigits}`;
}

/**
 * Dispatches an automated Welcome & Invitation Email to a newly created team member.
 * Includes their work account ID, human-friendly temporary initial password, and sign-in URL.
 *
 * @param {object} params
 * @param {string} params.name - User's name
 * @param {string} params.email - User's work email
 * @param {string} params.tempPassword - Generated human temporary password
 * @param {string} [params.role] - User's role ('member' | 'admin')
 * @returns {Promise<{ success: boolean, emailSent: boolean, error?: string, reason?: string }>}
 */
export async function sendUserInviteEmail({ name, email, tempPassword, role = 'member' }) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  const userName = (name || '').trim() || 'Team Member';

  if (!trimmedEmail || !trimmedEmail.includes('@')) {
    return { success: false, emailSent: false, error: 'Invalid email address.' };
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const loginUrl = `${window.location.origin}/login`;

    const { data: edgeData, error: edgeError } = await supabase.functions.invoke('auth-password-update', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: {
        action: 'invite_email',
        name: userName,
        email: trimmedEmail,
        tempPassword,
        role,
        loginUrl
      }
    });

    if (edgeError || !edgeData || edgeData.emailSent === false) {
      return {
        success: true,
        emailSent: false,
        reason:
          edgeData?.reason ||
          edgeError?.message ||
          'Failed to dispatch invite email. Please provide the temporary password to the user.'
      };
    }

    return { success: true, emailSent: true };
  } catch (err) {
    console.warn('[Auth] Error sending user invite email:', err);
    return {
      success: true,
      emailSent: false,
      reason: 'Network or configuration error dispatching invite email.'
    };
  }
}

/**
 * Requests a 6-digit OTP password reset code via the server-side auth-password-reset Edge Function.
 * Never exposes crm_users or email_settings to unauthenticated browser clients.
 *
 * @param {string} email - Work account email
 * @returns {Promise<{ success: boolean, emailSent?: boolean, adminContact?: object, error?: string }>}
 */
export async function requestPasswordResetCode(email) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  if (!trimmedEmail) {
    return { success: false, error: 'Please enter your work account email.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('auth-password-reset', {
      body: {
        action: 'request',
        email: trimmedEmail
      }
    });

    if (error) {
      return { success: false, error: error.message || 'Failed to request reset code. Please try again.' };
    }

    return data || { success: false, error: 'Failed to request reset code.' };
  } catch (err) {
    console.error('[Auth] Error during password reset request:', err);
    return { success: false, error: 'Failed to process request. Please try again.' };
  }
}

/**
 * Validates a 6-digit OTP code and updates the user's password via Edge Function.
 *
 * @param {string} email - Work account email
 * @param {string} code - 6-digit verification code
 * @param {string} newPassword - New secure password
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
export async function resetPasswordWithCode(email, code, newPassword) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  const trimmedCode = (code || '').trim().replace(/\D/g, '');

  if (!trimmedEmail || !trimmedCode) {
    return { success: false, error: 'Please enter your email and 6-digit code.' };
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.isValid) {
    return { success: false, error: strength.message };
  }

  try {
    const { data, error } = await supabase.functions.invoke('auth-password-reset', {
      body: {
        action: 'verify',
        email: trimmedEmail,
        code: trimmedCode,
        newPassword
      }
    });

    if (error) {
      return { success: false, error: error.message || 'Failed to verify code. Please try again.' };
    }

    return data || { success: false, error: 'Verification failed.' };
  } catch (err) {
    console.error('[Auth] Error resetting password with code:', err);
    return { success: false, error: 'Unexpected error resetting password.' };
  }
}

/**
 * Generates a cryptographically strong, human-readable random password.
 * E.g. "K8#mQ2$pL9!x"
 */
export function generateRandomPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // excluded ambiguous I, O
  const lower = 'abcdefghijkmnpqrstuvwxyz'; // excluded ambiguous l, o
  const numbers = '23456789'; // excluded 0, 1
  const symbols = '!@#$%^&*';
  const all = upper + lower + numbers + symbols;

  const cryptoObj = (typeof window !== 'undefined' && window.crypto) || globalThis.crypto;
  const values = new Uint32Array(length);
  cryptoObj.getRandomValues(values);

  let pwd = '';
  // Ensure at least one of each category
  pwd += upper[values[0] % upper.length];
  pwd += lower[values[1] % lower.length];
  pwd += numbers[values[2] % numbers.length];
  pwd += symbols[values[3] % symbols.length];

  for (let i = 4; i < length; i++) {
    pwd += all[values[i] % all.length];
  }

  // Shuffle the result
  return pwd.split('').sort(() => 0.5 - Math.random()).join('');
}

/**
 * Dual-Mode User Credential Verification via server Edge Function `auth-login`.
 * Supports PBKDF2 hashed passwords and legacy 4-digit PINs with zero password resets,
 * mints a tenant-scoped Supabase JWT session, and attaches it to REST + Realtime.
 *
 * @param {string} email - User's email
 * @param {string} secretInput - Password or legacy 4-digit PIN
 * @param {object} [options] - Optional configuration ({ attachSession?: boolean })
 * @returns {Promise<{ success: boolean, user?: object, company?: object, isLegacyPin?: boolean, needsPasswordSetup?: boolean, error?: string }>}
 */
export async function verifyUserCredentials(email, secretInput, options = {}) {
  const trimmedEmail = (email || '').trim().toLowerCase();
  const trimmedSecret = (secretInput || '').trim();
  const shouldAttachSession = options.attachSession !== false;

  if (!trimmedEmail || !trimmedSecret) {
    return { success: false, error: 'Please enter both your work account and password or PIN.' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('auth-login', {
      body: {
        action: 'login',
        email: trimmedEmail,
        secret: trimmedSecret,
        mint_session: shouldAttachSession
      }
    });

    if (error) {
      console.error('[Auth] Edge login error:', error);
      return { success: false, error: error.message || 'Authentication service error. Please try again.' };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Incorrect password or 4-digit PIN.' };
    }

    if (shouldAttachSession && data.session?.access_token) {
      const { error: sessionErr } = await attachSupabaseSession(data.session);
      if (sessionErr) {
        console.error('[Auth] Failed attaching Supabase Auth session:', sessionErr);
        return { success: false, error: 'Could not initialize encrypted workspace session. Please try again.' };
      }
    }

    return {
      success: true,
      user: data.user,
      company: data.company || null,
      session: data.session || null,
      isLegacyPin: Boolean(data.isLegacyPin),
      needsPasswordSetup: Boolean(data.needsPasswordSetup)
    };
  } catch (err) {
    console.error('[Auth] Verification unexpected error:', err);
    return { success: false, error: 'Authentication failed. Please try again.' };
  }
}

/**
 * Validates the current Supabase JWT session and returns refreshed user & company metadata.
 */
export async function fetchAuthenticatedProfile() {
  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    if (sessionErr || !token) {
      return { success: false, error: 'NO_AUTH_SESSION' };
    }

    const { data, error } = await supabase.functions.invoke('auth-login', {
      headers: { Authorization: `Bearer ${token}` },
      body: { action: 'session_profile' }
    });

    if (error || !data?.success) {
      if (data?.error === 'INVALID_SESSION' || error?.context?.status === 401) {
        return { success: false, error: 'INVALID_SESSION' };
      }
      return { success: false, error: data?.error || error?.message || 'SESSION_CHECK_FAILED' };
    }

    return {
      success: true,
      user: data.user,
      company: data.company || null
    };
  } catch (err) {
    console.warn('[Auth] Error refreshing authenticated profile:', err);
    return { success: false, error: 'SESSION_CHECK_FAILED' };
  }
}

/**
 * Updates a user's password via the authenticated `auth-password-update` Edge Function.
 *
 * @param {string} userId - User UUID
 * @param {string} newPassword - New plain text password
 * @param {boolean} [clearPin=false] - Whether to nullify the legacy PIN column
 * @returns {Promise<{ success: boolean, user?: object, error?: string }>}
 */
export async function setUserPassword(userId, newPassword, clearPin = false) {
  const strength = validatePasswordStrength(newPassword);
  if (!strength.isValid) {
    return { success: false, error: strength.message };
  }

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    const { data, error } = await supabase.functions.invoke('auth-password-update', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: {
        action: 'set_password',
        userId,
        newPassword,
        clearPin
      }
    });

    if (error) {
      console.error('[Auth] Error setting password via Edge Function:', error);
      return { success: false, error: error.message || 'Failed to update password.' };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Failed to update password.' };
    }

    return { success: true, user: data.user };
  } catch (err) {
    console.error('[Auth] Unexpected error setting password:', err);
    return { success: false, error: err.message || 'Failed to update password.' };
  }
}
