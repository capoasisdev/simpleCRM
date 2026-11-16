/**
 * Domain Routing & Multi-Deployment Gateway
 * 
 * Determines whether the current deployment host acts as:
 * 1. The Primary Marketing & Commercial Site (e.g. indiecode domains) with landing page & pricing.
 * 2. A Direct Portal / Custom Domain (e.g. simplecrm.capoasis.com) that skips the homepage/landing
 *    and directly starts with either /login or /dashboard.
 */

export function isDirectPortalDomain() {
  if (typeof window === 'undefined') return false;

  // 1. Explicit Environment Variable Overrides (set in Vercel project settings)
  if (import.meta.env.VITE_DIRECT_PORTAL_ONLY === 'true') {
    return true;
  }
  if (import.meta.env.VITE_MARKETING_SITE === 'true') {
    return false;
  }

  // 2. Query parameter overrides (helpful for local previewing & manual testing)
  try {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('portal') === '1' || searchParams.get('direct') === '1') {
      return true;
    }
    if (searchParams.get('landing') === '1' || searchParams.get('marketing') === '1') {
      return false;
    }
  } catch {}

  const hostname = (window.location.hostname || '').toLowerCase();

  // 3. Local development defaults to marketing mode so developers can test both views
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.local')) {
    return false;
  }

  // 4. Custom configured primary marketing domains (comma-separated list if provided)
  const configuredMarketingHosts = (import.meta.env.VITE_PRIMARY_MARKETING_DOMAINS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (configuredMarketingHosts.length > 0) {
    const matchesMarketing = configuredMarketingHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    );
    return !matchesMarketing;
  }

  // 5. Default auto-detection:
  // - indiecode domains (indiecode.in, *.indiecode.*, or Vercel projects matching indiecode)
  //   are the primary business that owns and markets simplecrm -> show landing page.
  if (hostname.includes('indiecode')) {
    return false;
  }

  // - Any other custom domain (e.g. simplecrm.capoasis.com, capoasisdev Vercel deployments,
  //   or future customer domains) directly starts in portal mode without landing page.
  return true;
}
