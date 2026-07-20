import {
  clearFormSummaryCache,
  handleWixSubmission,
} from '../../serverless/wix-backoffice.mjs';

export default function handler(request) {
  return handleWixSubmission(request, process.env);
}

export { clearFormSummaryCache };
