const DEFAULT_SITE_ID = 'be56a4e3-290f-4469-87fc-b4a7a91dc5a9';
const DEFAULT_SIGNUP_FORM_ID = 'ee1501cf-e7e6-463c-a9a7-3438d788d12f';
const DEFAULT_FEEDBACK_FORM_ID = '495e01e3-2f2a-4824-aa2a-7b9ba9d3c4ab';
const DEFAULT_CMS_ENDPOINT = 'https://danir412.wixsite.com/my-site-66/_functions/ironDominionSubmission';
const WIX_FORMS_NAMESPACE = 'wix.form_app.form';
const WIX_API_TIMEOUT_MS = 12_000;
const WIX_CMS_TIMEOUT_MS = 5_000;

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

function finiteNumber(value, min, max, precision = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const bounded = Math.max(min, Math.min(max, number));
  const factor = 10 ** precision;
  return Math.round(bounded * factor) / factor;
}

function parseMatchMetadata(value) {
  if (!value || typeof value !== 'object') return undefined;
  const matchId = cleanText(value.matchId, 120);
  if (!matchId) return undefined;
  const status = ['ongoing', 'victory', 'defeat'].includes(value.status) ? value.status : 'ongoing';
  return {
    matchId,
    status,
    multiplayer: value.multiplayer === true,
    roomCode: cleanText(value.roomCode, 12) || undefined,
    mapId: cleanText(value.mapId, 80),
    mapSize: cleanText(value.mapSize, 20),
    seed: finiteNumber(value.seed, 1, 2_147_483_647),
    playerName: cleanText(value.playerName, 120) || undefined,
    playerTeam: finiteNumber(value.playerTeam, 1, 4),
    playerSide: finiteNumber(value.playerSide, 1, 4),
    elapsedSeconds: finiteNumber(value.elapsedSeconds, 0, 604_800, 1),
    fps: finiteNumber(value.fps, 0, 1000, 1),
    pingMs: finiteNumber(value.pingMs, 0, 60_000),
    quality: cleanText(value.quality, 40),
    renderScale: finiteNumber(value.renderScale, 0.1, 4, 2),
    engine: cleanText(value.engine, 80) || undefined,
    buildVersion: cleanText(value.buildVersion, 80),
  };
}

function configuration(env) {
  return {
    apiKey: env.WIX_API_KEY ?? '',
    siteId: env.WIX_SITE_ID ?? DEFAULT_SITE_ID,
    signupFormId: env.WIX_SIGNUP_FORM_ID ?? DEFAULT_SIGNUP_FORM_ID,
    feedbackFormId: env.WIX_FEEDBACK_FORM_ID ?? DEFAULT_FEEDBACK_FORM_ID,
    cmsEndpoint: env.WIX_CMS_ENDPOINT ?? DEFAULT_CMS_ENDPOINT,
    cmsSecret: env.IRON_DOMINION_INGEST_SECRET ?? '',
  };
}

function wixHeaders(config) {
  return {
    'Authorization': config.apiKey,
    'Content-Type': 'application/json',
    'wix-site-id': config.siteId,
  };
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function wixRequest(config, path, init = {}) {
  const response = await fetchWithTimeout(`https://www.wixapis.com${path}`, {
    ...init,
    headers: {
      ...wixHeaders(config),
      ...(init.headers ?? {}),
    },
  }, WIX_API_TIMEOUT_MS);

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

function assignField(values, fields, aliases, value, required = true, fallbackTypes = []) {
  const field = findField(fields, aliases) ?? fields.find((candidate) => {
    const key = fieldKey(candidate);
    return !candidate.deleted
      && key
      && !(key in values)
      && fallbackTypes.includes(normalize(candidate.type));
  });
  const key = fieldKey(field);
  if (!key && required) {
    const available = fields
      .filter((candidate) => !candidate.deleted)
      .map((candidate) => `${candidate.label ?? candidate.target ?? candidate.id} (${candidate.type ?? 'UNKNOWN'})`)
      .join(', ');
    throw new Error(`Required Wix field not found: ${aliases[0]}; available: ${available}`);
  }
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
  assignField(values, fields, [
    'feedback',
    'feedback about the game',
    'message',
    'tell us what worked, what broke, or what would make the battle better',
  ], submission.message, true, ['string']);
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
      match: parseMatchMetadata(body.match),
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
  const response = await fetchWithTimeout('https://www.wixapis.com/contacts/v4/contacts', {
    method: 'POST',
    headers: wixHeaders(config),
    body: JSON.stringify({
      info: {
        name: splitName(submission.name),
        emails: { items: [{ tag: 'MAIN', email: submission.email }] },
      },
      allowDuplicates: false,
    }),
  }, WIX_API_TIMEOUT_MS);

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

async function createCmsSubmission(config, submission) {
  if (!config.cmsEndpoint || !config.cmsSecret) return;

  const response = await fetchWithTimeout(config.cmsEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-iron-dominion-secret': config.cmsSecret,
    },
    body: JSON.stringify(submission),
  }, WIX_CMS_TIMEOUT_MS);

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Wix CMS request failed (${response.status}): ${details}`);
  }
}

export async function handleWixSubmission(request, env = {}) {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method-not-allowed' });

  const config = configuration(env);
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
    await createCmsSubmission(config, submission);
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('[wix-submit]', error instanceof Error ? error.message : error);
    return jsonResponse(502, { error: 'wix-submission-failed' });
  }
}

export function clearFormSummaryCache() {
  formSummaryCache.clear();
}
