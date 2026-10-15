/**
 * Meta (Facebook) JavaScript SDK & Graph API Helper
 */

const DEFAULT_APP_ID = '977193864751819';
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

