const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { Pool } = require('pg');

const { buildApp, resolveRepoPath } = require('./build-test-app');
const { createSessionHarness, createUser } = require('./session-fixtures');
const { config } = require('../../../src/config/config');
const { resolveDatabaseCredentials } = require('../../../src/libs/db-credentials');

const dbPath = resolveRepoPath('src/libs/db.js');
const authPath = resolveRepoPath('src/routes/middlewares/auth.js');
const scopePath = resolveRepoPath('src/libs/capacitacion-scope.js');
const notificationsPath = resolveRepoPath('src/libs/email-notifications.js');
const migrationPath = resolveRepoPath('sql-scripts/prod/db_structure_certificacion.sql');
const routePath = resolveRepoPath('src/routes/api/capacitacion-gestion.js');

const allowJsonRoles = () => (req, res, next) => next();

function migrationForSchema(schema) {
  const source = fs.readFileSync(migrationPath, 'utf8');
  const schemaDeclaration = 'CREATE SCHEMA IF NOT EXISTS milab;';
  const searchPathDeclaration = 'SET search_path TO milab;';
  assert.ok(source.includes(schemaDeclaration));
  assert.ok(source.includes(searchPathDeclaration));
  return source
    .replace(schemaDeclaration, '')
    .replace(searchPathDeclaration, `SET search_path TO "${schema}";`);
}

