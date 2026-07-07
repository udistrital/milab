const express = require('express');
const { body, validationResult } = require('express-validator');
const { requestOati, getAcademicServicePath } = require('../../libs/oati-client');
const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const {
  ensureOperationalRoleAssignmentsSchema,
  replaceOperationalRoleAssignments,
} = require('../../libs/operational-role-assignments');
const {
  ensureMonitorSchema,
  fetchMonitorByDocumento,
  upsertMonitorProfile,
} = require('../../libs/monitor-registry');
const { APP_PERMISSIONS } = require('../../libs/permissions');
const { ensurePerfilEstudiante } = require('../../libs/user-identity');
const { requirePermissions } = require('../middlewares/auth');
const limiter = require('../middlewares/limiter');
const { securityLogger } = require('../middlewares/security-logger');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireMonitorRegistrationAccess = requirePermissions(APP_PERMISSIONS.USERS_MONITOR_MANAGE, {
  message: 'Acceso denegado',
  message2: 'No tienes permisos para registrar monitores.',
  limit: 'loginOnly',
});

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
}

function resolveOatiEmail(payload) {
  return normalizeEmail(
    payload?.correo ||
      payload?.email ||
      payload?.correo_institucional ||
      payload?.email_institucional ||
      payload?.correoInstitucional ||
      payload?.emailInstitucional ||
      ''
  );
}

function normalizeEstado(value) {
  return (value || '').toString().trim().toUpperCase();
}

function isActiveStudentRecord(record) {
  return normalizeEstado(record?.estado) === 'A';
}

function normalizeSelectedUalIds(rawValue) {
  const values = Array.isArray(rawValue) ? rawValue : [rawValue];

  return [
    ...new Set(
      values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    ),
  ];
}

function normalizeCoordinatorDocument(value) {
  return String(value || '').trim();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeOptionalDate(value) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalizedValue) ? normalizedValue : null;
}

function resolveSelectedCoordinatorDocument(source) {
  return normalizeCoordinatorDocument(source?.coordinador_documento);
}

function resolveMonitorFormValues(source = {}, existingMonitor = null, lookupData = null) {
  return {
    correo:
      normalizeEmail(source?.correo) ||
      normalizeEmail(existingMonitor?.correo) ||
      normalizeEmail(lookupData?.correo) ||
      '',
    numero_contrato:
      normalizeText(source?.numero_contrato) ||
      normalizeText(existingMonitor?.numero_contrato) ||
      '',
    tipo_vinculacion:
      normalizeText(source?.tipo_vinculacion) ||
      normalizeText(existingMonitor?.tipo_vinculacion) ||
      '',
    fecha_inicio:
      normalizeOptionalDate(source?.fecha_inicio) ||
      normalizeOptionalDate(existingMonitor?.fecha_inicio) ||
      '',
    fecha_fin:
      normalizeOptionalDate(source?.fecha_fin) ||
      normalizeOptionalDate(existingMonitor?.fecha_fin) ||
      '',
    soporte_contrato:
      normalizeText(source?.soporte_contrato) ||
      normalizeText(existingMonitor?.soporte_contrato) ||
      '',
    facultad_id: Number(source?.facultad_id) > 0 ? Number(source?.facultad_id) : null,
    ual_ids: normalizeSelectedUalIds(source?.ual_ids),
  };
}

async function lookupActiveStudentByDocumento(documento) {
  try {
    const data = await requestOati(
      getAcademicServicePath(`datos_basicos_activos_cedula/${String(documento || '').trim()}`)
    );

    const collection = data?.datosEstudianteCollection?.datosBasicosEstudiante || [];
    const student = collection.find((item) => isActiveStudentRecord(item));
    if (!student) return null;

    return {
      documento: String(documento || '').trim(),
      nombre: student.nombre || '',
      correo: resolveOatiEmail(student),
      codigo: student.codigo || student.cod_estudiante || '',
      programa:
        student.proyecto_curricular ||
        student.proyectoCurricular ||
        student.carrera ||
        student.programa ||
        '',
      estado: student.estado || 'A',
    };
  } catch {
    return null;
  }
}

async function resolveCoordinatorScopeByDocument(client, coordinatorDocument) {
  const normalizedDocument = normalizeCoordinatorDocument(coordinatorDocument);
  if (!normalizedDocument) {
    return {
      coordinatorDocument: null,
      facultyIds: [],
    };
  }

  const coordinatorRes = await client.query(
    'SELECT documento FROM coordinador WHERE documento = $1 LIMIT 1',
    [normalizedDocument]
  );

  if (!coordinatorRes.rows.length) {
    return {
      coordinatorDocument: null,
      facultyIds: [],
    };
  }

  const facultiesRes = await client.query(
    'SELECT facultad_id FROM coordinador_facultad WHERE coordinador_documento_id = $1',
    [normalizedDocument]
  );

  return {
    coordinatorDocument: normalizedDocument,
    facultyIds: [
      ...new Set(
        facultiesRes.rows
          .map((row) => Number(row.facultad_id))
          .filter((value) => Number.isInteger(value) && value > 0)
      ),
    ],
  };
}

