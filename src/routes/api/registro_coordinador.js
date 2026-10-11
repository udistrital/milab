const express = require('express');
const { requestOati, getAcademicServicePath } = require('../../libs/oati-client');
const pool = require('../../libs/db');
const jwt = require('jsonwebtoken');
const transporter = require('../../libs/mail');
const {
  NO_REPLY_NOTICE,
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
  buildNoReplyNoticeHtml,
  buildNoReplySender,
  escapeHtml,
} = require('../../libs/email-layout');
const { normalizeLogDocument } = require('../../libs/account-email');
const { appBaseUrl, buildAppUrl } = require('../../libs/app-url');
const { getRegistrationTokenSecret } = require('../../libs/registration-token');
const {
  ensureOperationalRoleAssignmentsSchema,
  replaceOperationalRoleAssignments,
} = require('../../libs/operational-role-assignments');
const { body, validationResult } = require('express-validator');
const limiter = require('../middlewares/limiter');
const { securityLogger } = require('../middlewares/security-logger');
const { requireRoles } = require('../middlewares/auth');
require('dotenv').config();

const router = express.Router();

const ROLE_COORDINADOR = 'coordinador';
const ROLE_COORDINADOR_GENERAL = 'coordinador_general';
const ALLOWED_COORDINATOR_REGISTRATION_ROLES = [ROLE_COORDINADOR, ROLE_COORDINADOR_GENERAL];

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

