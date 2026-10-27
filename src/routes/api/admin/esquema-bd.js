const express = require('express');

const pool = require('../../../libs/db');
const {
  getUserRoles,
  normalizeRoleListForMatch,
  renderAuthError,
  requireRoles,
} = require('../../middlewares/auth');
const { renderApplicationError } = require('../../middlewares/error-handler');

const router = express.Router();

const ACCESS_DENIED_OVERRIDES = {
  message: 'Acceso denegado',
  message2: 'Solo los administradores pueden consultar el esquema de la base de datos.',
  limit: 'loginOnly',
};

const requireAdmin = requireRoles('admin', ACCESS_DENIED_OVERRIDES);
const DATABASE_SCHEMA = 'milab';

// requireRoles concede solo lectura a coordinador_general; esta vista es exclusiva del admin.
function requireAdminRoleOnly(req, res, next) {
  const roles = normalizeRoleListForMatch(getUserRoles(req.session?.user));
  if (!roles.includes('admin')) {
    return renderAuthError(res, ACCESS_DENIED_OVERRIDES);
  }
  return next();
}

const RELATION_KINDS = ['r', 'p', 'v', 'm', 'f'];

function sanitizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

async function loadDatabaseInfo() {
  const result = await pool.query(`
    SELECT current_database() AS base_datos,
           session_user AS usuario_conexion,
           current_user AS usuario_efectivo
  `);
  return result.rows[0] || {};
}

async function listRelations(filtro) {
  const pattern = `%${escapeLike(filtro)}%`;
  const result = await pool.query(
    `
      SELECT n.nspname AS esquema,
             c.relname AS nombre,
             CASE c.relkind
               WHEN 'r' THEN 'Tabla'
               WHEN 'p' THEN 'Tabla particionada'
               WHEN 'v' THEN 'Vista'
               WHEN 'm' THEN 'Vista materializada'
               WHEN 'f' THEN 'Tabla foránea'
             END AS tipo,
             pg_get_userbyid(c.relowner) AS propietario,
             has_table_privilege(c.oid, 'SELECT') AS lectura_permitida,
             obj_description(c.oid, 'pg_class') AS comentario
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = ANY($1::"char"[])
        AND n.nspname = 'milab'
        AND ($2 = '' OR c.relname ILIKE $3)
      ORDER BY c.relname
    `,
    [RELATION_KINDS, filtro, pattern]
  );
  return result.rows;
}

async function findRelation(esquema, nombre) {
  if (esquema !== DATABASE_SCHEMA) return null;

  const result = await pool.query(
    `
      SELECT c.oid,
             n.nspname AS esquema,
             c.relname AS nombre,
             CASE c.relkind
               WHEN 'r' THEN 'Tabla'
               WHEN 'p' THEN 'Tabla particionada'
               WHEN 'v' THEN 'Vista'
               WHEN 'm' THEN 'Vista materializada'
               WHEN 'f' THEN 'Tabla foránea'
             END AS tipo,
             pg_get_userbyid(c.relowner) AS propietario,
             has_table_privilege(c.oid, 'SELECT') AS lectura_permitida,
             has_schema_privilege(n.oid, 'USAGE') AS uso_esquema_permitido,
             has_schema_privilege(n.oid, 'CREATE') AS creacion_esquema_permitida,
             has_table_privilege(c.oid, 'INSERT') AS insercion_permitida,
             has_table_privilege(c.oid, 'UPDATE') AS actualizacion_permitida,
             has_table_privilege(c.oid, 'DELETE') AS eliminacion_permitida,
             has_table_privilege(c.oid, 'TRUNCATE') AS vaciado_permitido,
             has_table_privilege(c.oid, 'REFERENCES') AS referencias_permitidas,
             has_table_privilege(c.oid, 'TRIGGER') AS disparadores_permitidos,
             obj_description(c.oid, 'pg_class') AS comentario
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND n.nspname = 'milab'
        AND c.relname = $2
        AND c.relkind = ANY($3::"char"[])
    `,
    [esquema, nombre, RELATION_KINDS]
  );
  return result.rows[0] || null;
}

