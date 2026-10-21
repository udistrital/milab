const express = require('express');

const pool = require('../../libs/db');
const { normalizeLogDocument } = require('../../libs/account-email');
const {
  ensureOperationalRoleAssignmentsSchema,
  fetchActiveUalOptions,
  replaceOperationalRoleAssignments,
} = require('../../libs/operational-role-assignments');
const { normalizeRoles } = require('../../libs/roles');
const { renderAuthError } = require('../middlewares/auth');
const { renderApplicationError } = require('../middlewares/error-handler');

const router = express.Router();
const ROLE_NAME = 'gestor_laboratorio';
const PRIVILEGED_ROLES = ['admin', 'coordinador_general', 'coordinador', 'laboratorista'];

router.use(express.urlencoded({ extended: true }));
router.use(express.json());

function requireAdminOnly(req, res, next) {
  const user = req.session?.user;
  const sessionRoles = Array.isArray(user?.roles) ? user.roles : [user?.roles];
  const roles = normalizeRoles([...sessionRoles, user?.tipo]);

  if (!user || !roles.includes('admin') || user.__impersonating) {
    return renderAuthError(res, {
      message: 'Acceso denegado',
      message2: 'Solo los administradores autorizados pueden gestionar gestores de laboratorio.',
      limit: 'loginOnly',
    });
  }

  return next();
}

