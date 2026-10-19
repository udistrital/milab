const crypto = require('node:crypto');

const SESSION_KEY = 'sanctionPersonLookups';
const LOOKUP_TTL_MS = 15 * 60 * 1000;
const MAX_LOOKUPS_PER_SESSION = 5;
const SANCTION_PERSON_ACTIONS_PATH = '/milab/api/get-info-multa/persona';

function getActor(req) {
  const user = req.session?.user || {};
  return {
    role: String(user.tipo || '')
      .trim()
      .toLowerCase(),
    document: String(user.documento_real || user.documento || '').trim(),
  };
}

function createSanctionPersonLookup(req, personType, person) {
  if (!req.session || !['estudiante', 'docente'].includes(personType) || !person) {
    throw new Error('No se pudo crear el contexto temporal de búsqueda de sanción.');
  }

  const now = Date.now();
  const lookups = req.session[SESSION_KEY] || {};
  for (const [token, lookup] of Object.entries(lookups)) {
    if (!lookup || lookup.expiresAt <= now) delete lookups[token];
  }

  const oldestLookups = Object.entries(lookups).sort(
    ([, first], [, second]) => first.createdAt - second.createdAt
  );
  while (oldestLookups.length >= MAX_LOOKUPS_PER_SESSION) {
    const [oldestToken] = oldestLookups.shift();
    delete lookups[oldestToken];
  }

  const token = crypto.randomBytes(32).toString('hex');
  const actor = getActor(req);
  lookups[token] = {
    personType,
    person,
    actor,
    createdAt: now,
    expiresAt: now + LOOKUP_TTL_MS,
  };
  req.session[SESSION_KEY] = lookups;
  return token;
}

function resolveSanctionPersonLookup(req, token, expectedPersonType) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;

  const lookups = req.session?.[SESSION_KEY];
  const lookup = lookups?.[token];
  if (!lookup) return null;

  if (lookup.expiresAt <= Date.now()) {
    delete lookups[token];
    return null;
  }

  const actor = getActor(req);
  if (
    lookup.personType !== expectedPersonType ||
    lookup.actor?.role !== actor.role ||
    lookup.actor?.document !== actor.document
  ) {
    return null;
  }

  return { ...lookup.person };
}

function buildSanctionPersonReturnPath(token, feedback = '') {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;

  const params = new URLSearchParams({ lookup_token: token });
  if (feedback) params.set('success', feedback);
  return `${SANCTION_PERSON_ACTIONS_PATH}?${params.toString()}`;
}

module.exports = {
  SANCTION_PERSON_ACTIONS_PATH,
  buildSanctionPersonReturnPath,
  createSanctionPersonLookup,
  resolveSanctionPersonLookup,
};
