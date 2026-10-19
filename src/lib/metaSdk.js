/**
 * Meta (Facebook) JavaScript SDK & Graph API Helper
 */

const DEFAULT_APP_ID = import.meta.env.VITE_META_APP_ID || '977193864751819';
const DEFAULT_APP_SECRET = import.meta.env.VITE_META_APP_SECRET || '';
const API_VERSION = 'v20.0';

let isSdkLoading = false;
let sdkPromise = null;

export const loadMetaSdk = (appId = DEFAULT_APP_ID) => {
  if (window.FB) {
    return Promise.resolve(window.FB);
  }

  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = function () {
      window.FB.init({
        appId: appId || DEFAULT_APP_ID,
        cookie: true,
        xfbml: true,
        version: API_VERSION
      });
      resolve(window.FB);
    };

    if (document.getElementById('facebook-jssdk')) {
      return;
    }

    const js = document.createElement('script');
    js.id = 'facebook-jssdk';
    js.src = 'https://connect.facebook.net/en_US/sdk.js';
    js.async = true;
    js.defer = true;
    js.onerror = (err) => reject(new Error('Failed to load Facebook SDK. Check your internet or ad-blocker.'));
    document.body.appendChild(js);
  });

  return sdkPromise;
};

/**
 * Trigger Facebook Login for Business dialog requesting lead retrieval permissions
 */
export const loginWithMeta = async (appId = DEFAULT_APP_ID) => {
  const FB = await loadMetaSdk(appId);
  return new Promise((resolve, reject) => {
    FB.login(
      (response) => {
        if (response.authResponse) {
          resolve(response.authResponse);
        } else {
          const msg = response.status === 'not_authorized'
            ? 'Login was not authorized by Meta.'
            : 'Facebook login was cancelled.';
          reject(new Error(msg));
        }
      },
      {
        scope: 'pages_show_list,pages_read_engagement,pages_manage_ads,leads_retrieval,pages_manage_metadata,ads_read',
        return_scopes: true
      }
    );
  });
};

/**
 * Fetch Facebook Pages managed by the authenticated user (with pagination support)
 */
export const fetchUserPages = async (userAccessToken) => {
  let allPages = [];
  let url = `https://graph.facebook.com/${API_VERSION}/me/accounts?fields=id,name,access_token,category&limit=100&access_token=${userAccessToken}`;

  while (url && allPages.length < 500) {
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) {
      if (allPages.length > 0) break;
      throw new Error(data.error.message || 'Failed to fetch Facebook Pages.');
    }
    if (Array.isArray(data.data)) {
      allPages = allPages.concat(data.data);
    }
    url = data.paging?.next || null;
  }
  return allPages;
};

/**
 * Automatically subscribe the CRM Webhook to the Facebook Page for leadgen events
 */
export const subscribePageWebhook = async (pageId, pageAccessToken) => {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${pageAccessToken}`,
      { method: 'POST' }
    );
    const data = await res.json();
    return data?.success || false;
  } catch (err) {
    console.warn('Webhook auto-subscription notice:', err);
    return false;
  }
};

/**
 * Fetch all active lead forms for a given Page from Meta Graph API
 */
export const fetchPageLeadForms = async (pageId, pageAccessToken) => {
  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${pageId}/leadgen_forms?fields=id,name,status,created_time&limit=100&access_token=${pageAccessToken}`
  );
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || 'Failed to fetch Lead Forms from Meta.');
  }
  return data.data || [];
};

/**
 * Fetch Ad Accounts accessible to the authenticated user
 */
export const fetchUserAdAccounts = async (userAccessToken) => {
  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/me/adaccounts?fields=id,name,account_id&limit=100&access_token=${userAccessToken}`
    );
    const data = await res.json();
    return data.data || [];
  } catch (err) {
    console.warn('Could not fetch ad accounts:', err);
    return [];
  }
};

/**
 * Validate an access token against Meta Graph API
 */
export const validateMetaToken = async (token) => {
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { isValid: false, message: 'No access token configured.' };
  }
  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/me?fields=id,name&access_token=${token.trim()}`
    );
    const data = await res.json();
    if (data.error) {
      return {
        isValid: false,
        code: data.error.code,
        subcode: data.error.error_subcode,
        message: data.error.message || 'Token is invalid or expired.'
      };
    }
    return {
      isValid: true,
      id: data.id,
      name: data.name
    };
  } catch (err) {
    return {
      isValid: false,
      message: err.message || 'Failed to connect to Meta Graph API.'
    };
  }
};