async function createPostgresFixture(
  databaseUrl = process.env.MILAB_CAPACITACION_TEST_DATABASE_URL
) {
  const useApplicationDatabase = process.env.MILAB_CAPACITACION_TEST_USE_APP_DB === 'true';
  if (!databaseUrl && !useApplicationDatabase) {
    throw new Error(
      'Set MILAB_CAPACITACION_TEST_DATABASE_URL or explicitly enable the dedicated application test database.'
    );
  }

  let pool;
  if (databaseUrl) {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
  } else {
    const { user, password } = await resolveDatabaseCredentials();
    if (!config.dbHost || !config.dbPort || !config.dbName) {
      throw new Error('DB_HOST, DB_PORT, and DB_NAME are required for PostgreSQL regressions.');
    }
    pool = new Pool({
      host: config.dbHost,
      port: config.dbPort,
      user,
      password,
      database: config.dbName,
      options: config.options,
      max: 8,
    });
  }
  const schema = 'capacitacion_regression_' + randomBytes(6).toString('hex');
  let setupClient;
  let setupClientReleased = false;

  try {
    setupClient = await pool.connect();
    await setupClient.query(`CREATE SCHEMA "${schema}"`);
    await setupClient.query(`SET search_path TO "${schema}"`);
    await setupClient.query(`
      CREATE TABLE dependencia_facultad (
        dependencia_facultad_id INT PRIMARY KEY,
        nombre TEXT NOT NULL,
        activo BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE ual (
        ual_id INT PRIMARY KEY,
        facultad_id INT,
        nombre TEXT NOT NULL,
        codigo_abreviacion TEXT,
        activo BOOLEAN NOT NULL DEFAULT TRUE
      );
      CREATE TABLE equipo (id INT PRIMARY KEY);
      CREATE VIEW equipo_catalogo AS
      SELECT
        id,
        NULL::VARCHAR(50) AS codigo,
        NULL::TEXT AS nombre,
        NULL::TEXT AS descripcion,
        NULL::JSONB AS especificaciones,
        NULL::TEXT AS categoria,
        NULL::TEXT AS laboratorio,
        NULL::TEXT AS facultad,
        NULL::TEXT AS area_conocimiento,
        NULL::TEXT AS estado,
        NULL::TEXT AS ubicacion,
        NULL::JSONB AS ubicacion_prestamo,
        TRUE AS activo,
        CURRENT_TIMESTAMP AS fecha_creacion,
        CURRENT_TIMESTAMP AS fecha_modificacion,
        NULL::INT AS inventario_id
      FROM equipo;
      CREATE TABLE usuario (
        id INT PRIMARY KEY,
        documento VARCHAR(50) NOT NULL UNIQUE,
        tipo VARCHAR(100) NOT NULL,
        codigo VARCHAR(100)
      );
      CREATE TABLE solicitud_prestamo (id INT PRIMARY KEY);
      CREATE TABLE entrega_equipo (id BIGINT PRIMARY KEY);
      CREATE TABLE multa (
        usuario_sancionado_id INT NOT NULL,
        activo BOOLEAN NOT NULL,
        con_estado_multa TEXT
      );
      CREATE TABLE log (
        id BIGSERIAL PRIMARY KEY,
        nombre TEXT,
        documento TEXT,
        accion TEXT,
        persona TEXT
      );
    `);
    await setupClient.query(migrationForSchema(schema));
    await setupClient.query(`
      INSERT INTO dependencia_facultad (dependencia_facultad_id, nombre)
      VALUES (1, 'Facultad uno'), (2, 'Facultad dos');
      INSERT INTO ual (ual_id, facultad_id, nombre) VALUES
        (11, 1, 'Laboratorio uno'),
        (12, 2, 'Laboratorio dos');
      INSERT INTO usuario (id, documento, tipo)
      SELECT n, 'student-' || (n - 54), 'estudiante'
        FROM generate_series(55, 60) AS n;
      INSERT INTO cursos (codigo_curso, id_facultad, nombre_curso, url_edx)
      VALUES
        ('COURSE-1', 1, 'Curso uno', 'https://edx.test/course-1'),
        ('COURSE-2', 2, 'Curso dos', 'https://edx.test/course-2');
      INSERT INTO sesion_capacitacion (
        codigo_curso, nombre_curso_snapshot, ual_id, facultad_id,
        laboratorista_responsable_doc, fecha_inicio, fecha_fin, cupo_maximo
      ) VALUES (
        'COURSE-1', 'Curso uno', 11, 1, 'lab-1',
        CURRENT_TIMESTAMP + INTERVAL '1 day',
        CURRENT_TIMESTAMP + INTERVAL '1 day 2 hours',
        1
      );
    `);
    setupClient.release();
    setupClientReleased = true;

    const db = {
      async query(sql, params) {
        const client = await pool.connect();
        try {
          await client.query(`SET search_path TO "${schema}"`);
          return await client.query(sql, params);
        } finally {
          client.release();
        }
      },
      async connect() {
        const client = await pool.connect();
        try {
          await client.query(`SET search_path TO "${schema}"`);
          return client;
        } catch (error) {
          client.release();
          throw error;
        }
      },
    };

    return {
      db,
      schema,
      async addSession({
        codigoCurso = 'COURSE-1',
        ualId = 11,
        facultadId = 1,
        cupo = 3,
        estado = 'programada',
        fechaInicio = new Date(Date.now() + 24 * 60 * 60 * 1000),
        fechaFin = new Date(Date.now() + 26 * 60 * 60 * 1000),
      } = {}) {
        const result = await db.query(
          `INSERT INTO sesion_capacitacion (
             codigo_curso, nombre_curso_snapshot, ual_id, facultad_id,
             laboratorista_responsable_doc, fecha_inicio, fecha_fin, cupo_maximo, estado
           ) VALUES ($1, $2, $3, $4, 'lab-1', $5, $6, $7, $8)
           RETURNING id`,
          [codigoCurso, codigoCurso, ualId, facultadId, fechaInicio, fechaFin, cupo, estado]
        );
        return result.rows[0].id;
      },
      async applyMigrationAgain() {
        const client = await pool.connect();
        try {
          await client.query(`SET search_path TO "${schema}"`);
          await client.query(migrationForSchema(schema));
        } finally {
          client.release();
        }
      },
      async cleanup() {
        const client = await pool.connect();
        try {
          await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          client.release();
          await pool.end();
        }
      },
    };
  } catch (error) {
    if (setupClient && !setupClientReleased) {
      try {
        await setupClient.query('ROLLBACK');
        setupClient.release();
      } catch (rollbackError) {
        setupClient.release(rollbackError);
      }
    }
    try {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } catch (cleanupError) {
      console.error('[capacitacion-postgres-fixture:cleanup]', cleanupError);
    } finally {
      await pool.end();
    }
    throw error;
  }
}

function buildManagementApp(db, user, { scope = { isAdmin: true }, authModule } = {}) {
  const sessionHarness = createSessionHarness({
    user: createUser({
      tipo: user.tipo || 'estudiante',
      roles: user.roles || ['estudiante'],
      documento: user.documento,
      documento_real: user.documento_real || user.documento,
      id: user.id,
      nombre: user.nombre || 'Usuario de prueba',
    }),
  });

  const stubs = [
    [dbPath, db],
    [scopePath, { resolveLaboratoristaScope: async () => scope }],
    [notificationsPath, { sendEmailNotification: async () => ({ ok: true }) }],
  ];
  if (authModule) {
    stubs.push([authPath, authModule]);
  } else {
    stubs.push([authPath, { requireJsonRoles: allowJsonRoles }]);
  }

  return buildApp({
    entryPath: routePath,
    sessionHarness,
    stubs,
    purgePaths: [routePath],
  });
}

module.exports = {
  buildManagementApp,
  createPostgresFixture,
};