async function loadRelationDetail(relation) {
  const [columnas, restricciones, indices, secuencia] = await Promise.all([
    pool.query(
      `
        SELECT a.attnum AS posicion,
               a.attname AS columna,
               format_type(a.atttypid, a.atttypmod) AS tipo,
               NOT a.attnotnull AS permite_nulo,
               pg_get_expr(d.adbin, d.adrelid) AS valor_por_defecto,
               a.attidentity IN ('a', 'd') AS identidad
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
        WHERE a.attrelid = $1
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY a.attnum
      `,
      [relation.oid]
    ),
    pool.query(
      `
        SELECT con.conname AS nombre,
               CASE con.contype
                 WHEN 'p' THEN 'Clave primaria'
                 WHEN 'u' THEN 'Único'
                 WHEN 'f' THEN 'Clave foránea'
                 WHEN 'c' THEN 'Check'
                 WHEN 'x' THEN 'Exclusión'
                 ELSE con.contype::text
               END AS tipo,
               pg_get_constraintdef(con.oid) AS definicion
        FROM pg_constraint con
        WHERE con.conrelid = $1
        ORDER BY con.contype, con.conname
      `,
      [relation.oid]
    ),
    pool.query(
      `
        SELECT indexname AS nombre, indexdef AS definicion
        FROM pg_indexes
        WHERE schemaname = $1 AND tablename = $2
        ORDER BY indexname
      `,
      [relation.esquema, relation.nombre]
    ),
    pool.query(
      `
        WITH secuencia AS (
          SELECT pg_get_serial_sequence(format('%I.%I', $1::text, $2::text), 'id') AS nombre
        )
        SELECT nombre,
               has_sequence_privilege(nombre, 'USAGE') AS uso_permitido,
               has_sequence_privilege(nombre, 'SELECT') AS lectura_permitida,
               has_sequence_privilege(nombre, 'UPDATE') AS actualizacion_permitida
        FROM secuencia
      `,
      [relation.esquema, relation.nombre]
    ),
  ]);

  const secuenciaId = secuencia.rows[0];
  return {
    columnas: columnas.rows,
    restricciones: restricciones.rows,
    indices: indices.rows,
    permisos: {
      esquema: {
        uso: relation.uso_esquema_permitido,
        crear: relation.creacion_esquema_permitida,
      },
      tabla: {
        lectura: relation.lectura_permitida,
        insercion: relation.insercion_permitida,
        actualizacion: relation.actualizacion_permitida,
        eliminacion: relation.eliminacion_permitida,
        vaciado: relation.vaciado_permitido,
        referencias: relation.referencias_permitidas,
        disparadores: relation.disparadores_permitidos,
      },
      secuencia: secuenciaId?.nombre ? secuenciaId : null,
    },
  };
}

async function renderSchemaPage(
  res,
  { filtro = '', esquema = '', tabla = '', detalle = null, notFound = false } = {}
) {
  const [baseDatos, relaciones] = await Promise.all([loadDatabaseInfo(), listRelations(filtro)]);

  return res.render('home/admin_esquema_bd', {
    baseDatos,
    relaciones,
    filtro,
    seleccion: { esquema, tabla },
    detalle,
    notFound,
  });
}

router.get('/', requireAdmin, requireAdminRoleOnly, async (req, res) => {
  try {
    const filtro = sanitizeText(req.query.q).slice(0, 100);
    const esquema = sanitizeText(req.query.esquema);
    const tabla = sanitizeText(req.query.tabla);

    if (!esquema || !tabla) {
      return await renderSchemaPage(res, { filtro });
    }

    const relacion = await findRelation(esquema, tabla);
    if (!relacion) {
      return await renderSchemaPage(res, { filtro, esquema, tabla, notFound: true });
    }

    const detalle = {
      ...relacion,
      ...(await loadRelationDetail(relacion)),
    };

    return await renderSchemaPage(res, { filtro, esquema, tabla, detalle });
  } catch (error) {
    console.error('Error consultando el esquema de la base de datos:', error);
    return renderApplicationError(
      res,
      {
        message: '¡Algo ha salido mal!',
        message2: 'No fue posible consultar el esquema de la base de datos.',
        limit: null,
      },
      req,
      error
    );
  }
});

module.exports = router;
