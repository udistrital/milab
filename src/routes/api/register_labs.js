// --- ARCHIVO JS ACTUALIZADO (Node.js / Express) ---
const express = require('express');
const { requestOati, getAcademicServicePath } = require('../../libs/oati-client');
const pool = require('../../libs/db');
const transporter = require('../../libs/mail');
const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
  escapeHtml,
} = require('../../libs/email-layout');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { appBaseUrl, buildAppUrl } = require('../../libs/app-url');
const jwt = require('jsonwebtoken');
const { getRegistrationTokenSecret } = require('../../libs/registration-token');
require('dotenv').config();
const { body, validationResult } = require('express-validator');
const limiter = require('../middlewares/limiter');
const { securityLogger } = require('../middlewares/security-logger');
const { requireRoles, requireUser } = require('../middlewares/auth');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireCoordinatorTokenAccess = requireRoles('coordinador', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireAdminOrCoordinatorLoadInfo = requireRoles(['admin', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

const requireLabRegistrationSession = requireUser({
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
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

async function lookupLaboratoristaByDocumento(documento) {
  const docente = await lookupTeacherByDocumento(documento);
  if (docente) return docente;

  return lookupStudentByDocumento(documento);
}

function normalizeSelectedUalIds(rawValue) {
  const values = Array.isArray(rawValue) ? rawValue : [rawValue];

  return [
    ...new Set(
      values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    ),
  ];
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

async function buildRegisterLabsViewContext(sessionUser) {
  if (sessionUser?.tipo === 'coordinador') {
    const scope = await resolveCoordinatorScope(pool, sessionUser.documento);

    if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
      return {
        facultades: [],
        uals: [],
        tipo: sessionUser.tipo,
        documento: sessionUser.documento,
      };
    }

    const facultades = (
      await pool.query(
        'SELECT * FROM facultad WHERE id_facultad = ANY($1::int[]) ORDER BY nombre ASC',
        [scope.facultyIds]
      )
    ).rows;
    const uals = (
      await pool.query('SELECT * FROM ual WHERE id_facultad = ANY($1::int[]) ORDER BY nombre ASC', [
        scope.facultyIds,
      ])
    ).rows;

    return {
      facultades,
      uals,
      tipo: sessionUser.tipo,
      documento: sessionUser.documento,
    };
  }

  return {
    facultades: (await pool.query('SELECT * FROM facultad ORDER BY nombre ASC')).rows,
    uals: (await pool.query('SELECT * FROM ual ORDER BY nombre ASC')).rows,
    tipo: sessionUser?.tipo || 'admin',
    documento: sessionUser?.documento || null,
  };
}

async function renderRegisterLabsWithError(req, res, error) {
  const viewContext = await buildRegisterLabsViewContext(req.session?.user || null);

  return res.render('home/register_labs', {
    error,
    confirmacion: null,
    lookupData: null,
    lookupMessage: null,
    lookupStatus: null,
    lookupDocumento: '',
    ...viewContext,
  });
}

router.get('/token', requireCoordinatorTokenAccess, async function (req, res) {
  const secretKey = getRegistrationTokenSecret();
  if (!secretKey) {
    return res.render('home/message_error', {
      message: 'Configuración incompleta',
      message2: 'Falta la variable REGISTRATION_TOKEN_SECRET.',
      limit: null,
    });
  }
  const token = jwt.sign({ userId: req.session.user?.id, role: 'laboratorista' }, secretKey, {
    expiresIn: 604800,
  });
  res.render('home/message_success', {
    message: '¡Token generado con éxito!',
    message2: buildAppUrl(`/api/register_labs/verify_token?token=${token}`),
  });
});

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

  const viewContext = await buildRegisterLabsViewContext(req.session.user || null);
  return res.render('home/register_labs', {
    error: null,
    confirmacion: null,
    lookupData: null,
    lookupMessage: null,
    lookupStatus: null,
    lookupDocumento: '',
    ...viewContext,
  });
});

router.get('/load_info', requireAdminOrCoordinatorLoadInfo, async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const viewContext = await buildRegisterLabsViewContext(req.session.user);
    const documentoQuery = (req.query.documento || '').toString().trim();
    let lookupData = null;
    let lookupMessage = null;
    let lookupStatus = null;

    if (req.session.user.tipo === 'coordinador' && viewContext.facultades.length === 0) {
      return res.render('home/message_error', {
        message: '¡Error!',
        message2: 'No se encontró información del coordinador',
        limit: null,
      });
    }

    if (documentoQuery) {
      if (!/^\d+$/.test(documentoQuery)) {
        lookupMessage = 'Ingresa un numero de documento valido.';
        lookupStatus = 'danger';
      } else {
        lookupData = await lookupLaboratoristaByDocumento(documentoQuery);

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

    return res.render('home/register_labs', {
      error: null,
      confirmacion: null,
      lookupData,
      lookupMessage,
      lookupStatus,
      lookupDocumento: documentoQuery,
      ...viewContext,
    });
  } catch {
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: null,
    });
  }
});

router.post(
  '/',
  limiter,
  securityLogger,
  requireLabRegistrationSession,
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
      .withMessage('Solo se permiten correos institucionales (@udistrital.edu.co)')
      .bail(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors
        .array()
        .map((error) => error.msg)
        .join('. ');
      return renderRegisterLabsWithError(req, res, errorMessages);
    }

    const usuario = req.body || {};

    try {
      const selectedFacultyId = Number(usuario.facultad);
      const selectedUalIds = normalizeSelectedUalIds(usuario.id_uales);

      if (!selectedFacultyId || selectedUalIds.length === 0) {
        return renderRegisterLabsWithError(
          req,
          res,
          'Debes seleccionar una facultad y al menos un laboratorio.'
        );
      }

      if (req.session.user.tipo === 'coordinador') {
        const scope = await resolveCoordinatorScope(pool, req.session.user.documento);

        if (!scope.coordinatorDocument || !scope.facultyIds.includes(selectedFacultyId)) {
          return renderRegisterLabsWithError(
            req,
            res,
            'No tienes permisos para registrar laboratoristas fuera de tus facultades asociadas.'
          );
        }
      }

      const ualRes = await pool.query(
        'SELECT id_ual FROM ual WHERE id_facultad = $1 AND id_ual = ANY($2::int[])',
        [selectedFacultyId, selectedUalIds]
      );

      if (ualRes.rows.length !== selectedUalIds.length) {
        return renderRegisterLabsWithError(
          req,
          res,
          'Todos los laboratorios seleccionados deben pertenecer a la facultad indicada.'
        );
      }

      const result = await pool.query(
        `SELECT *
         FROM laboratorista
         WHERE documento = $1 OR correo = $2`,
        [usuario.documento, usuario.correo]
      );

      const usuariosResult = await pool.query(
        'SELECT id, documento FROM usuario WHERE LOWER(correo) = LOWER($1) OR documento = $2 LIMIT 1',
        [usuario.correo, usuario.documento]
      );

      const existingUser = usuariosResult.rows[0];
      const hasUserConflict =
        existingUser &&
        String(existingUser.documento || '').trim() !== String(usuario.documento || '').trim();

      const coordinatorResult = await pool.query(
        `SELECT documento
         FROM coordinador
         WHERE documento = $1
            OR LOWER(COALESCE(correo, '')) = LOWER($2)
            OR nombre_u = $1
            OR ($3::bigint IS NOT NULL AND usuario_id = $3::bigint)
         LIMIT 1`,
        [usuario.documento, usuario.correo, existingUser?.id || null]
      );

      const coordinatorRoleConflict = existingUser
        ? await pool.query(
            `SELECT 1
             FROM usuario_rol ur
             JOIN rol r ON r.id = ur.rol_id
             WHERE ur.usuario_id = $1
               AND ur.activo = TRUE
               AND r.nombre = 'coordinador'
             LIMIT 1`,
            [existingUser.id]
          )
        : { rows: [] };

      if (coordinatorResult.rows[0] || coordinatorRoleConflict.rows[0]) {
        return renderRegisterLabsWithError(
          req,
          res,
          'No puedes registrar como laboratorista a un usuario que ya esta asociado como coordinador.'
        );
      }

      if (result.rows[0] || hasUserConflict) {
        return res.render('home/message_error', {
          message: 'Datos inválidos. Verifica la información e inténtalo nuevamente.',
          message2: 'Revisa los datos ingresados',
          limit: null,
        });
      }

      const items = await create_account(usuario, req.session.user);
      if (!items) {
        return res.render('home/message_error', {
          message: '¡Algo ha salido mal!',
          message2: 'Inténtalo nuevamente',
          limit: null,
        });
      } else {
        return res.render('home/message_success', {
          message: 'Cuenta creada',
          message2: 'Exitosamente',
        });
      }
    } catch {
      return res.render('home/message_error', {
        message: '¡Algo ha salido mal!',
        message2: 'Inténtalo nuevamente',
        limit: null,
      });
    }
  }
);