function parsePositiveInteger(value) {
  const normalized = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseUalIds(rawValue) {
  const values = rawValue === undefined ? [] : Array.isArray(rawValue) ? rawValue : [rawValue];
  const parsed = [];

  for (const value of values) {
    const id = parsePositiveInteger(value);
    if (!id) return null;
    parsed.push(id);
  }

  return Array.from(new Set(parsed));
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadPageData() {
  const [usersResult, managersResult, ualOptions, roleResult] = await Promise.all([
    pool.query(
      `
        SELECT u.id, u.nombre, u.documento, u.correo
        FROM usuario u
        WHERE u.activo = TRUE
          AND NOT EXISTS (
            SELECT 1
            FROM usuario_rol ur
            JOIN rol r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id
              AND ur.activo = TRUE
              AND r.nombre = ANY($1::varchar[])
          )
          AND NOT EXISTS (
            SELECT 1
            FROM usuario_rol ur
            JOIN rol r ON r.id = ur.rol_id
            WHERE ur.usuario_id = u.id
              AND r.nombre = $2
          )
        ORDER BY u.nombre ASC, u.documento ASC
      `,
      [PRIVILEGED_ROLES, ROLE_NAME]
    ),
    pool.query(
      `
        SELECT
          u.id,
          u.nombre,
          u.documento,
          u.correo,
          u.activo AS cuenta_activa,
          ur.activo AS rol_activo,
          COALESCE((
            SELECT json_agg(
              json_build_object(
                'ual_id', ual.ual_id,
                'nombre', ual.nombre,
                'facultad_nombre', facultad.nombre,
                'activo', asignacion.activo
              )
              ORDER BY facultad.nombre ASC NULLS LAST, ual.nombre ASC
            )
            FROM usuario_ual_rol_operativo asignacion
            JOIN ual ON ual.ual_id = asignacion.ual_id
            LEFT JOIN dependencia_facultad facultad
              ON facultad.dependencia_facultad_id = ual.facultad_id
            WHERE asignacion.usuario_id = u.id
              AND asignacion.rol_id = r.id
          ), '[]'::json) AS asignaciones
        FROM usuario_rol ur
        JOIN rol r ON r.id = ur.rol_id
        JOIN usuario u ON u.id = ur.usuario_id
        WHERE r.nombre = $1
        ORDER BY u.nombre ASC, u.documento ASC
      `,
      [ROLE_NAME]
    ),
    fetchActiveUalOptions(pool),
    pool.query('SELECT id FROM rol WHERE nombre = $1 AND activo = TRUE LIMIT 1', [ROLE_NAME]),
  ]);

  return {
    candidates: usersResult.rows || [],
    managers: managersResult.rows || [],
    ualOptions: ualOptions || [],
    roleConfigured: Boolean(roleResult.rows?.length),
  };
}

async function renderPage(req, res, options = {}) {
  try {
    const data = await loadPageData();
    res.setHeader('Cache-Control', 'no-store');
    if (options.status) res.status(options.status);

    return res.render('home/gestores_laboratorio', {
      error: options.error || null,
      success: options.success || null,
      formValues: options.formValues || {},
      ...data,
    });
  } catch (error) {
    console.error('Error cargando la gestión de gestores de laboratorio:', error);
    return renderApplicationError(
      res,
      {
        message: '¡Algo ha salido mal!',
        message2: 'No fue posible cargar la gestión de gestores de laboratorio.',
        limit: null,
      },
      req,
      error
    );
  }
}

async function writeAuditLog(client, req, action, document) {
  const actor = req.session?.user || {};
  const actorDocument = normalizeLogDocument(actor.documento_real || actor.documento || '');
  const actorName = String(actor.tipo || 'admin').trim() || 'admin';

  await client.query(
    'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
    [actorName, actorDocument || null, action, document || null]
  );
}

router.get('/', requireAdminOnly, async (req, res) => renderPage(req, res));

router.post('/guardar', requireAdminOnly, async (req, res) => {
  const userId = parsePositiveInteger(req.body?.user_id);
  const ualIds = parseUalIds(req.body?.ual_ids);

  if (!userId || !ualIds) {
    return renderPage(req, res, {
      status: 400,
      error: 'Selecciona una cuenta existente y asignaciones de UAL válidas.',
    });
  }

  if (!ualIds.length) {
    return renderPage(req, res, {
      status: 400,
      error: 'Asigna al menos una UAL activa al gestor de laboratorio.',
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const roleResult = await client.query(
      'SELECT id FROM rol WHERE nombre = $1 AND activo = TRUE LIMIT 1',
      [ROLE_NAME]
    );
    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      throw requestError(
        'El rol Gestor de laboratorio no está configurado. Aplica la migración correspondiente.',
        503
      );
    }

    const userResult = await client.query(
      'SELECT id, documento FROM usuario WHERE id = $1 AND activo = TRUE FOR UPDATE',
      [userId]
    );
    const target = userResult.rows[0];
    if (!target) {
      throw requestError('La cuenta seleccionada no existe o está inactiva.', 404);
    }

    const conflictingRoles = await client.query(
      `
        SELECT r.nombre
        FROM usuario_rol ur
        JOIN rol r ON r.id = ur.rol_id
        WHERE ur.usuario_id = $1
          AND ur.activo = TRUE
          AND r.nombre = ANY($2::varchar[])
        LIMIT 1
      `,
      [userId, PRIVILEGED_ROLES]
    );
    if (conflictingRoles.rows.length) {
      throw requestError(
        'No se puede asignar este rol a una cuenta con permisos administrativos o de laboratorista.'
      );
    }

    const validUals = await client.query(
      'SELECT ual_id FROM ual WHERE activo = TRUE AND ual_id = ANY($1::int[])',
      [ualIds]
    );
    if (validUals.rows.length !== ualIds.length) {
      throw requestError('Todas las UAL seleccionadas deben existir y estar activas.');
    }

    const existingRole = await client.query(
      'SELECT activo FROM usuario_rol WHERE usuario_id = $1 AND rol_id = $2 FOR UPDATE',
      [userId, roleId]
    );

    await client.query(
      `
        INSERT INTO usuario_rol (usuario_id, rol_id, activo)
        VALUES ($1, $2, TRUE)
        ON CONFLICT (usuario_id, rol_id) DO UPDATE
        SET activo = TRUE,
            fecha_modificacion = CURRENT_TIMESTAMP
      `,
      [userId, roleId]
    );

    await ensureOperationalRoleAssignmentsSchema(client);
    await replaceOperationalRoleAssignments({
      userId,
      roleName: ROLE_NAME,
      ualIds,
      createdByUserId: parsePositiveInteger(req.session?.user?.id),
      client,
    });

    const action = existingRole.rows[0]?.activo
      ? 'Actualizar asignaciones de Gestor de laboratorio'
      : 'Asignar rol Gestor de laboratorio';
    await writeAuditLog(client, req, action, target.documento);

    await client.query('COMMIT');
    return renderPage(req, res, {
      success: `Se actualizaron los accesos de ${target.documento}.`,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo asignaciones de gestores de laboratorio:', rollbackError);
      }
    }

    if (error.status) {
      return renderPage(req, res, {
        status: error.status,
        error: error.message,
      });
    }

    console.error('Error asignando el rol Gestor de laboratorio:', error);
    return renderPage(req, res, {
      status: 500,
      error: 'No fue posible guardar la asignación del gestor de laboratorio.',
    });
  } finally {
    if (client) client.release();
  }
});

router.post('/:userId/desactivar', requireAdminOnly, async (req, res) => {
  const userId = parsePositiveInteger(req.params.userId);
  if (!userId) {
    return renderPage(req, res, {
      status: 400,
      error: 'La cuenta seleccionada no es válida.',
    });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const roleResult = await client.query(
      'SELECT id FROM rol WHERE nombre = $1 AND activo = TRUE LIMIT 1',
      [ROLE_NAME]
    );
    const roleId = roleResult.rows[0]?.id;
    if (!roleId) {
      throw requestError(
        'El rol Gestor de laboratorio no está configurado. Aplica la migración correspondiente.',
        503
      );
    }

    const assignmentResult = await client.query(
      `
        SELECT ur.activo, u.documento
        FROM usuario_rol ur
        JOIN usuario u ON u.id = ur.usuario_id
        WHERE ur.usuario_id = $1
          AND ur.rol_id = $2
        FOR UPDATE OF ur
      `,
      [userId, roleId]
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) {
      throw requestError('La cuenta no tiene asignado el rol Gestor de laboratorio.', 404);
    }

    if (assignment.activo) {
      await client.query(
        `
          UPDATE usuario_rol
          SET activo = FALSE, fecha_modificacion = CURRENT_TIMESTAMP
          WHERE usuario_id = $1 AND rol_id = $2
        `,
        [userId, roleId]
      );
      await ensureOperationalRoleAssignmentsSchema(client);
      await client.query(
        `
          UPDATE usuario_ual_rol_operativo
          SET activo = FALSE, fecha_modificacion = CURRENT_TIMESTAMP
          WHERE usuario_id = $1 AND rol_id = $2 AND activo = TRUE
        `,
        [userId, roleId]
      );
      await writeAuditLog(
        client,
        req,
        'Desactivar rol Gestor de laboratorio',
        assignment.documento
      );
    }

    await client.query('COMMIT');
    return renderPage(req, res, {
      success: assignment.activo
        ? `Se desactivó el acceso de ${assignment.documento}.`
        : 'El acceso del gestor ya estaba desactivado.',
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo desactivación de gestores de laboratorio:', rollbackError);
      }
    }

    if (error.status) {
      return renderPage(req, res, {
        status: error.status,
        error: error.message,
      });
    }

    console.error('Error desactivando el rol Gestor de laboratorio:', error);
    return renderPage(req, res, {
      status: 500,
      error: 'No fue posible desactivar el acceso del gestor de laboratorio.',
    });
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