async function resolveExistingColumn(tableName, candidateColumns) {
  const candidates = Array.isArray(candidateColumns) ? candidateColumns : [];
  if (!candidates.length) {
    return null;
  }

  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'milab'
       AND table_name = $1
       AND column_name = ANY($2::text[])
     ORDER BY array_position($2::text[], column_name)
     LIMIT 1`,
    [tableName, candidates]
  );

  return result.rows[0]?.column_name || null;
}

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
}

function normalizeDocument(value) {
  return (value || '').toString().trim();
}

function resolveCoordinatorRegistrationRole(value) {
  const normalizedRole = (value || '').toString().trim().toLowerCase();
  if (ALLOWED_COORDINATOR_REGISTRATION_ROLES.includes(normalizedRole)) {
    return normalizedRole;
  }
  return ROLE_COORDINADOR;
}

function roleDisplayName(roleName) {
  return roleName === ROLE_COORDINADOR_GENERAL ? 'Coordinador General' : 'Coordinador';
}

function roleHasFacultyAssignments(roleName) {
  return roleName !== ROLE_COORDINADOR_GENERAL;
}

function parseIdList(input) {
  const values = Array.isArray(input) ? input : [input];
  return [...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0))];
}

function hasRequiredCoordinatorFields({
  needsFacultyAssignment,
  facultyId,
  assignmentScope,
  dependencyIds,
  ualIds,
  numeroResolucion,
  soporteResolucion,
}) {
  if (!numeroResolucion || !soporteResolucion) {
    return false;
  }

  if (
    needsFacultyAssignment &&
    (!Number.isInteger(facultyId) ||
      facultyId <= 0 ||
      !['facultad', 'dependencias', 'uales'].includes(assignmentScope) ||
      (assignmentScope === 'dependencias' && !dependencyIds.length) ||
      (assignmentScope === 'uales' && !ualIds.length))
  ) {
    return false;
  }

  return true;
}

async function resolveSelectedCoordinatorAssignments({
  needsFacultyAssignment,
  facultyId,
  assignmentScope,
  dependencyIds,
  ualIds,
}) {
  if (!needsFacultyAssignment) {
    return { assignmentIds: [], assignmentLabels: [], ualIds: [], errorPayload: null };
  }

  const facultyIdColumn = await resolveExistingColumn('dependencia_facultad', [
    'dependencia_facultad_id',
    'facultad_id',
    'id_facultad',
  ]);
  if (!facultyIdColumn) {
    return {
      assignmentIds: [],
      assignmentLabels: [],
      ualIds: [],
      errorPayload: {
        message: '¡Algo ha salido mal!',
        message2: 'No fue posible validar la facultad seleccionada.',
      },
    };
  }

  const parentIdColumn = await resolveExistingColumn('dependencia_facultad', ['padre_id']);
  if (!parentIdColumn) {
    return {
      assignmentIds: [],
      assignmentLabels: [],
      ualIds: [],
      errorPayload: {
        message: '¡Algo ha salido mal!',
        message2: 'No fue posible validar las dependencias de la facultad.',
      },
    };
  }

  const facultyResult = await pool.query(
    `SELECT ${facultyIdColumn} AS facultad_id, nombre
     FROM dependencia_facultad
     WHERE ${facultyIdColumn} = $1 AND ${parentIdColumn} IS NULL`,
    [facultyId]
  );

  if (!facultyResult.rows.length) {
    return {
      assignmentIds: [],
      assignmentLabels: [],
      ualIds: [],
      errorPayload: {
        message: 'La facultad seleccionada no existe.',
        message2: 'Selecciona una facultad válida.',
      },
    };
  }

  if (assignmentScope === 'facultad') {
    return {
      assignmentIds: [facultyId],
      assignmentLabels: [facultyResult.rows[0].nombre],
      ualIds: [],
      errorPayload: null,
    };
  }

  if (assignmentScope === 'uales') {
    const selectedUals = await pool.query(
      `SELECT ual_id, nombre
       FROM ual
       WHERE facultad_id = $1
         AND activo = TRUE
         AND ual_id = ANY($2::int[])
       ORDER BY nombre ASC`,
      [facultyId, ualIds]
    );

    if (selectedUals.rows.length !== ualIds.length) {
      return {
        assignmentIds: [],
        assignmentLabels: [],
        ualIds: [],
        errorPayload: {
          message: 'Una o más UALs no pertenecen a la facultad seleccionada.',
          message2: 'Verifica que las UALs estén activas y correspondan a la facultad.',
        },
      };
    }

    return {
      assignmentIds: [],
      assignmentLabels: selectedUals.rows.map((ual) => `UAL: ${ual.nombre}`),
      ualIds: selectedUals.rows.map((ual) => Number(ual.ual_id)),
      errorPayload: null,
    };
  }

  const dependencies = await pool.query(
    `SELECT ${facultyIdColumn} AS dependencia_id, nombre
     FROM dependencia_facultad
     WHERE ${parentIdColumn} = $1
       AND ${facultyIdColumn} = ANY($2::int[])
     ORDER BY nombre ASC`,
    [facultyId, dependencyIds]
  );

  if (dependencies.rows.length !== dependencyIds.length) {
    return {
      assignmentIds: [],
      assignmentLabels: [],
      ualIds: [],
      errorPayload: {
        message: 'Una o más dependencias no pertenecen a la facultad seleccionada.',
        message2: 'Verifica la selección de dependencias.',
      },
    };
  }

  return {
    assignmentIds: dependencies.rows.map((dependency) => dependency.dependencia_id),
    assignmentLabels: dependencies.rows.map(
      (dependency) => `${dependency.nombre} (${facultyResult.rows[0].nombre})`
    ),
    ualIds: [],
    errorPayload: null,
  };
}

async function fetchCoordinatorAssignmentOptions() {
  const facultyIdColumn = await resolveExistingColumn('dependencia_facultad', [
    'dependencia_facultad_id',
    'facultad_id',
    'id_facultad',
  ]);
  const parentIdColumn = await resolveExistingColumn('dependencia_facultad', ['padre_id']);
  if (!facultyIdColumn || !parentIdColumn) {
    throw new Error('No fue posible identificar facultades y dependencias.');
  }

  const [facultyResult, dependencyResult] = await Promise.all([
    pool.query(
      `SELECT ${facultyIdColumn} AS facultad_id, nombre
       FROM dependencia_facultad
       WHERE ${parentIdColumn} IS NULL
       ORDER BY nombre ASC`
    ),
    pool.query(
      `SELECT ${facultyIdColumn} AS dependencia_id,
              ${parentIdColumn} AS facultad_id,
              nombre
       FROM dependencia_facultad
       WHERE ${parentIdColumn} IS NOT NULL
       ORDER BY nombre ASC`
    ),
  ]);
  const ualResult = await pool.query(
    `SELECT ual_id, facultad_id AS facultad_id, nombre, codigo_abreviacion
     FROM ual
     WHERE activo = TRUE
     ORDER BY nombre ASC`
  );

  return {
    facultades: facultyResult.rows,
    dependencias: dependencyResult.rows,
    uals: ualResult.rows,
  };
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

async function lookupCoordinatorByDocumento(documento) {
  const docente = await lookupTeacherByDocumento(documento);
  if (docente) return docente;

  return lookupStudentByDocumento(documento);
}

async function lookupTeacherByDocumento(documento) {
  try {
    const data = await requestOati(getAcademicServicePath(`consultar_estado_docente/${documento}`));

    const docente = data?.docentesCollection?.docente?.[0];
    if (!docente) return null;

    return {
      documento,
      nombre: docente.nombre || '',
      correo: resolveOatiEmail(docente),
    };
  } catch {
    return null;
  }
}

async function lookupStudentByDocumento(documento) {
  try {
    const data = await requestOati(
      getAcademicServicePath(`datos_basicos_activos_cedula/${documento}`)
    );

    const collection = data?.datosEstudianteCollection?.datosBasicosEstudiante || [];
    if (!collection.length) return null;

    const item = collection[collection.length - 1];

    return {
      documento,
      nombre: item.nombre || '',
      correo: resolveOatiEmail(item),
    };
  } catch {
    return null;
  }
}

async function ensureUserIdentityForRole({ correo, documento, nombre, roleName }) {
  const existing = await pool.query(
    'SELECT id FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2 LIMIT 1',
    [correo, documento]
  );

  let userId;
  if (existing.rows.length) {
    userId = existing.rows[0].id;
    await pool.query(
      `UPDATE usuario
       SET correo = $1,
           documento = $2,
           nombre = $3,
           fecha_modificacion = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [correo, documento, nombre, userId]
    );
  } else {
    const inserted = await pool.query(
      'INSERT INTO usuario (correo, documento, nombre) VALUES ($1, $2, $3) RETURNING id',
      [correo, documento, nombre]
    );
    userId = inserted.rows[0].id;
  }

  await pool.query(
    `INSERT INTO usuario_rol (usuario_id, rol_id)
     SELECT $1, id FROM rol WHERE nombre = $2
     ON CONFLICT DO NOTHING`,
    [userId, roleName]
  );

  return userId;
}