async function create_account(data, userSession) {
  const documento = data.documento;
  const nombre = data.nombre;
  const n_usuario = documento;
  const correo = data.correo;
  const selectedUalIds = normalizeSelectedUalIds(data.id_uales);
  const id_ual = selectedUalIds[0];
  const id_facultad = data.facultad;
  const contrato = data.contrato;
  const tipo = 'laboratorista';
  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    const userId = await ensureUserIdentityForRole({
      correo,
      documento,
      nombre,
      roleName: tipo,
    });

    const result = await client.query(
      `INSERT INTO laboratorista
        (documento, nombre, n_usuario, correo, id_ual, id_facultad, contrato, usuario_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [documento, nombre, n_usuario, correo, id_ual, id_facultad, contrato, userId]
    );

    if (result.rowCount !== undefined && result.rowCount >= 0) {
      await client.query(
        `
        INSERT INTO laboratorista_ual (documento, id_ual)
        SELECT $1, UNNEST($2::int[])
        ON CONFLICT DO NOTHING
        `,
        [documento, selectedUalIds]
      );

      let documentoReal = userSession.documento;

      if (userSession.tipo === 'coordinador') {
        const result = await client.query('SELECT documento FROM coordinador WHERE nombre_u = $1', [
          userSession.documento,
        ]);
        if (result.rows.length > 0) {
          documentoReal = result.rows[0].documento;
        }
      }

      await client.query(
        'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
        [userSession.tipo, documentoReal, 'Registrar nuevo laboratorista', documento]
      );

      const facultadInfo = await client.query(
        'SELECT nombre FROM facultad WHERE id_facultad = $1',
        [id_facultad]
      );
      const ualInfo = await client.query(
        "SELECT STRING_AGG(nombre, ', ' ORDER BY nombre) AS nombres FROM ual WHERE id_ual = ANY($1::int[])",
        [selectedUalIds]
      );

      await client.query('COMMIT');
      client.release();
      client = null;

      const datosCompletos = {
        ...data,
        facultad_nombre: facultadInfo.rows[0]?.nombre || 'N/A',
        ual_nombre: ualInfo.rows[0]?.nombres || 'N/A',
        ual_nombres: ualInfo.rows[0]?.nombres || 'N/A',
        creado_por: userSession.tipo,
        documento_creador: userSession.documento,
      };

      await enviarCorreoBienvenidaLaboratorista(datosCompletos);

      return true;
    } else {
      throw new Error('Error al intentar agregar el usuario');
    }
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error al revertir el registro de laboratorista:', rollbackError);
      }
      client.release();
    }
    console.error('Error en la función create_account:', error);
    throw error;
  }
}

async function enviarCorreoBienvenidaLaboratorista(datosLaboratorista) {
  const fechaActual = new Date().toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: datosLaboratorista.correo,
      subject: `Bienvenido a MILab - Laboratorios UD`,
      text: `Estimad@ ${datosLaboratorista.nombre},

¡Bienvenido/a a MILab de Laboratorios de la Universidad Distrital!

Su cuenta ha sido creada exitosamente con los siguientes datos:

- Nombre: ${datosLaboratorista.nombre}
- Documento: ${datosLaboratorista.documento}
- Correo: ${datosLaboratorista.correo}
- Facultad: ${datosLaboratorista.facultad_nombre}
- Laboratorios asignados: ${datosLaboratorista.ual_nombres}
- Número de contrato: ${datosLaboratorista.contrato}

- Fecha de registro: ${fechaActual}

Sus credenciales de acceso son:
IMPORTANTE: Su acceso al sistema se realizará mediante correo institucional (Entra).

Puede acceder al sistema en: ${appBaseUrl}

Si tiene alguna duda o problema, no dude en contactar al administrador del sistema.

Atentamente,
MILab - Coordinación General de Laboratorios`,

      html: `
      <!DOCTYPE html>
      <html lang="es">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta name="color-scheme" content="light only">
          <meta name="supported-color-schemes" content="light only">
          <title>Bienvenido a MILab</title>
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
                              <td align="center" style="padding: 30px 30px 20px 30px; background-color: #28a745; border-radius: 12px 12px 0 0;">
                                  <h1 class="fallback-font" style="font-size: 28px; font-weight: 700; color: #ffffff; margin: 0;">¡Bienvenido/a!</h1>
                                  <p class="fallback-font" style="font-size: 16px; color: #d4edda; margin: 10px 0 0 0;">MILab - Laboratorios UD</p>
                              </td>
                          </tr>
                          
                          <!-- Saludo -->
                          <tr>
                              <td style="padding: 30px 30px 20px 30px;">
                                  <p class="fallback-font" style="font-size: 18px; line-height: 1.6; color: #202124; margin: 0;">
                                      Estimad@ <strong>${escapeHtml(datosLaboratorista.nombre)}</strong>,
                                  </p>
                                  <p class="fallback-font" style="font-size: 16px; line-height: 1.6; color: #5f6368; margin-top: 16px;">
                                      ¡Bienvenido/a a MILab de Laboratorios de la Universidad Distrital! Su cuenta ha sido creada exitosamente.
                                  </p>
                              </td>
                          </tr>
                          
                          <!-- Datos de la cuenta -->
                          <tr>
                              <td style="padding: 0 30px 20px 30px;">
                                  <h3 class="fallback-font" style="color: #202124; margin: 0 0 15px 0;">Datos de su cuenta:</h3>
                                  <div style="background-color: #f8f9fa; border-radius: 8px; padding: 20px; border-left: 4px solid #28a745;">
                                      <table width="100%" border="0" cellspacing="0" cellpadding="0">
                                          <tr>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368; width: 40%;"><strong>Nombre:</strong></td>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosLaboratorista.nombre)}</td>
                                          </tr>
                                          <tr>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Documento:</strong></td>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosLaboratorista.documento)}</td>
                                          </tr>
                                          <tr>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Correo:</strong></td>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosLaboratorista.correo)}</td>
                                          </tr>
                                          <tr>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Facultad:</strong></td>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosLaboratorista.facultad_nombre)}</td>
                                          </tr>
                                          <tr>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Laboratorios:</strong></td>
                                              <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${escapeHtml(datosLaboratorista.ual_nombres)}</td>
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
                                  <a href="${appBaseUrl}" style="display: inline-block; background-color: #28a745; color: #ffffff; text-decoration: none; padding: 12px 30px; border-radius: 6px; font-weight: bold;">
                                      Acceder al Sistema
                                  </a>
                                  <p class="fallback-font" style="font-size: 12px; color: #5f6368; margin-top: 10px;">
                                      O copie este enlace: ${appBaseUrl}
                                  </p>
                              </td>
                          </tr>
                          
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
    console.log(`Correo de bienvenida enviado a: ${datosLaboratorista.correo}`);
  } catch (error) {
    console.error(`Error al enviar correo de bienvenida a ${datosLaboratorista.correo}:`, error);
  }
}

module.exports = router;