/**
 * Exchange short-lived token for 60-day long-lived token
 */
export const exchangeForLongLivedUserToken = async (shortUserToken, appId = DEFAULT_APP_ID, appSecret = DEFAULT_APP_SECRET) => {
  const secret = appSecret || DEFAULT_APP_SECRET;
  if (!secret) return shortUserToken;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${secret}&fb_exchange_token=${shortUserToken}`
    );
    const data = await res.json();
    if (data.access_token) {
      return data.access_token;
    }
  } catch (e) {
    console.warn('Could not exchange for long-lived token:', e);
  }
  return shortUserToken;
};

/**
 * Trigger Facebook / Meta Login requesting WhatsApp Business Management permissions
 * (WhatsApp Embedded Signup / Onboarding flow)
 */
export const loginWithWhatsApp = async (appId = DEFAULT_APP_ID) => {
  const FB = await loadMetaSdk(appId);

  return new Promise((resolve, reject) => {
    let embeddedSignupData = null;

    // Listen for Meta Embedded Signup message events (if using embedded signup popup)
    const messageListener = (event) => {
      if (
        event.origin !== 'https://www.facebook.com' &&
        event.origin !== 'https://web.facebook.com'
      ) {
        return;
      }
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data && (data.type === 'WA_EMBEDDED_SIGNUP' || data.event === 'WA_EMBEDDED_SIGNUP')) {
          embeddedSignupData = data.data || data;
        }
      } catch (e) { }
    };

    window.addEventListener('message', messageListener);

    FB.login(
      (response) => {
        window.removeEventListener('message', messageListener);

        if (response.authResponse) {
          resolve({
            authResponse: response.authResponse,
            accessToken: response.authResponse.accessToken,
            embeddedData: embeddedSignupData
          });
        } else {
          const msg =
            response.status === 'not_authorized'
              ? 'WhatsApp access was not authorized by Meta.'
              : 'WhatsApp connection was cancelled.';
          reject(new Error(msg));
        }
      },
      {
        scope: 'whatsapp_business_management,whatsapp_business_messaging',
        return_scopes: true
      }
    );
  });
};

/**
 * Fetch WhatsApp Business Accounts (WABAs) and phone numbers accessible by the authenticated user
 */
export const fetchUserWhatsAppAccounts = async (userAccessToken) => {
  const accounts = [];

  // Query businesses with owned WhatsApp Business Accounts & phone numbers
  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status,quality_rating}}&limit=50&access_token=${userAccessToken}`
    );
    const data = await res.json();

    if (data.data && Array.isArray(data.data)) {
      data.data.forEach((biz) => {
        const wabas = biz.owned_whatsapp_business_accounts?.data || [];
        wabas.forEach((waba) => {
          const phones = waba.phone_numbers?.data || [];
          phones.forEach((phone) => {
            accounts.push({
              businessId: biz.id,
              businessName: biz.name,
              wabaId: waba.id,
              wabaName: waba.name || biz.name,
              phoneId: phone.id,
              displayNumber: phone.display_phone_number || phone.id,
              verifiedName: phone.verified_name || waba.name || biz.name,
              status: phone.code_verification_status || 'VERIFIED',
              qualityRating: phone.quality_rating || 'UNKNOWN'
            });
          });
        });
      });
    }
  } catch (err) {
    console.warn('Error querying businesses for WhatsApp accounts:', err);
  }

  // Also query client / shared WhatsApp Business Accounts
  if (accounts.length === 0) {
    try {
      const res = await fetch(
        `https://graph.facebook.com/${API_VERSION}/me/client_whatsapp_business_accounts?fields=id,name,phone_numbers{id,display_phone_number,verified_name,code_verification_status,quality_rating}&limit=50&access_token=${userAccessToken}`
      );
      const data = await res.json();

      if (data.data && Array.isArray(data.data)) {
        data.data.forEach((waba) => {
          const phones = waba.phone_numbers?.data || [];
          phones.forEach((phone) => {
            accounts.push({
              businessId: waba.id,
              businessName: waba.name,
              wabaId: waba.id,
              wabaName: waba.name,
              phoneId: phone.id,
              displayNumber: phone.display_phone_number || phone.id,
              verifiedName: phone.verified_name || waba.name,
              status: phone.code_verification_status || 'VERIFIED',
              qualityRating: phone.quality_rating || 'UNKNOWN'
            });
          });
        });
      }
    } catch (err) {
      console.warn('Error querying client WhatsApp accounts:', err);
    }
  }

  return accounts;
};