async function findCoordinatorRegistrationConflict({ documento, correo }) {
  const normalizedDocument = normalizeDocument(documento);
  const normalizedEmail = normalizeEmail(correo);

  if (normalizedDocument) {
    const documentResult = await pool.query(
      'SELECT documento FROM coordinador WHERE documento = $1 LIMIT 1',
      [normalizedDocument]
    );

    if (documentResult.rows.length > 0) {
      return {
        message: 'El documento ingresado ya corresponde a un coordinador registrado.',
        message2: 'Verifica el número de documento',
      };
    }
  }

  if (normalizedEmail) {
    const emailResult = await pool.query(
      `
        SELECT source, documento
        FROM (
          SELECT 'usuario' AS source, LOWER(TRIM(correo)) AS correo, documento::text AS documento
          FROM usuario
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

          UNION ALL

          SELECT 'laboratorista' AS source, LOWER(TRIM(correo)) AS correo, documento::text AS documento
          FROM laboratorista
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

          UNION ALL

          SELECT 'coordinador' AS source, LOWER(TRIM(correo)) AS correo, documento::text AS documento
          FROM coordinador
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

        ) existing_emails
        WHERE correo = $1
      `,
      [normalizedEmail]
    );

    const hasForeignDocument = emailResult.rows.some((row) => {
      const rowDocument = normalizeDocument(row.documento);
      return rowDocument && rowDocument !== normalizedDocument;
    });

    if (hasForeignDocument) {
      return {
        message: 'El correo institucional ingresado ya está asociado a otra cuenta.',
        message2: 'Verifica el correo o usa uno diferente',
      };
    }
  }

  return null;
}

