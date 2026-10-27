const express = require('express');

const pool = require('../../libs/db');
const { normalizeLogDocument } = require('../../libs/account-email');
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

function normalizeEmail(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

function validateNewManager(values) {
  if (!values.name || !values.document || !values.email) {
    return 'Nombre, documento y correo institucional son obligatorios.';
  }
  if (values.name.length > 200 || values.document.length > 50 || values.email.length > 255) {
    return 'Verifica la longitud del nombre, documento y correo.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) {
    return 'Ingresa un correo válido.';
  }
  if (!values.email.endsWith('@udistrital.edu.co')) {
    return 'El correo debe ser institucional (@udistrital.edu.co).';
  }
  return null;
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function loadPageData() {
  const [usersResult, managersResult, roleResult] = await Promise.all([
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
          ur.activo AS rol_activo
        FROM usuario_rol ur
        JOIN rol r ON r.id = ur.rol_id
        JOIN usuario u ON u.id = ur.usuario_id
        WHERE r.nombre = $1
        ORDER BY u.nombre ASC, u.documento ASC
      `,
      [ROLE_NAME]
    ),
    pool.query('SELECT id FROM rol WHERE nombre = $1 AND activo = TRUE LIMIT 1', [ROLE_NAME]),
  ]);

  return {
    candidates: usersResult.rows || [],
    managers: managersResult.rows || [],
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
      newManagerValues: options.newManagerValues || {},
      editManagerValues: options.editManagerValues || {},
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

async function deactivateManagerUalAssignments(client, userId, roleId) {
  const tableResult = await client.query(
    `SELECT to_regclass('milab.usuario_ual_rol_operativo') AS tabla`
  );
  if (!tableResult.rows[0]?.tabla) return;

  await client.query(
    `
      UPDATE usuario_ual_rol_operativo
      SET activo = FALSE, fecha_modificacion = CURRENT_TIMESTAMP
      WHERE usuario_id = $1 AND rol_id = $2 AND activo = TRUE
    `,
    [userId, roleId]
  );
}

router.get('/', requireAdminOnly, async (req, res) => renderPage(req, res));

router.post('/crear', requireAdminOnly, async (req, res) => {
  const newManagerValues = {
    name: String(req.body?.nombre ?? '').trim(),
    document: String(req.body?.documento ?? '').trim(),
    email: normalizeEmail(req.body?.correo),
  };
  const validationError = validateNewManager(newManagerValues);
  if (validationError) {
    return renderPage(req, res, {
      status: 400,
      error: validationError,
      newManagerValues,
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
    const roleId = parsePositiveInteger(roleResult.rows[0]?.id);
    if (!roleId) {
      throw requestError(
        'El rol Gestor de laboratorio no está configurado. Aplica la migración correspondiente.',
        503
      );
    }

    const existingAccount = await client.query(
      `
        SELECT id
        FROM usuario
        WHERE documento = $1 OR LOWER(correo) = $2
        LIMIT 1
        FOR UPDATE
      `,
      [newManagerValues.document, newManagerValues.email]
    );
    if (existingAccount.rows.length) {
      throw requestError(
        'Ya existe una cuenta con ese documento o correo. Usa la sección para asignar el rol a una cuenta existente.',
        409
      );
    }

    const userResult = await client.query(
      'INSERT INTO usuario (correo, documento, nombre) VALUES ($1, $2, $3) RETURNING id',
      [newManagerValues.email, newManagerValues.document, newManagerValues.name]
    );
    const userId = parsePositiveInteger(userResult.rows[0]?.id);
    if (!userId) {
      throw new Error('No se obtuvo el identificador de la cuenta creada.');
    }

    await client.query(
      'INSERT INTO usuario_rol (usuario_id, rol_id, activo) VALUES ($1, $2, TRUE)',
      [userId, roleId]
    );
    await writeAuditLog(
      client,
      req,
      'Crear cuenta y asignar rol Gestor de laboratorio',
      newManagerValues.document
    );

    await client.query('COMMIT');
    return renderPage(req, res, {
      success: `Se creó la cuenta de ${newManagerValues.name} y se asignó el rol Gestor de laboratorio, sin asociar UAL.`,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo la creación de un gestor de laboratorio:', rollbackError);
      }
    }

    if (error.status || error.code === '23505') {
      return renderPage(req, res, {
        status: error.status || 409,
        error:
          error.message ||
          'Ya existe una cuenta con ese documento o correo. Usa la sección para asignar el rol a una cuenta existente.',
        newManagerValues,
      });
    }

    console.error('Error creando una cuenta Gestor de laboratorio:', error);
    return renderPage(req, res, {
      status: 500,
      error: 'No fue posible crear la cuenta del gestor de laboratorio.',
      newManagerValues,
    });
  } finally {
    if (client) client.release();
  }
});

async function enrollExistingManager(req, res) {
  const userId = parsePositiveInteger(req.body?.user_id);
  if (!userId) {
    return renderPage(req, res, {
      status: 400,
      error: 'Selecciona una cuenta existente válida.',
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
    const roleId = parsePositiveInteger(roleResult.rows[0]?.id);
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

    await deactivateManagerUalAssignments(client, userId, roleId);

    const action = existingRole.rows[0]?.activo
      ? 'Confirmar enrolamiento como Gestor de laboratorio'
      : 'Enrolar como Gestor de laboratorio';
    await writeAuditLog(client, req, action, target.documento);

    await client.query('COMMIT');
    return renderPage(req, res, {
      success: `Se enroló a ${target.documento} como Gestor de laboratorio con cobertura universitaria, sin UAL.`,
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

    console.error('Error enrolando una cuenta como Gestor de laboratorio:', error);
    return renderPage(req, res, {
      status: 500,
      error: 'No fue posible enrolar la cuenta como gestor de laboratorio.',
    });
  } finally {
    if (client) client.release();
  }
}

router.post(['/enrolar', '/guardar'], requireAdminOnly, enrollExistingManager);

router.post('/editar', requireAdminOnly, async (req, res) => {
  const editManagerValues = {
    userId: parsePositiveInteger(req.body?.user_id),
    name: String(req.body?.nombre ?? '').trim(),
    document: String(req.body?.documento ?? '').trim(),
    email: normalizeEmail(req.body?.correo),
  };
  const validationError = editManagerValues.userId
    ? validateNewManager(editManagerValues)
    : 'La cuenta seleccionada no es válida.';
  if (validationError) {
    return renderPage(req, res, {
      status: 400,
      error: validationError,
      editManagerValues,
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
    const roleId = parsePositiveInteger(roleResult.rows[0]?.id);
    if (!roleId) {
      throw requestError(
        'El rol Gestor de laboratorio no está configurado. Aplica la migración correspondiente.',
        503
      );
    }

    const userResult = await client.query(
      'SELECT id, documento FROM usuario WHERE id = $1 FOR UPDATE',
      [editManagerValues.userId]
    );
    const target = userResult.rows[0];
    if (!target) {
      throw requestError('La cuenta seleccionada no existe.', 404);
    }

    const managerRoleResult = await client.query(
      'SELECT activo FROM usuario_rol WHERE usuario_id = $1 AND rol_id = $2 FOR UPDATE',
      [editManagerValues.userId, roleId]
    );
    if (!managerRoleResult.rows.length) {
      throw requestError('La cuenta seleccionada no tiene el rol Gestor de laboratorio.', 404);
    }

    const duplicateResult = await client.query(
      `
        SELECT id
        FROM usuario
        WHERE id <> $3
          AND (documento = $1 OR LOWER(correo) = $2)
        LIMIT 1
        FOR UPDATE
      `,
      [editManagerValues.document, editManagerValues.email, editManagerValues.userId]
    );
    if (duplicateResult.rows.length) {
      throw requestError('Ya existe otra cuenta con ese documento o correo.', 409);
    }

    await client.query(
      `
        UPDATE usuario
        SET nombre = $1,
            documento = $2,
            correo = $3,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $4
      `,
      [
        editManagerValues.name,
        editManagerValues.document,
        editManagerValues.email,
        editManagerValues.userId,
      ]
    );
    await client.query(
      `
        UPDATE perfil_estudiante
        SET nombre = $1,
            documento = $2,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE usuario_id = $3
      `,
      [editManagerValues.name, editManagerValues.document, editManagerValues.userId]
    );
    await client.query(
      `
        UPDATE perfil_docente
        SET nombre = $1,
            documento = $2,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE usuario_id = $3
      `,
      [editManagerValues.name, editManagerValues.document, editManagerValues.userId]
    );
    await writeAuditLog(
      client,
      req,
      'Editar cuenta de Gestor de laboratorio',
      editManagerValues.document
    );

    await client.query('COMMIT');
    return renderPage(req, res, {
      success: `Se actualizaron los datos de ${editManagerValues.document}.`,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo la edición de un gestor de laboratorio:', rollbackError);
      }
    }

    if (error.status || error.code === '23505') {
      return renderPage(req, res, {
        status: error.status || 409,
        error: error.message || 'Ya existe otra cuenta con ese documento o correo.',
        editManagerValues,
      });
    }

    console.error('Error editando una cuenta de Gestor de laboratorio:', error);
    return renderPage(req, res, {
      status: 500,
      error: 'No fue posible editar la cuenta del gestor de laboratorio.',
      editManagerValues,
    });
  } finally {
    if (client) client.release();
  }
});

router.post('/:userId/enrolar', requireAdminOnly, async (req, res) => {
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
    const roleId = parsePositiveInteger(roleResult.rows[0]?.id);
    if (!roleId) {
      throw requestError(
        'El rol Gestor de laboratorio no está configurado. Aplica la migración correspondiente.',
        503
      );
    }

    const assignmentResult = await client.query(
      `
        SELECT ur.activo, u.documento, u.activo AS cuenta_activa
        FROM usuario_rol ur
        JOIN usuario u ON u.id = ur.usuario_id
        WHERE ur.usuario_id = $1 AND ur.rol_id = $2
        FOR UPDATE OF ur
      `,
      [userId, roleId]
    );
    const assignment = assignmentResult.rows[0];
    if (!assignment) {
      throw requestError('La cuenta no tiene asignado el rol Gestor de laboratorio.', 404);
    }
    if (!assignment.cuenta_activa) {
      throw requestError('La cuenta está inactiva y no se puede enrolar.', 400);
    }
    if (!assignment.activo) {
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
          'No se puede enrolar esta cuenta porque tiene permisos administrativos o de laboratorista.'
        );
      }
    }

    if (!assignment.activo) {
      await client.query(
        `
          UPDATE usuario_rol
          SET activo = TRUE, fecha_modificacion = CURRENT_TIMESTAMP
          WHERE usuario_id = $1 AND rol_id = $2
        `,
        [userId, roleId]
      );
      await writeAuditLog(client, req, 'Reactivar rol Gestor de laboratorio', assignment.documento);
    }
    await deactivateManagerUalAssignments(client, userId, roleId);

    await client.query('COMMIT');
    return renderPage(req, res, {
      success: assignment.activo
        ? `El acceso de ${assignment.documento} ya estaba activo.`
        : `Se enroló nuevamente a ${assignment.documento} como Gestor de laboratorio, sin UAL.`,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo el enrolamiento de un gestor:', rollbackError);
      }
    }

    if (error.status) {
      return renderPage(req, res, {
        status: error.status,
        error: error.message,
      });
    }

    console.error('Error enrolando nuevamente un gestor de laboratorio:', error);
    return renderPage(req, res, {
      status: 500,
      error: 'No fue posible enrolar nuevamente al gestor de laboratorio.',
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
      await deactivateManagerUalAssignments(client, userId, roleId);
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