async function fetchCoordinatorOptions(client) {
  const result = await client.query(
    `SELECT c.documento,
            c.nombre,
            COALESCE(STRING_AGG(DISTINCT f.nombre, ', ' ORDER BY f.nombre), '') AS facultades
     FROM coordinador c
     LEFT JOIN coordinador_facultad cf ON cf.coordinador_documento_id = c.documento
     LEFT JOIN facultad f ON f.facultad_id = cf.facultad_id
     GROUP BY c.documento, c.nombre
     ORDER BY c.nombre ASC`
  );

  return result.rows || [];
}

async function buildRegisterMonitorViewContext(sessionUser, options = {}) {
  const selectedCoordinatorDocument = normalizeCoordinatorDocument(
    options.selectedCoordinatorDocument
  );

  if (sessionUser?.tipo === 'coordinador') {
    const scope = await resolveCoordinatorScope(pool, sessionUser.documento);
    const facultyIds = (scope.facultyIds || []).map(Number).filter(Number.isInteger);

    return {
      facultades: facultyIds.length
        ? (
            await pool.query(
              'SELECT * FROM facultad WHERE facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
              [facultyIds]
            )
          ).rows
        : [],
      uals: facultyIds.length
        ? (
            await pool.query(
              'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
              [facultyIds]
            )
          ).rows
        : [],
      tipo: sessionUser.tipo,
      documento: sessionUser.documento,
      coordinadores: [],
      selectedCoordinatorDocument: '',
    };
  }

  if (sessionUser?.tipo === 'admin') {
    const coordinadores = await fetchCoordinatorOptions(pool);
    let facultades = [];
    let uals = [];

    if (selectedCoordinatorDocument) {
      const scope = await resolveCoordinatorScopeByDocument(pool, selectedCoordinatorDocument);
      if (scope.facultyIds.length) {
        facultades = (
          await pool.query(
            'SELECT * FROM facultad WHERE facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
            [scope.facultyIds]
          )
        ).rows;
        uals = (
          await pool.query(
            'SELECT ual_id, nombre, codigo_abreviacion, descripcion, sal_id_espacio, sal_ocupantes, facultad_id, activo FROM ual WHERE activo = TRUE AND facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
            [scope.facultyIds]
          )
        ).rows;
      }
    }

    return {
      facultades,
      uals,
      tipo: sessionUser.tipo,
      documento: sessionUser.documento,
      coordinadores,
      selectedCoordinatorDocument,
    };
  }

  return {
    facultades: [],
    uals: [],
    tipo: sessionUser?.tipo || '',
    documento: sessionUser?.documento || '',
    coordinadores: [],
    selectedCoordinatorDocument: '',
  };
}

async function renderRegisterMonitorWithError(req, res, error, extras = {}) {
  const source = req.body || req.query || {};
  const documento = normalizeText(source.documento);
  const lookupData = /^\d+$/.test(documento)
    ? await lookupActiveStudentByDocumento(documento)
    : null;
  const existingMonitor = lookupData ? await fetchMonitorByDocumento(documento) : null;
  const viewContext = await buildRegisterMonitorViewContext(req.session?.user || null, {
    selectedCoordinatorDocument: resolveSelectedCoordinatorDocument(source),
  });

  return res.render('home/register_monitor', {
    error,
    lookupData,
    lookupMessage: lookupData ? 'Estudiante activo validado.' : null,
    lookupStatus: lookupData ? 'success' : null,
    lookupDocumento: documento,
    successMessage: null,
    formValues: resolveMonitorFormValues(source, existingMonitor, lookupData),
    ...extras,
    ...viewContext,
  });
}

async function ensureRoleAssignment(client, userId, roleName) {
  await client.query(
    `
      INSERT INTO usuario_rol (usuario_id, rol_id, activo)
      SELECT $1, r.id, TRUE
      FROM rol r
      WHERE r.nombre = $2
      ON CONFLICT (usuario_id, rol_id) DO UPDATE
      SET activo = TRUE,
          fecha_modificacion = CURRENT_TIMESTAMP
    `,
    [userId, roleName]
  );
}

async function resolveActorDocumentForLogs(sessionUser, client) {
  if (sessionUser?.tipo !== 'coordinador') {
    return sessionUser?.documento_real || sessionUser?.documento || '0';
  }

  const result = await client.query('SELECT documento FROM coordinador WHERE nombre_u = $1', [
    sessionUser.documento,
  ]);

  return result.rows[0]?.documento || sessionUser.documento || '0';
}

