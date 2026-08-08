import { handleWixSubmission } from './serverless/wix-backoffice.mjs';
import { siteVerificationResponse } from './serverless/site-verification.mjs';

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/api/wix-submit') {
      return handleWixSubmission(request, env, executionContext);
    }
    const verification = siteVerificationResponse(url.pathname, env);
    if (verification) return verification;
    return env.ASSETS.fetch(request);
  },
};
