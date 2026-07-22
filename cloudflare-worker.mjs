import { handleWixSubmission } from './serverless/wix-backoffice.mjs';

export default {
  async fetch(request, env, executionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/api/wix-submit') {
      return handleWixSubmission(request, env, executionContext);
    }
    return env.ASSETS.fetch(request);
  },
};