router.get('/load_info', requireMonitorRegistrationAccess, async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    await ensureMonitorSchema(pool);
    const viewContext = await buildRegisterMonitorViewContext(req.session.user, {
      selectedCoordinatorDocument: resolveSelectedCoordinatorDocument(req.query || {}),
    });
    const documentoQuery = (req.query.documento || '').toString().trim();
    let lookupData = null;
    let lookupMessage = null;
    let lookupStatus = null;

    let existingMonitor = null;
    if (documentoQuery) {
      if (!/^\d+$/.test(documentoQuery)) {
        lookupMessage = 'Ingresa un numero de documento valido.';
        lookupStatus = 'danger';
      } else {
        lookupData = await lookupActiveStudentByDocumento(documentoQuery);

        if (lookupData) {
          existingMonitor = await fetchMonitorByDocumento(documentoQuery);
          lookupMessage = 'Estudiante activo encontrado en OATI.';
          lookupStatus = 'success';
        } else {
          lookupMessage =
            'No se encontró un estudiante activo con ese documento. El monitor debe ser estudiante activo.';
          lookupStatus = 'warning';
        }
      }
    }

    return res.render('home/register_monitor', {
      error: null,
      successMessage: null,
      lookupData,
      lookupMessage,
      lookupStatus,
      lookupDocumento: documentoQuery,
      formValues: resolveMonitorFormValues(req.query || {}, existingMonitor, lookupData),
      ...viewContext,
    });
  } catch (error) {
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'No fue posible cargar el registro de monitores.',
      limit: null,
    });
  }
});

router.get('/', requireMonitorRegistrationAccess, function (req, res) {
  return res.redirect(`${req.baseUrl}/load_info`);
});

