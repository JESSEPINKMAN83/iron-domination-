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

function parseTelemetryFeature(value) {
  if (!value || typeof value !== 'object') return undefined;
  const endAction = ['hold', 'attack-move', 'attack'].includes(value.endAction) ? value.endAction : undefined;
  const feature = {
    unitCount: finiteNumber(value.unitCount, 0, 10_000),
    selectionCount: finiteNumber(value.selectionCount, 0, 10_000),
    unitKinds: cleanText(value.unitKinds, 400) || undefined,
    waypointCount: finiteNumber(value.waypointCount, 0, 64),
    pathLengthApprox: finiteNumber(value.pathLengthApprox, 0, 1_000_000, 1),
    endAction,
    plannerDurationMs: finiteNumber(value.plannerDurationMs, 0, 3_600_000),
    subsetOfSelection: typeof value.subsetOfSelection === 'boolean' ? value.subsetOfSelection : undefined,
    useful: typeof value.useful === 'boolean' ? value.useful : undefined,
    rankRecruitShare: finiteNumber(value.rankRecruitShare, 0, 1, 3),
    rankVeteranShare: finiteNumber(value.rankVeteranShare, 0, 1, 3),
    rankEliteShare: finiteNumber(value.rankEliteShare, 0, 1, 3),
    rankAceShare: finiteNumber(value.rankAceShare, 0, 1, 3),
    rankCounts: cleanText(value.rankCounts, 120) || undefined,
    combatUnitCount: finiteNumber(value.combatUnitCount, 0, 10_000),
  };
  return Object.values(feature).some((entry) => entry !== undefined) ? feature : undefined;
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

  if (body.kind === 'enlist') {
    const name = cleanText(body.name, 120);
    const email = cleanText(body.email, 254).toLowerCase();
    if (!name || !validEmail(email)) return null;
    return {
      kind: 'enlist',
      name,
      email,
      releaseUpdates: body.releaseUpdates === true,
      source: cleanText(body.source, 200) || 'Iron Dominion multiplayer enlistment',
    };
  }

  if (body.kind === 'telemetry') {
    const event = [
      'session-start',
      'match-start',
      'match-end',
      'heartbeat',
      'tactic-open',
      'tactic-cancel',
      'tactic-execute',
      'tactic-complete',
      'tactic-interrupted',
      'tactic-feedback',
    ].includes(body.event)
      ? body.event
      : '';
    const playerId = cleanText(body.playerId, 64);
    if (!event || !playerId) return null;
    return {
      kind: 'telemetry',
      event,
      playerId,
      page: cleanText(body.page, 1000),
      buildVersion: cleanText(body.buildVersion, 80),
      match: parseMatchMetadata(body.match),
      feature: parseTelemetryFeature(body.feature),
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

/**
 * Creates the site member for an enlisting player, or returns the one that already
 * exists for that email.
 *
 * Members are created with an admin API key and a login email only — no password is
 * ever collected, sent, or stored, which is what keeps the game's own origin free of
 * anything a phishing classifier could read as a credential form. Wix's documented
 * upgrade path (Send Set Password Email) can make these members login-capable later
 * without migrating anything.
 */
async function createMember(config, submission) {
  const response = await fetchWithTimeout('https://www.wixapis.com/members/v1/members', {
    method: 'POST',
    headers: wixHeaders(config),
    body: JSON.stringify({
      member: {
        loginEmail: submission.email,
        profile: { nickname: submission.name },
      },
    }),
  }, WIX_API_TIMEOUT_MS);

  if (response.ok) {
    const payload = await response.json();
    const id = payload.member?.id;
    if (id) return id;
  } else if (response.status !== 409) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`Wix member request failed (${response.status}): ${details}`);
  }

  // 409 ALREADY_EXISTS: enlisting again — from a second device, or after clearing
  // storage — is the same commander, so reuse the member instead of failing.
  const found = await wixRequest(config, '/members/v1/members/query', {
    method: 'POST',
    body: JSON.stringify({
      query: { filter: { loginEmail: submission.email }, paging: { limit: 1 } },
      fieldsets: ['EXTENDED'],
    }),
  });
  const existing = found.members?.[0]?.id;
  if (!existing) throw new Error('Wix reported an existing member that no query could find');
  return existing;
}

/**
 * The relay's proof that a member id came from here. Signed with the same shared
 * secret the CMS ingest uses, so the relay can verify membership with no network
 * call and no Wix token in the browser.
 */
async function mintMemberTicket(secret, memberId) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(memberId));
  const bytes = new Uint8Array(signature);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

/**
 * An enlisted player is also a signup: recorded in the same dashboard and the same
 * Wix form as everyone who ever asked for beta access, so there is one list to read.
 */
async function recordEnlistmentCopy(config, submission) {
  const signup = {
    kind: 'signup',
    name: submission.name,
    email: submission.email,
    releaseUpdates: submission.releaseUpdates,
    source: submission.source,
  };
  await createCmsSubmission(config, signup);
  await createWixFormCopy(config, signup);
}

async function handleEnlist(config, submission, executionContext) {
  // Without the shared secret there is no ticket, and a member the relay cannot
  // verify is worse than a clear failure the player can retry.
  if (!config.cmsSecret) return jsonResponse(503, { error: 'wix-not-configured' });

  await createContact(config, submission);
  const memberId = await createMember(config, submission);
  const ticket = await mintMemberTicket(config.cmsSecret, memberId);

  const copy = recordEnlistmentCopy(config, submission).catch((error) => {
    console.error('[wix-enlist-copy]', error instanceof Error ? error.message : error);
  });
  if (executionContext?.waitUntil) executionContext.waitUntil(copy);
  else await copy;

  return jsonResponse(200, { ok: true, memberId, ticket });
}

async function createWixFormCopy(config, submission) {
  if (submission.kind === 'signup') {
    const summary = await getFormSummary(config, config.signupFormId);
    await createContact(config, submission);
    await createFormSubmission(config, config.signupFormId, signupValues(summary.fields, submission));
    return;
  }

  const summary = await getFormSummary(config, config.feedbackFormId);
  await createFormSubmission(config, config.feedbackFormId, feedbackValues(summary.fields, submission));
}

export async function handleWixSubmission(request, env = {}, executionContext) {
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method-not-allowed' });

  const config = configuration(env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'invalid-json' });
  }

  const submission = parseSubmission(body);
  if (!submission) return jsonResponse(400, { error: 'invalid-submission' });

  // Telemetry only needs the CMS ingest endpoint; forms and contacts need the API key.
  if (submission.kind !== 'telemetry' && !config.apiKey) {
    return jsonResponse(503, { error: 'wix-not-configured' });
  }

  try {
    if (submission.kind === 'enlist') return await handleEnlist(config, submission, executionContext);
    // The custom dashboard is the player-facing source of truth. Save it before
    // the slower Wix Forms API so delayed form copies cannot drop telemetry.
    await createCmsSubmission(config, submission);
    if (submission.kind === 'telemetry') return jsonResponse(200, { ok: true });
    const formCopy = createWixFormCopy(config, submission).catch((error) => {
      console.error('[wix-form-copy]', error instanceof Error ? error.message : error);
    });
    if (executionContext?.waitUntil) executionContext.waitUntil(formCopy);
    else await formCopy;
    return jsonResponse(200, { ok: true });
  } catch (error) {
    console.error('[wix-submit]', error instanceof Error ? error.message : error);
    return jsonResponse(502, { error: 'wix-submission-failed' });
  }
}

export function clearFormSummaryCache() {
  formSummaryCache.clear();
}
