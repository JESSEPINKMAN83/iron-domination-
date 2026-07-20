const DEFAULT_SITE_ID = 'be56a4e3-290f-4469-87fc-b4a7a91dc5a9';
const DEFAULT_SIGNUP_FORM_ID = 'ee1501cf-e7e6-463c-a9a7-3438d788d12f';
const DEFAULT_FEEDBACK_FORM_ID = '495e01e3-2f2a-4824-aa2a-7b9ba9d3c4ab';
const WIX_FORMS_NAMESPACE = 'wix.form_app.form';

const formSummaryCache = new Map();

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function configuration() {
  return {
    apiKey: process.env.WIX_API_KEY ?? '',
    siteId: process.env.WIX_SITE_ID ?? DEFAULT_SITE_ID,
    signupFormId: process.env.WIX_SIGNUP_FORM_ID ?? DEFAULT_SIGNUP_FORM_ID,
    feedbackFormId: process.env.WIX_FEEDBACK_FORM_ID ?? DEFAULT_FEEDBACK_FORM_ID,
  };
}

function wixHeaders(config) {
  return {
    'Authorization': config.apiKey,
    'Content-Type': 'application/json',
    'wix-site-id': config.siteId,
  };
}

async function wixRequest(config, path, init = {}) {
  const response = await fetch(`https://www.wixapis.com${path}`, {
    ...init,
    headers: {
      ...wixHeaders(config),
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Wix request failed (${response.status}): ${details}`);
  }
  return response.json();
}

async function getFormSummary(config, formId) {
  const cached = formSummaryCache.get(formId);
  if (cached) return cached;

  const payload = await wixRequest(config, `/form-schema-service/v4/forms/${formId}/summary`);
  const summary = payload.formSummary;
  if (!summary?.fields?.length) throw new Error(`Wix form ${formId} has no input fields`);
  formSummaryCache.set(formId, summary);
  return summary;
}

function findField(fields, aliases) {
  const normalizedAliases = aliases.map(normalize);
  return fields.find((field) => {
    if (field.deleted) return false;
    const candidates = [field.label, field.target].map(normalize).filter(Boolean);
    return candidates.some((candidate) => normalizedAliases.some((alias) => (
      candidate === alias || candidate.includes(alias)
    )));
  });
}

function fieldKey(field) {
  return field?.target || field?.id || '';
}

function assignField(values, fields, aliases, value, required = true) {
  const field = findField(fields, aliases);
  const key = fieldKey(field);
  if (!key && required) throw new Error(`Required Wix field not found: ${aliases[0]}`);
  if (key) values[key] = value;
}

function signupValues(fields, submission) {
  const values = {};
  assignField(values, fields, ['name', 'your name', 'player name'], submission.name);
  assignField(values, fields, ['email', 'email address'], submission.email);
  assignField(values, fields, [
    'release updates',
    'email me occasional development updates',
    'official release',
  ], submission.releaseUpdates, false);
  assignField(values, fields, ['source', 'submission source'], submission.source, false);
  return values;
}

function feedbackValues(fields, submission) {
  const values = {};
  assignField(values, fields, ['player name', 'your name', 'name'], submission.name);
  assignField(values, fields, ['rating', 'rate the game', 'game rating'], submission.rating);
  assignField(values, fields, ['feedback', 'feedback about the game', 'message'], submission.message);
  assignField(values, fields, ['page url', 'page', 'url'], submission.page, false);
  return values;
}

function parseSubmission(body) {
  if (!body || typeof body !== 'object') return null;

  if (body.kind === 'signup') {
    const name = cleanText(body.name, 120);
    const email = cleanText(body.email, 254).toLowerCase();
    if (!name || !validEmail(email)) return null;
    return {
      kind: 'signup',
      name,
      email,
      releaseUpdates: body.releaseUpdates === true,
      source: cleanText(body.source, 200) || 'Iron Dominion landing page',
    };
  }

  if (body.kind === 'feedback') {
    const name = cleanText(body.name, 120);
    const message = cleanText(body.message, 5000);
    const rating = Number(body.rating);
    if (!name || !message || !Number.isInteger(rating) || rating < 1 || rating > 5) return null;
    return {
      kind: 'feedback',
      name,
      message,
      rating,
      page: cleanText(body.page, 1000),
    };
  }

  return null;
}

function splitName(fullName) {
  const parts = fullName.split(/\s+/).filter(Boolean);
  return {
    first: parts.shift() ?? fullName,
    ...(parts.length ? { last: parts.join(' ') } : {}),
  };
}

async function createContact(config, submission) {
  const response = await fetch('https://www.wixapis.com/contacts/v4/contacts', {
    method: 'POST',
    headers: wixHeaders(config),
    body: JSON.stringify({
      info: {
        name: splitName(submission.name),
        emails: { items: [{ tag: 'MAIN', email: submission.email }] },
      },
      allowDuplicates: false,
    }),
  });

  // An existing email is already the contact state we want.
  if (response.status === 409) return;
  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Wix contact request failed (${response.status}): ${details}`);
  }
}

async function createFormSubmission(config, formId, values) {
  await wixRequest(config, '/form-submission-service/v4/submissions', {
    method: 'POST',
    body: JSON.stringify({
      submission: {
        formId,
        namespace: WIX_FORMS_NAMESPACE,
        submissions: values,
      },
    }),
  });
}

export default async function handler(request) {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method-not-allowed' });

  const config = configuration();
  if (!config.apiKey) return jsonResponse(503, { error: 'wix-not-configured' });

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid-json' });
  }

  const submission = parseSubmission(body);
  if (!submission) return jsonResponse(400, { error: 'invalid-submission' });

  try {
    if (submission.kind === 'signup') {
      const summary = await getFormSummary(config, config.signupFormId);
      await createContact(config, submission);
      await createFormSubmission(config, config.signupFormId, signupValues(summary.fields, submission));
    } else {
      const summary = await getFormSummary(config, config.feedbackFormId);
      await createFormSubmission(config, config.feedbackFormId, feedbackValues(summary.fields, submission));
    }
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('[wix-submit]', error instanceof Error ? error.message : error);
    return jsonResponse(502, { error: 'wix-submission-failed' });
  }
}

export function clearFormSummaryCache() {
  formSummaryCache.clear();
}
