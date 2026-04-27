const express = require('express');
const router = express.Router();

const pool = require('../../libs/db');
const {
  findEmailConflict,
  isInstitutionalEmail,
  isUniqueViolation,
  normalizeLogDocument,
  normalizeInstitutionalEmail,
} = require('../../libs/account-email');
const {
  resolveAcademicFacultyName,
  resolveCoordinatorFacultyNames,
} = require('../../libs/faculty-scope');
const { requireJsonRoles, requireRoles } = require('../middlewares/auth');

router.use(express.urlencoded({ extended: true }));

const requireAdminOrCoordinadorStudentsAccess = requireRoles(['admin', 'coordinador'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver el dashboard',
  limit: 'noSession',
});

const requireAdminOrCoordinadorStudentsEdit = requireJsonRoles(['admin', 'coordinador'], {
  message: 'No tienes permisos para actualizar este correo.',
});

async function resolveActorDocumentForLogs(req, client) {
  if (req.session?.user?.tipo !== 'coordinador') {
    return req.session?.user?.documento;
  }

  const result = await client.query(
    'SELECT documento FROM coordinador_laboratorio WHERE nombre_u = $1',
    [req.session.user.documento]
  );

  return result.rows[0]?.documento || req.session.user.documento;
}

router.get('/', requireAdminOrCoordinadorStudentsAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  let client;

  try {
    const query =
      "SELECT u.nombre AS con_nombre, a.tipo AS con_tipo, u.documento AS con_documento, u.codigo AS con_codigo, u.carrera AS con_carrera, u.estado AS con_estado, u.correo AS con_correo FROM usuario u INNER JOIN auth a USING (documento) WHERE a.tipo IN ('estudiante', 'docente') ORDER BY u.nombre ASC";
    client = await pool.connect();

    const result = await client.query(query);
    let estudiantes = result.rows;

    if (req.session.user.tipo === 'coordinador') {
      const facultadesPermitidas = await resolveCoordinatorFacultyNames(
        client,
        req.session.user.documento
      );

      if (facultadesPermitidas.length === 0) {
        client.release();
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'El coordinador no tiene facultades asociadas.',
          limit: null,
        });
      }

      const facultadesPermitidasSet = new Set(facultadesPermitidas);
      estudiantes = estudiantes.filter((estudiante) => {
        const facultyName = resolveAcademicFacultyName(estudiante.con_carrera);
        return facultyName && facultadesPermitidasSet.has(facultyName);
      });
    }

    client.release();

    res.render('home/estudiantes_registrados', { estudiantes });
  } catch (error) {
    if (client) {
      client.release();
    }

    console.error('Error al obtener estudiantes:', error);
    res.status(500).send('Error al obtener estudiantes');
  }
});

router.post('/actualizar-correo', requireAdminOrCoordinadorStudentsEdit, async (req, res) => {
  const documento = String(req.body.documento || '').trim();
  const correo = normalizeInstitutionalEmail(req.body.correo);

  if (!documento) {
    return res.status(400).json({
      ok: false,
      message: 'Debes indicar el documento del usuario.',
    });
  }

  if (!isInstitutionalEmail(correo)) {
    return res.status(400).json({
      ok: false,
      message: 'Solo se permiten correos institucionales @udistrital.edu.co.',
    });
  }

  let client;

  try {
    client = await pool.connect();

    const userResult = await client.query(
      `
        SELECT u.documento, u.nombre, u.correo, u.carrera, a.tipo
        FROM usuario u
        INNER JOIN auth a USING (documento)
        WHERE u.documento = $1
          AND a.tipo IN ('estudiante', 'docente')
      `,
      [documento]
    );

    if (userResult.rows.length === 0) {
      client.release();
      return res.status(404).json({
        ok: false,
        message: 'No encontramos la cuenta seleccionada.',
      });
    }

    if (req.session.user.tipo === 'coordinador') {
      const facultadesPermitidas = await resolveCoordinatorFacultyNames(
        client,
        req.session.user.documento
      );
      const facultadesPermitidasSet = new Set(facultadesPermitidas);
      const facultyName = resolveAcademicFacultyName(userResult.rows[0].carrera);

      if (!facultyName || !facultadesPermitidasSet.has(facultyName)) {
        client.release();
        return res.status(403).json({
          ok: false,
          message: 'No tienes permisos para editar el correo de este usuario.',
        });
      }
    }

    const conflict = await findEmailConflict(client, correo, documento);

    if (conflict) {
      client.release();
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    await client.query('BEGIN');
    await client.query('UPDATE usuario SET correo = $1 WHERE documento = $2', [correo, documento]);
    await client.query('UPDATE auth SET correo = $1 WHERE documento = $2', [correo, documento]);

    const actorDocument = await resolveActorDocumentForLogs(req, client);

    await client.query(
      'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [
        req.session.user.tipo,
        normalizeLogDocument(actorDocument),
        'Actualizar correo usuario registrado',
        documento,
      ]
    );

    await client.query('COMMIT');
    client.release();

    return res.json({
      ok: true,
      correo,
      documento,
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir actualización de correo de usuario:', rollbackError);
      }
      client.release();
    }

    console.error('Error al actualizar correo de usuario:', error);

    if (isUniqueViolation(error)) {
      return res.status(409).json({
        ok: false,
        message: 'Ese correo ya existe vinculado a otra cuenta.',
      });
    }

    return res.status(500).json({
      ok: false,
      message: 'No fue posible actualizar el correo. Inténtalo nuevamente.',
    });
  }
});

module.exports = router;
