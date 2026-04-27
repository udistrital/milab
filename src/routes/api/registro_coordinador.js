const express = require('express');
const axios = require('axios');
const pool = require('../../libs/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const transporter = require('../../libs/mail');
const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
} = require('../../libs/email-layout');
const { normalizeLogDocument } = require('../../libs/account-email');
const { appBaseUrl, buildAppUrl } = require('../../libs/app-url');
const { getRegistrationTokenSecret } = require('../../libs/registration-token');
const { body, validationResult } = require('express-validator');
const limiter = require('../middlewares/limiter');
const { securityLogger } = require('../middlewares/security-logger');
const { requireRoles } = require('../middlewares/auth');
require('dotenv').config();

const router = express.Router();

function normalizeEmail(value) {
  return (value || '').toString().trim().toLowerCase();
}

function normalizeDocument(value) {
  return (value || '').toString().trim();
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

async function upsertAuthAccount({ documento, correo, tipo }) {
  const passwordTemporal = crypto.randomBytes(24).toString('hex');
  const hashedPassword = await bcrypt.hash(passwordTemporal, 12);

  await pool.query(
    `INSERT INTO auth (documento, password, tipo, password_cambiado, correo)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (documento) DO UPDATE
     SET correo = EXCLUDED.correo,
         tipo = EXCLUDED.tipo`,
    [documento, hashedPassword, tipo, true, correo]
  );
}

async function lookupCoordinatorByDocumento(documento) {
  const docente = await lookupTeacherByDocumento(documento);
  if (docente) return docente;

  return lookupStudentByDocumento(documento);
}

async function lookupTeacherByDocumento(documento) {
  try {
    const respuesta = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
        'servicios_academicos_produccion/consultar_estado_docente/' +
        documento
    );

    const docente = respuesta.data?.docentesCollection?.docente?.[0];
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
    const respuesta = await axios.get(
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
        'servicios_academicos_produccion/datos_basicos_activos_cedula/' +
        documento
    );

    const collection = respuesta.data?.datosEstudianteCollection?.datosBasicosEstudiante || [];
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
    'SELECT id FROM usuarios WHERE LOWER(correo) = LOWER($1) OR documento = $2 LIMIT 1',
    [correo, documento]
  );

  let userId;
  if (existing.rows.length) {
    userId = existing.rows[0].id;
    await pool.query(
      `UPDATE usuarios
       SET correo = $1,
           documento = $2,
           nombre = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [correo, documento, nombre, userId]
    );
  } else {
    const inserted = await pool.query(
      'INSERT INTO usuarios (correo, documento, nombre) VALUES ($1, $2, $3) RETURNING id',
      [correo, documento, nombre]
    );
    userId = inserted.rows[0].id;
  }

  await pool.query(
    `INSERT INTO usuario_roles (usuario_id, role_id)
     SELECT $1, id FROM roles WHERE name = $2
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
      'SELECT documento FROM coordinador_laboratorio WHERE documento = $1 LIMIT 1',
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
          SELECT 'usuarios' AS source, LOWER(TRIM(correo)) AS correo, documento::text AS documento
          FROM usuarios
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

          UNION ALL

          SELECT 'usuario' AS source, LOWER(TRIM(correo)) AS correo, documento::text AS documento
          FROM usuario
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

          UNION ALL

          SELECT 'laboratorista' AS source, LOWER(TRIM(correo)) AS correo, documento::text AS documento
          FROM laboratorista
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

          UNION ALL

          SELECT 'coordinador_laboratorio' AS source, LOWER(TRIM(correo)) AS correo, documento::text AS documento
          FROM coordinador_laboratorio
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

          UNION ALL

          SELECT 'estudiante' AS source, LOWER(TRIM(correo)) AS correo, cc::text AS documento
          FROM estudiante
          WHERE correo IS NOT NULL AND TRIM(correo) <> ''

          UNION ALL

          SELECT 'docente' AS source, LOWER(TRIM(correo)) AS correo, cc::text AS documento
          FROM docente
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
    const result = await pool.query('SELECT * FROM facultad');
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
      facultades: result.rows,
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
      .isEmail()
      .notEmpty()
      .matches(/^[a-zA-Z0-9._%+-]+@udistrital\.edu\.co$/)
      .withMessage('Solo se permiten correos institucionales (@udistrital.edu.co)')
      .escape(),
    body('documento').isString().notEmpty().escape(),
    body('nombre').isString().notEmpty().escape(),
    // Soporte de múltiples facultades: acepta array o string único
    body('id_facultades').custom((val) => {
      if (Array.isArray(val)) {
        return val.length > 0 && val.every((v) => /^\d+$/.test(String(v)));
      }
      if (typeof val === 'string') {
        return /^\d+$/.test(val);
      }
      throw new Error('Debe seleccionar al menos una facultad');
    }),
    body('numero_resolucion_coordinador').isString().notEmpty().escape(),
    body('soporte_resolucion').isString().notEmpty().escape(),
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
    const normalizedEmail = typeof correo === 'string' ? correo.trim().toLowerCase() : '';

    // Normalizar facultades seleccionadas (array de enteros)
    const id_facultades_input = req.body.id_facultades;
    const id_facultades = Array.isArray(id_facultades_input)
      ? id_facultades_input.map((x) => parseInt(x, 10))
      : [parseInt(id_facultades_input, 10)].filter(Number.isFinite);

    const id_facultad_principal = id_facultades[0];

    if (!id_facultades.length || !numero_resolucion_coordinador || !soporte_resolucion) {
      return res.render('home/message_error', {
        message: '¡Todos los campos son obligatorios!',
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

      // Validar que las facultades existan
      const facs = await pool.query(
        'SELECT id_facultad, nombre FROM facultad WHERE id_facultad = ANY($1::int[])',
        [id_facultades]
      );
      if (facs.rows.length !== id_facultades.length) {
        return res.render('home/message_error', {
          message: 'Una o más facultades seleccionadas no existen.',
          message2: 'Verifica la selección',
          limit: null,
        });
      }

      const usuarioId = await ensureUserIdentityForRole({
        correo: normalizedEmail,
        documento,
        nombre,
        roleName: 'coordinador',
      });

      const authDocument = documento;
      await upsertAuthAccount({
        documento: authDocument,
        correo: normalizedEmail,
        tipo: 'coordinador',
      });

      await pool.query(
        `INSERT INTO coordinador_laboratorio
             (documento, nombre, correo, id_facultad, numero_resolucion_coordinador, soporte_resolucion, nombre_u)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          documento,
          nombre,
          normalizedEmail,
          id_facultad_principal,
          numero_resolucion_coordinador,
          soporte_resolucion,
          authDocument,
        ]
      );

      await pool.query('UPDATE coordinador_laboratorio SET usuario_id = $1 WHERE documento = $2', [
        usuarioId,
        documento,
      ]);

      // Insertar todas las asociaciones en la tabla de unión
      for (const facId of id_facultades) {
        await pool.query(
          'INSERT INTO coordinador_facultad (documento, id_facultad) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [documento, facId]
        );
      }

      await pool.query(
        'INSERT INTO logs (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
        [
          req.session.user.tipo,
          normalizeLogDocument(req.session.user.documento),
          'Registrar nuevo coordinador',
          documento,
        ]
      );

      // Obtener información de las facultades para el correo
      const facultadInfo = facs.rows.map((r) => r.nombre);

      // Enviar correo de bienvenida al coordinador
      const datosCoordinador = {
        documento,
        nombre,
        correo: normalizedEmail,
        id_facultades,
        numero_resolucion_coordinador,
        soporte_resolucion,
        facultades_nombres: facultadInfo.join(', '),
        creado_por: req.session.user.tipo,
        documento_creador: req.session.user.documento,
      };

      await enviarCorreoBienvenidaCoordinador(datosCoordinador);

      return res.render('home/message_success', {
        message: 'Cuenta creada',
        message2: 'Se ha completado con éxito el proceso de creación de la cuenta del Coordinador',
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
      to: datosCoordinador.correo,
      subject: `Bienvenido como Coordinador - Sistema de Paz y Salvos Laboratorios UD`,
      text: `Estimad@ ${datosCoordinador.nombre},

¡Bienvenido/a al Sistema de Paz y Salvos de Laboratorios de la Universidad Distrital!

Su cuenta como Coordinador de Laboratorio ha sido creada exitosamente con los siguientes datos:

- Nombre: ${datosCoordinador.nombre}
- Documento: ${datosCoordinador.documento}
- Correo: ${datosCoordinador.correo}
- Facultades: ${datosCoordinador.facultades_nombres}
- Número de Resolución: ${datosCoordinador.numero_resolucion_coordinador}
- Fecha de registro: ${fechaActual}

Sus credenciales de acceso son:
IMPORTANTE: Su acceso al sistema se realizará mediante correo institucional (Entra).

Como Coordinador de Laboratorio, usted tendrá acceso a funcionalidades administrativas específicas para la gestión de laboratoristas y procesos de paz y salvos en su facultad.

Puede acceder al sistema en: ${appBaseUrl}

Si tiene alguna duda o problema, no dude en contactar al administrador del sistema.

Atentamente,
Sistema de Paz y Salvos - Coordinación General de Laboratorios`,

      html: `
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <meta name="color-scheme" content="light only">
              <meta name="supported-color-schemes" content="light only">
                <title>Bienvenido como Coordinador</title>
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
                                        <h1 class="fallback-font" style="font-size: 26px; font-weight: 700; color: #ffffff; margin: 0;">¡Bienvenido/a Coordinador!</h1>
                                        <p class="fallback-font" style="font-size: 16px; color: #e2d9f3; margin: 10px 0 0 0;">Sistema de Paz y Salvos - Laboratorios UD</p>
                                    </td>
                                </tr>

                                <!-- Saludo -->
                                <tr>
                                    <td style="padding: 30px 30px 20px 30px;">
                                        <p class="fallback-font" style="font-size: 18px; line-height: 1.6; color: #202124; margin: 0;">
                                            Estimad@ <strong>${datosCoordinador.nombre}</strong>,
                                        </p>
                                        <p class="fallback-font" style="font-size: 16px; line-height: 1.6; color: #5f6368; margin-top: 16px;">
                                            ¡Bienvenido/a al Sistema de Paz y Salvos de Laboratorios de la Universidad Distrital! Su cuenta como <strong>Coordinador de Laboratorio</strong> ha sido creada exitosamente.
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
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${datosCoordinador.nombre}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Documento:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${datosCoordinador.documento}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Correo:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${datosCoordinador.correo}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Facultades:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${datosCoordinador.facultades_nombres}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Resolución:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #202124;">${datosCoordinador.numero_resolucion_coordinador}</td>
                                                </tr>
                                                <tr>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #5f6368;"><strong>Rol:</strong></td>
                                                    <td class="fallback-font" style="padding: 5px 0; font-size: 14px; color: #6f42c1; font-weight: bold;">Coordinador de Laboratorio</td>
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
                                                <strong>🎯 Como Coordinador de Laboratorio,</strong> usted tendrá acceso a funcionalidades administrativas específicas para la gestión de laboratoristas y procesos de paz y salvos en su facultad.
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

                                ${buildEmailFooterHtml(`
                                  <p class="fallback-font" style="font-size: 14px; color: rgba(255,255,255,0.92); margin: 0; text-align: center; line-height: 1.6;">
                                    Si tiene alguna duda o problema, no dude en contactar al administrador del sistema.
                                  </p>
                                  <p class="fallback-font" style="font-size: 14px; color: rgba(255,255,255,0.92); margin: 14px 0 0 0; text-align: center; line-height: 1.6;">
                                    Atentamente,<br><strong>Sistema de Paz y Salvos - Coordinación General de Laboratorios</strong>
                                  </p>
                                `)}
                            </table>
                        </td>
                    </tr>

                    <!-- Pie de página con dirección -->
                    <tr>
                        <td align="center" style="padding: 20px 0;">
                            <p class="fallback-font" style="font-size: 12px; color: #9aa0a6; text-align: center;">
                                © 2025 Sistema Paz y Salvos / Coordinación General de Laboratorios - CILUD. Todos los derechos reservados.<br>
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
  const token = jwt.sign({ userId: '11', role: 'coordinador' }, secretKey, {
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
    const result = await pool.query('SELECT * FROM facultad');
    return res.render('home/registro_coordinador', {
      error: null,
      confirmacion: null,
      facultades: result.rows,
      lookupData: null,
      lookupMessage: null,
      lookupStatus: null,
      lookupDocumento: '',
    });
  } catch {
    return res.render('home/message_error', {
      message: '¡Algo ha salido mal!',
      message2: 'Inténtalo nuevamente',
      limit: 'noSession',
    });
  }
});

module.exports = router;