const requireAdminCoordinatorRegistration = requireRoles('admin', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

// Cargar información para el formulario
router.get('/load_info', requireAdminCoordinatorRegistration, async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const assignmentOptions = await fetchCoordinatorAssignmentOptions();
    const documentoQuery = (req.query.documento || '').toString().trim();
    let lookupData = null;
    let lookupMessage = null;
    let lookupStatus = null;

    if (documentoQuery) {
      if (!/^\d+$/.test(documentoQuery)) {
        lookupMessage = 'Ingresa un numero de documento valido.';
        lookupStatus = 'danger';
      } else {
        lookupData = await lookupCoordinatorByDocumento(documentoQuery);

        if (lookupData) {
          lookupMessage = 'Datos precargados desde OATI.';
          lookupStatus = 'success';
        } else {
          lookupMessage = 'No se encontró información en OATI. Completa el formulario manualmente.';
          lookupStatus = 'warning';
          lookupData = { documento: documentoQuery };
        }
      }
    }

    return res.render('home/registro_coordinador', {
      error: null,
      confirmacion: null,
      ...assignmentOptions,
      selectedRole: resolveCoordinatorRegistrationRole(req.query.role_name),
      lookupData,
      lookupMessage,
      lookupStatus,
      lookupDocumento: documentoQuery,
    });
  } catch (error) {
    console.error(error);
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

// Registro del coordinador
router.post(
  '/',
  requireAdminCoordinatorRegistration,
  limiter,
  securityLogger,
  [
    body('correo')
      .notEmpty()
      .withMessage('El correo institucional es obligatorio')
      .bail()
      .isEmail()
      .withMessage('Ingresa un correo institucional valido')
      .bail()
      .matches(/^[a-zA-Z0-9._%+-]+@udistrital\.edu\.co$/)
      .withMessage('Solo se permiten correos institucionales (@udistrital.edu.co)')
      .trim()
      .escape(),
    body('documento')
      .notEmpty()
      .withMessage('El documento es obligatorio')
      .bail()
      .matches(/^\d+$/)
      .withMessage('El documento debe contener solo numeros')
      .trim()
      .escape(),
    body('nombre').notEmpty().withMessage('El nombre es obligatorio').trim().escape(),
    body('role_name')
      .optional({ checkFalsy: true })
      .isIn(ALLOWED_COORDINATOR_REGISTRATION_ROLES)
      .withMessage('El rol de coordinador seleccionado no es valido'),
    body('facultad_id').custom((val, { req }) => {
      const selectedRole = resolveCoordinatorRegistrationRole(req.body.role_name);

      if (!roleHasFacultyAssignments(selectedRole)) {
        return true;
      }

      if (!/^\d+$/.test(String(val || '')) || Number(val) <= 0) {
        throw new Error('Debe seleccionar una facultad válida');
      }

      return true;
    }),
    body('alcance').custom((val, { req }) => {
      if (!roleHasFacultyAssignments(resolveCoordinatorRegistrationRole(req.body.role_name))) {
        return true;
      }

      if (!['facultad', 'dependencias'].includes(val)) {
        throw new Error(
          'Selecciona si el coordinador tendrá alcance en toda la facultad o en dependencias específicas'
        );
      }

      return true;
    }),
    body('dependencia_ids')
      .custom((val, { req }) => {
        const selectedRole = resolveCoordinatorRegistrationRole(req.body.role_name);
        if (!roleHasFacultyAssignments(selectedRole) || req.body.alcance !== 'dependencias') {
          return true;
        }

        const ids = Array.isArray(val) ? val : [val];
        if (!ids.length || ids.some((id) => !/^\d+$/.test(String(id || '')) || Number(id) <= 0)) {
          throw new Error('Selecciona al menos una dependencia válida');
        }

        return true;
      })
      .bail(),
    body('numero_resolucion_coordinador')
      .notEmpty()
      .withMessage('El numero y ano de la resolucion es obligatorio')
      .trim()
      .escape(),
    body('soporte_resolucion')
      .notEmpty()
      .withMessage('El soporte de la resolucion es obligatorio')
      .bail()
      .isURL()
      .withMessage('El soporte de la resolucion debe ser una URL valida')
      .trim(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors
        .array()
        .map((error) => error.msg)
        .join('. ');
      return res.render('home/message_error', {
        message: 'Error de validación: ' + errorMessages,
        message2: 'Inténtalo nuevamente',
        limit: null,
      });
    }

    const { documento, nombre, correo, numero_resolucion_coordinador, soporte_resolucion } =
      req.body;
    const roleName = resolveCoordinatorRegistrationRole(req.body.role_name);
    const needsFacultyAssignment = roleHasFacultyAssignments(roleName);
    const normalizedEmail = typeof correo === 'string' ? correo.trim().toLowerCase() : '';

    const facultyId = Number(req.body.facultad_id);
    const assignmentScope = (req.body.alcance || '').toString();
    const dependencyIds = parseIdList(req.body.dependencia_ids);
    const ualIds = parseIdList(req.body.ual_ids);

    if (
      !hasRequiredCoordinatorFields({
        needsFacultyAssignment,
        facultyId,
        assignmentScope,
        dependencyIds,
        ualIds,
        numeroResolucion: numero_resolucion_coordinador,
        soporteResolucion: soporte_resolucion,
      })
    ) {
      return res.render('home/message_error', {
        message: 'Debes seleccionar una facultad y definir su alcance.',
        message2: 'Inténtalo nuevamente',
        limit: null,
      });
    }

    try {
      const conflict = await findCoordinatorRegistrationConflict({
        documento,
        correo: normalizedEmail,
      });

      if (conflict) {
        return res.render('home/message_error', {
          message: conflict.message,
          message2: conflict.message2,
          limit: null,
        });
      }

      const selectedAssignments = await resolveSelectedCoordinatorAssignments({
        needsFacultyAssignment,
        facultyId,
        assignmentScope,
        dependencyIds,
        ualIds,
      });
      if (selectedAssignments.errorPayload) {
        return res.render('home/message_error', {
          message: selectedAssignments.errorPayload.message,
          message2: selectedAssignments.errorPayload.message2,
          limit: null,
        });
      }
      if (selectedAssignments.ualIds.length) {
        await ensureOperationalRoleAssignmentsSchema(pool);
      }

      const usuarioId = await ensureUserIdentityForRole({
        correo: normalizedEmail,
        documento,
        nombre,
        roleName,
      });

      await pool.query(
        `INSERT INTO coordinador
             (documento, nombre, correo, numero_resolucion_coordinador, soporte_resolucion, nombre_u, usuario_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          documento,
          nombre,
          normalizedEmail,
          numero_resolucion_coordinador,
          soporte_resolucion,
          documento,
          usuarioId,
        ]
      );

      // Insertar asociaciones de facultad solo para coordinador de facultad.
      if (needsFacultyAssignment) {
        const coordinatorFacultyIdColumn = await resolveExistingColumn('coordinador_facultad', [
          'facultad_id',
          'id_facultad',
        ]);
        if (!coordinatorFacultyIdColumn) {
          return res.render('home/message_error', {
            message: '¡Algo ha salido mal!',
            message2: 'No fue posible asociar las facultades al coordinador.',
            limit: null,
          });
        }

        if (selectedAssignments.assignmentIds.length) {
          await pool.query(
            `INSERT INTO coordinador_facultad (coordinador_documento_id, ${coordinatorFacultyIdColumn})
             SELECT $1, selected.facultad_id
             FROM UNNEST($2::int[]) AS selected(facultad_id)
             ON CONFLICT DO NOTHING`,
            [documento, selectedAssignments.assignmentIds]
          );
        }
        if (selectedAssignments.ualIds.length) {
          await replaceOperationalRoleAssignments({
            userId: usuarioId,
            roleName: ROLE_COORDINADOR,
            ualIds: selectedAssignments.ualIds,
            createdByUserId: req.session.user.id,
          });
        }
      }

      await pool.query(
        'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
        [
          req.session.user.tipo,
          normalizeLogDocument(req.session.user.documento),
          `Registrar nuevo ${roleDisplayName(roleName)}`,
          documento,
        ]
      );

      // Enviar correo de bienvenida al coordinador
      const datosCoordinador = {
        documento,
        nombre,
        correo: normalizedEmail,
        role_name: roleName,
        role_label: roleDisplayName(roleName),
        faculty_ids: selectedAssignments.assignmentIds,
        numero_resolucion_coordinador,
        soporte_resolucion,
        facultades_nombres:
          selectedAssignments.assignmentLabels.length > 0
            ? selectedAssignments.assignmentLabels.join(', ')
            : 'Sin facultades asignadas (acceso general de lectura)',
        creado_por: req.session.user.tipo,
        documento_creador: req.session.user.documento,
      };

      await enviarCorreoBienvenidaCoordinador(datosCoordinador);

      return res.render('home/message_success', {
        message: 'Cuenta creada',
        message2: `Se ha completado con éxito el proceso de creación de la cuenta del ${roleDisplayName(
          roleName
        )}`,
      });
    } catch (err) {
      console.error('Error en registro de coordinador:', err);
      return res.render('home/message_error', {
        message: '¡Algo ha salido mal!',
        message2: 'Inténtalo nuevamente',
        limit: null,
      });
    }
  }
);

// NUEVA FUNCIÓN: Enviar correo de bienvenida al coordinador
async function enviarCorreoBienvenidaCoordinador(datosCoordinador) {
  const roleLabel = datosCoordinador.role_label || 'Coordinador';
  const facultiesLabel =
    datosCoordinador.facultades_nombres || 'Sin facultades asignadas (acceso general de lectura)';
  const roleCapabilitiesMessage =
    datosCoordinador.role_name === ROLE_COORDINADOR_GENERAL
      ? 'usted tendrá acceso global de solo lectura sobre todos los módulos habilitados en MILab.'
      : 'usted tendrá acceso a funcionalidades administrativas específicas para la gestión de laboratoristas y procesos de paz y salvos dentro del alcance institucional asignado.';

  const fechaActual = new Date().toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  try {
    const mailOptions = {
      from: buildNoReplySender(),
      to: datosCoordinador.correo,
      subject: `Bienvenido como ${roleLabel} - MILab Laboratorios UD`,
      text: `Estimad@ ${datosCoordinador.nombre},

¡Bienvenido/a a MILab de Laboratorios de la Universidad Distrital!

    Su cuenta como ${roleLabel} ha sido creada exitosamente con los siguientes datos:

- Nombre: ${datosCoordinador.nombre}
- Documento: ${datosCoordinador.documento}
- Correo: ${datosCoordinador.correo}
    - Facultades: ${facultiesLabel}
- Número de Resolución: ${datosCoordinador.numero_resolucion_coordinador}
- Fecha de registro: ${fechaActual}

Sus credenciales de acceso son:
IMPORTANTE: Su acceso al sistema se realizará mediante correo institucional (Entra).

Como ${roleLabel}, ${roleCapabilitiesMessage}

Puede acceder al sistema en: ${appBaseUrl}

Si tiene alguna duda o problema, no dude en contactar al administrador del sistema.

Atentamente,
MILab - Coordinación General de Laboratorios

${NO_REPLY_NOTICE}`,

      html: `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta name="color-scheme" content="light only">
              <meta name="supported-color-schemes" content="light only">
                <title>Bienvenido como ${escapeHtml(roleLabel)}</title>
                <!--[if mso]>
                <style>
                    .fallback-font { font-family: Arial, sans-serif; }
                </style>
                <![endif]-->
            </head>
            <body style="margin: 0; padding: 0; background-color: #f8f9fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol';">
                <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #f8f9fa;">
                    <tr>
                        <td align="center" style="padding: 20px 0;">
                            <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width: 600px; width: 100%; margin: 0 auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.06);">
                              ${buildEmailHeaderHtml()}

                                <!-- Encabezado -->
                                <tr>
                                    <td align="center" style="padding: 30px 30px 20px 30px; background-color: #6f42c1; border-radius: 12px 12px 0 0;">
                                        <h1 class="fallback-font" style="font-size: 26px; font-weight: 700; color: #ffffff; margin: 0;">¡Bienvenido/a ${escapeHtml(roleLabel)}!</h1>
                                        <p class="fallback-font" style="font-size: 16px; color: #e2d9f3; margin: 10px 0 0 0;">MILab - Laboratorios UD</p>
                                    </td>
                                </tr>

                                <!-- Saludo -->
                                <tr>
                                    <td style="padding: 30px 30px 20px 30px;">
                                        <p class="fallback-font" style="font-size: 18px; line-height: 1.6; color: #202124; margin: 0;">
                                            Estimad@ <strong>${escapeHtml(datosCoordinador.nombre)}</strong>,
                                        </p>
                                        <p class="fallback-font" style="font-size: 16px; line-height: 1.6; color: #5f6368; margin-top: 16px;">
                                            ¡Bienvenido/a a MILab de Laboratorios de la Universidad Distrital! Su cuenta como <strong>${escapeHtml(roleLabel)}</strong> ha sido creada exitosamente.
                                        </p>
                                    </td>
                                </tr>

                                <!-- Datos de la cuenta -->
                                <tr>
                                    <td style="padding: 0 30px 20px 30px;">
                                        <h3 class="fallback-font" style="color: #202124; margin: 0 0 15px 0;">Datos de su cuenta:</h3>
                                        <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; border-left: 4px solid #6f42c1;">
                                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368; width: 40%;"><strong>Nombre:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosCoordinador.nombre)}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Documento:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosCoordinador.documento)}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Correo:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosCoordinador.correo)}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Facultades:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(facultiesLabel)}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Resolución:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosCoordinador.numero_resolucion_coordinador)}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Rol:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #6f42c1; font-weight: bold;">${escapeHtml(roleLabel)}</td>
                                                </tr>
                                            </table>
                                        </div>
                                    </td>
                                </tr>

                                <!-- Credenciales de acceso -->
                                <tr>
                                    <td style="padding: 0 30px 20px 30px;">
                                        <h3 class="fallback-font" style="color: #202124; margin: 0 0 15px 0;">Sus credenciales de acceso:</h3>
                                        <div style="background-color: #e3f2fd; border-radius: 8px; padding: 20px; border-left: 4px solid #1967d2;">
                                            <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Acceso:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 16px; color: #1967d2; font-weight: bold;">Correo institucional (Entra)</td>
                                                </tr>
                                            </table>
                                        </div>
                                    </td>
                                </tr>

                                <!-- Privilegios de coordinador -->
                                <tr>
                                    <td style="padding: 0 30px 20px 30px;">
                                        <div style="background-color: #f3e5f5; border-radius: 8px; padding: 15px; border-left: 4px solid #6f42c1;">
                                            <p class="fallback-font" style="font-size: 14px; color: #4a148c; margin: 0;">
                                                <strong>🎯 Como ${escapeHtml(roleLabel)},</strong> ${escapeHtml(roleCapabilitiesMessage)}
                                            </p>
                                        </div>
                                    </td>
                                </tr>

                                <!-- Mensaje de seguridad -->
                                <tr>
                                    <td style="padding: 0 30px 20px 30px;">
                                        <div style="background-color: #fff3cd; border-radius: 8px; padding: 15px; border-left: 4px solid #ffc107;">
                                            <p class="fallback-font" style="font-size: 14px; color: #856404; margin: 0;">
                                                <strong>⚠️ IMPORTANTE:</strong> El acceso al sistema se realiza con el correo institucional (Entra).
                                            </p>
                                        </div>
                                    </td>
                                </tr>

                                <!-- Enlace de acceso -->
                                <tr>
                                    <td align="center" style="padding: 0 30px 30px 30px;">
                                        <a href="${appBaseUrl}" style="display: inline-block; background-color: #6f42c1; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold;">
                                            Acceder al Sistema
                                        </a>
                                        <p class="fallback-font" style="font-size: 12px; color: #5f6368; margin-top: 10px;">
                                            O copie este enlace: ${appBaseUrl}
                                        </p>
                                    </td>
                                </tr>

                                ${buildNoReplyNoticeHtml()}
                                ${buildEmailFooterHtml(`
                                  <p class="fallback-font" style="font-size: 14px; color: rgba(255,255,255,0.92); margin: 0; text-align: center; line-height: 1.6;">
                                    Si tiene alguna duda o problema, no dude en contactar al administrador del sistema.
                                  </p>
                                  <p class="fallback-font" style="font-size: 14px; color: rgba(255,255,255,0.92); margin: 14px 0 0 0; text-align: center; line-height: 1.6;">
                                    Atentamente,<br><strong>MILab - Coordinación General de Laboratorios</strong>
                                  </p>
                                `)}
                            </table>
                        </td>
                    </tr>

                    <!-- Pie de página con dirección -->
                    <tr>
                        <td align="center" style="padding: 20px 0;">
                            <p class="fallback-font" style="font-size: 12px; color: #9aa0a6; text-align: center;">
                                © 2025 MILab / Coordinación General de Laboratorios - CILUD. Todos los derechos reservados.<br>
                                Universidad Distrital Francisco José de Caldas, Bogotá D.C.
                            </p>
                        </td>
                    </tr>
                </table>
            </body>
            </html>
            `,
      attachments: buildBrandedEmailAttachments(),
    };

    await transporter.sendMail(mailOptions);
    console.log(`Correo de bienvenida enviado a coordinador: ${datosCoordinador.correo}`);
  } catch (error) {
    console.error(
      `Error al enviar correo de bienvenida a coordinador ${datosCoordinador.correo}:`,
      error
    );
    // No lanzamos el error para que no interrumpa el proceso de registro
  }
}

// Generar token
router.get('/token', requireAdminCoordinatorRegistration, async function (req, res) {
  const secretKey = getRegistrationTokenSecret();
  if (!secretKey) {
    return res.render('home/message_error', {
      message: 'Configuración incompleta',
      message2: 'Falta la variable REGISTRATION_TOKEN_SECRET.',
      limit: null,
    });
  }
  const token = jwt.sign({ userId: req.session.user?.id, role: 'coordinador' }, secretKey, {
    expiresIn: 604800,
  });

  res.render('home/message_success', {
    message: '¡Token generado con éxito!',
    message2: buildAppUrl(`/api/registro_coordinador/verify_token?token=${token}`),
  });
});

// Verificar token
router.get('/verify_token', async function (req, res) {
  const secretKey = getRegistrationTokenSecret();
  const token = req.query.token;

  if (!secretKey) {
    return res.render('home/message_error', {
      message: 'Configuración incompleta',
      message2: 'Falta la variable REGISTRATION_TOKEN_SECRET.',
      limit: null,
    });
  }

  if (!token) {
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }

  try {
    jwt.verify(token, secretKey);
    req.session.registrationTokenVerified = true;
    return res.redirect(`${req.baseUrl}/new`);
  } catch {
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: 'noSession',
    });
  }
});

router.get('/new', async function (req, res) {
  const hasTokenGrant = req.session.registrationTokenVerified === true;
  const hasRole = ['coordinador', 'admin'].includes(req.session.user?.tipo);

  if (!hasTokenGrant && !hasRole) {
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: 'noSession',
    });
  }

  const assignmentOptions = await fetchCoordinatorAssignmentOptions();
  return res.render('home/registro_coordinador', {
    error: null,
    confirmacion: null,
    ...assignmentOptions,
    selectedRole: ROLE_COORDINADOR,
    lookupData: null,
    lookupMessage: null,
    lookupStatus: null,
    lookupDocumento: '',
  });
});

module.exports = router;