router.post(
  '/',
  limiter,
  securityLogger,
  requireMonitorRegistrationAccess,
  [
    body('correo')
      .trim()
      .notEmpty()
      .withMessage('Debes ingresar un correo institucional.')
      .bail()
      .isEmail()
      .withMessage('Ingresa un correo electrónico válido.')
      .bail()
      .customSanitizer((value) => normalizeEmail(value))
      .custom((value) => value.endsWith('@udistrital.edu.co'))
      .withMessage('Solo se permiten correos institucionales (@udistrital.edu.co)'),
    body('numero_contrato')
      .trim()
      .notEmpty()
      .withMessage('Debes ingresar el numero de contrato del monitor.'),
  ],
  async function (req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return renderRegisterMonitorWithError(
        req,
        res,
        errors
          .array()
          .map((item) => item.msg)
          .join('. ')
      );
    }

    const payload = req.body || {};
    const selectedFacultyId = Number(payload.facultad_id);
    const selectedUalIds = normalizeSelectedUalIds(payload.ual_ids);
    const selectedCoordinatorDocument = resolveSelectedCoordinatorDocument(payload);
    const documento = String(payload.documento || '').trim();
    const correo = normalizeEmail(payload.correo);
    const numeroContrato = normalizeText(payload.numero_contrato);
    const tipoVinculacion = normalizeText(payload.tipo_vinculacion);
    const fechaInicio = normalizeOptionalDate(payload.fecha_inicio);
    const fechaFin = normalizeOptionalDate(payload.fecha_fin);
    const soporteContrato = normalizeText(payload.soporte_contrato);

    if (!selectedFacultyId || !selectedUalIds.length) {
      return renderRegisterMonitorWithError(
        req,
        res,
        'Debes seleccionar una facultad y al menos un laboratorio.'
      );
    }

    if (!documento || !/^\d+$/.test(documento)) {
      return renderRegisterMonitorWithError(req, res, 'Debes ingresar un documento valido.');
    }

    if (payload.fecha_inicio && !fechaInicio) {
      return renderRegisterMonitorWithError(
        req,
        res,
        'La fecha de inicio de la vinculacion no es valida.'
      );
    }

    if (payload.fecha_fin && !fechaFin) {
      return renderRegisterMonitorWithError(
        req,
        res,
        'La fecha de fin de la vinculacion no es valida.'
      );
    }

    if (fechaInicio && fechaFin && fechaFin < fechaInicio) {
      return renderRegisterMonitorWithError(
        req,
        res,
        'La fecha de fin no puede ser anterior a la fecha de inicio.'
      );
    }

    try {
      if (req.session.user.tipo === 'admin') {
        if (!selectedCoordinatorDocument) {
          return renderRegisterMonitorWithError(
            req,
            res,
            'Debes seleccionar el coordinador responsable antes de registrar el monitor.'
          );
        }

        const scope = await resolveCoordinatorScopeByDocument(pool, selectedCoordinatorDocument);
        if (!scope.coordinatorDocument || !scope.facultyIds.includes(selectedFacultyId)) {
          return renderRegisterMonitorWithError(
            req,
            res,
            'La facultad seleccionada no pertenece al coordinador indicado.'
          );
        }
      } else {
        const scope = await resolveCoordinatorScope(pool, req.session.user.documento);
        if (!scope.coordinatorDocument || !(scope.facultyIds || []).includes(selectedFacultyId)) {
          return renderRegisterMonitorWithError(
            req,
            res,
            'No tienes permisos para registrar monitores fuera de tus facultades asociadas.'
          );
        }
      }

      const ualRes = await pool.query(
        'SELECT ual_id FROM ual WHERE activo = TRUE AND facultad_id = $1 AND ual_id = ANY($2::int[])',
        [selectedFacultyId, selectedUalIds]
      );

      if (ualRes.rows.length !== selectedUalIds.length) {
        return renderRegisterMonitorWithError(
          req,
          res,
          'Todos los laboratorios seleccionados deben pertenecer a la facultad indicada.'
        );
      }

      const activeStudent = await lookupActiveStudentByDocumento(documento);
      if (!activeStudent) {
        return renderRegisterMonitorWithError(
          req,
          res,
          'El usuario debe ser un estudiante activo para registrarse como monitor.'
        );
      }

      const finalCorreo = correo || normalizeEmail(activeStudent.correo);
      if (!finalCorreo || !finalCorreo.endsWith('@udistrital.edu.co')) {
        return renderRegisterMonitorWithError(
          req,
          res,
          'El monitor debe tener un correo institucional activo.'
        );
      }

      let client;
      try {
        client = await pool.connect();
        await client.query('BEGIN');
        await ensureOperationalRoleAssignmentsSchema(client);
        await ensureMonitorSchema(client);

        const usuarioId = await ensurePerfilEstudiante({
          documento,
          nombre: activeStudent.nombre || payload.nombre,
          codigo: activeStudent.codigo || null,
          programa: activeStudent.programa || null,
          estado: activeStudent.estado || 'A',
          correo: finalCorreo,
        });

        if (!usuarioId) {
          throw new Error('No fue posible asegurar la identidad base del monitor.');
        }

        const conflictingRoles = await client.query(
          `
            SELECT r.nombre
            FROM usuario_rol ur
            JOIN rol r ON r.id = ur.rol_id
            WHERE ur.usuario_id = $1
              AND ur.activo = TRUE
              AND r.nombre IN ('admin', 'coordinador', 'laboratorista')
          `,
          [usuarioId]
        );

        if (conflictingRoles.rows.length) {
          await client.query('ROLLBACK');
          return renderRegisterMonitorWithError(
            req,
            res,
            'No puedes registrar como monitor a un usuario con rol administrativo o de laboratorista.'
          );
        }

        await ensureRoleAssignment(client, usuarioId, 'estudiante');
        await ensureRoleAssignment(client, usuarioId, 'monitor');
        await upsertMonitorProfile(
          {
            documento,
            nombre: activeStudent.nombre || payload.nombre,
            correo: finalCorreo,
            numeroContrato,
            tipoVinculacion,
            fechaInicio,
            fechaFin,
            soporteContrato,
            usuarioId,
            activo: true,
          },
          client
        );
        await replaceOperationalRoleAssignments({
          userId: usuarioId,
          roleName: 'monitor',
          ualIds: selectedUalIds,
          facultyId: selectedFacultyId,
          createdByUserId: req.session.user?.id || null,
          client,
        });

        const actorDocument = await resolveActorDocumentForLogs(req.session.user, client);
        await client.query(
          'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
          [req.session.user.tipo, actorDocument, 'Registrar monitor', documento]
        );

        await client.query('COMMIT');
      } catch (error) {
        if (client) {
          await client.query('ROLLBACK');
        }
        throw error;
      } finally {
        if (client) client.release();
      }

      const viewContext = await buildRegisterMonitorViewContext(req.session.user, {
        selectedCoordinatorDocument,
      });
      return res.render('home/register_monitor', {
        error: null,
        successMessage: 'Monitor registrado o actualizado correctamente.',
        lookupData: activeStudent,
        lookupMessage: 'Estudiante activo validado.',
        lookupStatus: 'success',
        lookupDocumento: documento,
        formValues: resolveMonitorFormValues(
          payload,
          {
            correo: finalCorreo,
            numero_contrato: numeroContrato,
            tipo_vinculacion: tipoVinculacion,
            fecha_inicio: fechaInicio,
            fecha_fin: fechaFin,
            soporte_contrato: soporteContrato,
          },
          activeStudent
        ),
        ...viewContext,
      });
    } catch (error) {
      console.error('Error registrando monitor:', error);
      return renderRegisterMonitorWithError(
        req,
        res,
        'No fue posible registrar el monitor. Intentalo nuevamente.'
      );
    }
  }
);

module.exports = router;
