const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createSanctionClaim,
  respondToSanctionClaim,
  reassignSanctionClaim,
  fetchSanctionClaimHistory,
} = require('../../../src/libs/sanction-claims');

const student = { tipo: 'estudiante', documento: '123' };
const lab = { tipo: 'laboratorista', documento: '456' };

function client({
  ownSanction = true,
  state = 'ACTIVA',
  duplicate = false,
  activeLab = true,
  updateAllowed = true,
  auditFailure = false,
} = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes('SELECT id FROM usuario')) return { rows: [{ id: 7 }] };
      if (sql.includes('SELECT documento FROM laboratorista'))
        return { rows: activeLab ? [{ documento: '456' }] : [] };
      if (sql.includes('FROM multa WHERE'))
        return {
          rows: ownSanction
            ? [{ id: 9, laboratorista_documento_id: '456', con_estado_multa: state }]
            : [],
        };
      if (sql.includes('INSERT INTO reclamacion_sancion'))
        return { rows: duplicate ? [] : [{ id: 11 }] };
      if (sql.includes('UPDATE reclamacion_sancion'))
        return { rows: updateAllowed ? [{ id: 11 }] : [] };
      if (sql.includes('INSERT INTO log') && auditFailure) throw new Error('audit unavailable');
      return { rows: [] };
    },
  };
}

test('claim uses the authenticated student and sanction creator, not body-supplied identities', async () => {
  const db = client();
  assert.equal(await createSanctionClaim(db, student, 9, ' Motivo de revisión '), 11);
  assert.deepEqual(db.calls.find((call) => call.sql.includes('FROM multa WHERE')).params, [9, 7]);
  assert.match(db.calls.find((call) => call.sql.includes('FROM multa WHERE')).sql, /FOR UPDATE/);
  assert.deepEqual(db.calls.find((call) => call.sql.includes('INSERT INTO reclamacion')).params, [
    9,
    '456',
    'Motivo de revisión',
  ]);
  assert.ok(db.calls.some((call) => call.sql.includes('INSERT INTO log')));
  assert.ok(!db.calls.some((call) => call.sql.includes('UPDATE multa')));
});

test('claim text accepts 500 characters and rejects empty, whitespace, oversized and malformed values', async () => {
  assert.equal(await createSanctionClaim(client(), student, 9, 'a'.repeat(500)), 11);
  for (const text of ['', '  ', 'a'.repeat(501), null, {}, ['texto']]) {
    const db = client();
    await assert.rejects(createSanctionClaim(db, student, 9, text), { status: 400 });
    assert.equal(db.calls.length, 0);
  }
});

test('students cannot claim another account, a non-active sanction, or submit twice', async () => {
  for (const [options, status] of [
    [{ ownSanction: false }, 404],
    [{ state: 'SALDADA' }, 409],
    [{ duplicate: true }, 409],
  ]) {
    await assert.rejects(createSanctionClaim(client(options), student, 9, 'Revisión'), { status });
  }
  for (const user of [null, lab, { tipo: 'admin' }, { ...student, __impersonating: true }]) {
    await assert.rejects(createSanctionClaim(client(), user, 9, 'Revisión'), { status: 403 });
  }
});

test('the responsible active laboratorista can answer once without changing sanction status', async () => {
  const db = client();
  assert.equal(await respondToSanctionClaim(db, lab, 11, 'a'.repeat(500), 'PROCEDE'), 11);
  const update = db.calls.find((call) => call.sql.includes('UPDATE reclamacion'));
  assert.match(update.sql, /responsable_documento_id = \$3 AND fecha_respuesta IS NULL/);
  assert.deepEqual(update.params, ['a'.repeat(500), 'PROCEDE', '456', 11]);
  assert.ok(!db.calls.some((call) => call.sql.includes('UPDATE multa')));
  await assert.rejects(
    respondToSanctionClaim(client({ updateAllowed: false }), lab, 11, 'Respuesta', 'NO_PROCEDE'),
    { status: 409 }
  );
  await assert.rejects(
    respondToSanctionClaim(client({ activeLab: false }), lab, 11, 'Respuesta', 'NO_PROCEDE'),
    { status: 403 }
  );
});

test('response cannot be empty, oversized, use a forged decision, or come from another role', async () => {
  for (const [text, decision] of [
    [' ', 'PROCEDE'],
    ['a'.repeat(501), 'PROCEDE'],
    ['Respuesta', 'ACEPTADA'],
  ]) {
    await assert.rejects(respondToSanctionClaim(client(), lab, 11, text, decision), {
      status: 400,
    });
  }
  for (const user of [
    student,
    { tipo: 'admin' },
    { tipo: 'coordinador_general' },
    { ...lab, __impersonating: true },
  ]) {
    await assert.rejects(respondToSanctionClaim(client(), user, 11, 'Respuesta', 'PROCEDE'), {
      status: 403,
    });
  }
});

test('only admin can reassign a pending claim to an active laboratorista and audit the change', async () => {
  const db = client();
  assert.equal(await reassignSanctionClaim(db, { tipo: 'admin', documento: '999' }, 11, '456'), 11);
  assert.ok(db.calls.some((call) => call.sql.includes('INSERT INTO log')));
  assert.ok(!db.calls.some((call) => call.sql.includes('UPDATE multa')));
  await assert.rejects(reassignSanctionClaim(client(), lab, 11, '456'), { status: 403 });
  await assert.rejects(
    reassignSanctionClaim(client({ activeLab: false }), { tipo: 'admin' }, 11, '456'),
    { status: 400 }
  );
  await assert.rejects(
    reassignSanctionClaim(client({ updateAllowed: false }), { tipo: 'admin' }, 11, '456'),
    { status: 409 }
  );
});

test('audit failures propagate so callers roll back, rather than silently saving', async () => {
  await assert.rejects(
    createSanctionClaim(client({ auditFailure: true }), student, 9, 'Revisión'),
    /audit unavailable/
  );
  await assert.rejects(
    respondToSanctionClaim(client({ auditFailure: true }), lab, 11, 'Respuesta', 'PROCEDE'),
    /audit unavailable/
  );
});

test('history selects claims and respondent names regardless of sanction state', async () => {
  const db = client();
  assert.deepEqual(await fetchSanctionClaimHistory(db, 9), []);
  assert.deepEqual(db.calls[0].params, [9]);
  assert.doesNotMatch(db.calls[0].sql, /con_estado_multa =/);
  assert.match(db.calls[0].sql, /respondiente.nombre AS respondido_por/);
});

test('migration and fresh schema enforce one claim, text boundaries and complete responses', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../../../sql/20261008_hotfix_sanciones_dependencias.sql'),
    'utf8'
  );
  const structure = fs.readFileSync(
    path.resolve(__dirname, '../../../sql-scripts/db_structure.sql'),
    'utf8'
  );
  const table = (sql) =>
    sql
      .match(/CREATE TABLE (?:IF NOT EXISTS )?reclamacion_sancion \([\s\S]*?\n\);/)[0]
      .replace('IF NOT EXISTS ', '');
  assert.equal(table(migration), table(structure));
  assert.match(migration, /multa_id INTEGER NOT NULL UNIQUE/);
  assert.match(migration, /char_length\(btrim\(texto\)\) BETWEEN 1 AND 500/);
  assert.match(migration, /decision IN \('PROCEDE', 'NO_PROCEDE'\)/);
  assert.doesNotMatch(migration, /UPDATE multa/);
});
