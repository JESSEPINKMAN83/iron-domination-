/**
 * Serves Google's Search Console verification file for the deployed origin.
 *
 * Search Console can verify a URL prefix — owning a domain is not required — but
 * only if the site serves `google<token>.html` containing the matching line. Driving
 * it from a secret means the review can be started (or re-started with a new token)
 * without shipping a deploy, which matters when the reason for the review is a
 * Safe Browsing flag and every hour counts.
 */
export function siteVerificationResponse(pathname, env = {}) {
  const token = String(env.GOOGLE_SITE_VERIFICATION ?? '').trim();
  if (!token || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return undefined;
  if (pathname !== `/google${token}.html`) return undefined;
  return new Response(`google-site-verification: google${token}.html`, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
