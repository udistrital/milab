const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.resolve(__dirname, '../../../sql/20261021_encuentros_permissions.sql');
const structurePath = path.resolve(
  __dirname,
  '../../../sql-scripts/prod/db_structure_certificacion.sql'
);

test('encounter permissions migration covers every encounter table and its sequence', () => {
  const migration = fs.readFileSync(migrationPath, 'utf8');
  const structure = fs.readFileSync(structurePath, 'utf8');
  const tables = [
    'encuentro_evento',
    'encuentro_participante',
    'encuentro_asistencia',
    'encuentro_asistencia_correccion',
    'encuentro_certificado',
    'encuentro_certificado_version',
    'encuentro_envio_certificado',
    'encuentro_logro',
  ];

  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(migration, /c\.oid = 'milab\.multa'::regclass/);
  assert.match(migration, /GRANT %s ON TABLE milab\.%I TO %I/);
  assert.match(migration, /pg_get_serial_sequence/);

  for (const table of tables) {
    assert.ok(structure.includes(`CREATE TABLE IF NOT EXISTS ${table} (`), `${table} is in schema`);
    assert.ok(migration.includes(`'${table}'`), `${table} receives permissions`);
  }
});
