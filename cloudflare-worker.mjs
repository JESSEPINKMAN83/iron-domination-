import { handleWixSubmission } from './serverless/wix-backoffice.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/wix-submit') {
      return handleWixSubmission(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
