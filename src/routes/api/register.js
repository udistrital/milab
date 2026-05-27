const express = require('express');
const pool = require('../../libs/db');
const transporter = require('../../libs/mail');
const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
} = require('../../libs/email-layout');
require('dotenv').config();
const { body, validationResult } = require('express-validator');
const limiter = require('../middlewares/limiter');
const { securityLogger } = require('../middlewares/security-logger');
const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

function buildRegistrationTemplateState(tipoUsuario, session) {
  if (tipoUsuario === 'estudiante' && session.studentData) {
    const data = session.studentData;

    return {
      templateName: 'home/register_data',
      templateData: {
        con_documento:
          data.con_documento_completo.substring(
            0,
            Math.min(3, data.con_documento_completo.length)
          ) + '*'.repeat(Math.max(0, data.con_documento_completo.length - 3)),
        con_codigo:
          data.con_codigo_completo.substring(0, Math.min(3, data.con_codigo_completo.length)) +
          '*'.repeat(Math.max(0, data.con_codigo_completo.length - 3)),
        con_nombre:
          data.con_nombre_completo.substring(0, Math.min(4, data.con_nombre_completo.length)) +
          '*'.repeat(Math.max(0, data.con_nombre_completo.length - 4)),
        con_estado:
          data.con_estado_completo.substring(0, Math.min(3, data.con_estado_completo.length)) +
          '*'.repeat(Math.max(0, data.con_estado_completo.length - 3)),
        con_carrera:
          data.con_carrera_completa.substring(0, Math.min(8, data.con_carrera_completa.length)) +
          '*'.repeat(Math.max(0, data.con_carrera_completa.length - 8)),
      },
    };
  }

  if (tipoUsuario === 'docente' && session.teacherData) {
    const data = session.teacherData;

    return {
      templateName: 'home/register_data1',
      templateData: {
        con_documento:
          data.con_documento_completo.substring(
            0,
            Math.min(3, data.con_documento_completo.length)
          ) + '*'.repeat(Math.max(0, data.con_documento_completo.length - 3)),
        con_nombre:
          data.con_nombre_completo.substring(0, Math.min(4, data.con_nombre_completo.length)) +
          '*'.repeat(Math.max(0, data.con_nombre_completo.length - 4)),
        con_estado:
          data.con_estado_completo.substring(0, Math.min(3, data.con_estado_completo.length)) +
          '*'.repeat(Math.max(0, data.con_estado_completo.length - 3)),
      },
    };
  }

  return {
    templateName: 'home/register_data',
    templateData: {
      con_documento: '',
      con_codigo: '',
      con_nombre: '',
      con_carrera: '',
      con_estado: '',
    },
  };
}

function buildRegistrationDuplicateMessage(rows, documento, correo) {
  const normalizedDocumento = String(documento);
  const normalizedCorreo = String(correo).trim().toLowerCase();
  const documentExists = rows.some((row) => String(row.documento) === normalizedDocumento);
  const emailExists = rows.some(
    (row) => typeof row.correo === 'string' && row.correo.trim().toLowerCase() === normalizedCorreo
  );
  const overrideRecipient = resolveRegistrationRecipient(correo);
  const registrationEmailOverrideActive = overrideRecipient !== correo;

  if (documentExists && emailExists) {
    return 'La cuenta ya existe: el número de documento y el correo institucional ya están registrados en el sistema.';
  }

  if (documentExists) {
    return 'El número de documento ingresado ya tiene una cuenta registrada en el sistema.';
  }

  if (emailExists) {
    if (registrationEmailOverrideActive) {
      return 'El correo institucional ingresado ya está asociado a otra cuenta. Debes escribir el correo real del usuario que estás probando; el código seguirá llegando al buzón de pruebas configurado.';
    }

    return 'El correo institucional ingresado ya está asociado a otra cuenta registrada.';
  }

  return 'No fue posible validar los datos del registro. Revisa la información e inténtalo nuevamente.';
}

function resolveRegistrationRecipient(correo) {
  const overrideRecipient = process.env.REGISTRATION_EMAIL_OVERRIDE;

  if (typeof overrideRecipient === 'string' && overrideRecipient.trim()) {
    return overrideRecipient.trim();
  }

  return correo;
}

router.post(
  '/email_verification',
  limiter,
  securityLogger,
  [
    body('correo')
      .isEmail()
      .notEmpty()
      .matches(/^[a-zA-Z0-9._%+-]+@udistrital\.edu\.co$/)
      .withMessage('Solo se permiten correos institucionales (@udistrital.edu.co)')
      .escape(),
    body('password')
      .isString()
      .notEmpty()
      .isLength({ min: 8 })
      .withMessage('La contraseña debe tener al menos 8 caracteres')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>])/)
      .withMessage(
        'La contraseña debe contener al menos una letra minúscula, una mayúscula, un número y un carácter especial'
      ),
    body('confirmar_password')
      .isString()
      .notEmpty()
      .custom((value, { req }) => {
        if (value !== req.body.password) {
          throw new Error('Las contraseñas no coinciden');
        }
        return true;
      }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const tipo_usuario = req.body.tipo_usuario;
      const { templateName, templateData } = buildRegistrationTemplateState(
        tipo_usuario,
        req.session
      );

      const errorMessages = errors
        .array()
        .map((error) => error.msg)
        .join('. ');

      return res.render(templateName, {
        ...templateData,
        confirmacion: null,
        error: errorMessages,
      });
    }

    const tipo_usuario = req.body.tipo_usuario;
    let documento, codigo, nombre, estado, carrera;

    if (tipo_usuario === 'estudiante' && req.session.studentData) {
      documento = req.session.studentData.con_documento_completo;
      codigo = req.session.studentData.con_codigo_completo;
      nombre = req.session.studentData.con_nombre_completo;
      estado = req.session.studentData.con_estado_completo;
      carrera = req.session.studentData.con_carrera_completa;
    } else if (tipo_usuario === 'docente' && req.session.teacherData) {
      documento = req.session.teacherData.con_documento_completo;
      codigo = null; // Los docentes no tienen código
      nombre = req.session.teacherData.con_nombre_completo;
      estado = req.session.teacherData.con_estado_completo;
      carrera = null; // Los docentes no tienen carrera específica
    } else {
      return res.status(400).render('home/register_data', {
        con_documento: req.body.numero_documento_identificacion || '',
        con_codigo: '',
        con_nombre: '',
        con_carrera: '',
        con_estado: '',
        confirmacion: null,
        error: 'Sesión expirada. Por favor, consulte sus datos nuevamente.',
      });
    }

    const correo = req.body.correo;
    const password = req.body.password;

    // Usar pool en vez de Client
    try {
      const query = 'SELECT * FROM usuario WHERE documento=$1 OR correo=$2';
      const values = [documento, correo];
      const result = await pool.query(query, values);
      console.log('query: ' + result.rowCount);

      if (result.rowCount === 0) {
        req.session.usuario_no_verificado = {
          documento,
          codigo,
          nombre,
          correo,
          carrera,
          estado,
          password,
          tipo: tipo_usuario,
        };

        delete req.session.studentData;
        delete req.session.teacherData;

        res.render('home/email_verification', { correo });
      } else {
        const { templateName, templateData } = buildRegistrationTemplateState(
          tipo_usuario,
          req.session
        );

        return res.render(templateName, {
          ...templateData,
          confirmacion: null,
          error: buildRegistrationDuplicateMessage(result.rows, documento, correo),
        });
      }
    } catch (error) {
      console.log('Error al intentar agregar el usuario:', error);
      res.render('home/message_error', {
        message: '¡Error al intentar agregar el usuario!',
        message2: '!Verifica tus datos nuevamente!',
        limit: false,
      });
    }
  }
);

router.post('/enviar-codigo', async (req, res) => {
  const codigoVerificacion = generarCodigoAleatorio();
  req.session.usuario_no_verificado.codigoVerificacion = codigoVerificacion;
  const usuario = req.session.usuario_no_verificado;
  const recipient = resolveRegistrationRecipient(usuario.correo);
  const registrationEmailOverrideActive = recipient !== usuario.correo;
  //console.log("LLEGA CORREO ACA -------" + usuario.correo);
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: recipient,
      subject: 'Verificación de correo - MILab Laboratorios UD',
      //text: `Hola Tu código de verificación es: ${usuario.codigoVerificacion}`
      text: `Hola ${usuario.nombre || 'usuario'},

            ${registrationEmailOverrideActive ? `Este correo fue redirigido a un buzón de pruebas. Destinatario original: ${usuario.correo}\n` : ''}

            Tu código de verificación es: ${usuario.codigoVerificacion}
            
            Este código es válido por 10 minutos.
            
            Por tu seguridad, nunca compartas este código. Si no solicitaste esto, puedes ignorar este mensaje.
            
            Atentamente,
            Equipo MILab`,

      // 3. Versión HTML (la plantilla mejorada)
      // Usamos template literals (comillas invertidas ``) para insertar el HTML y las variables fácilmente.
      html: `
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <meta name="color-scheme" content="light only">
                  <meta name="supported-color-schemes" content="light only">
                    <title>Tu Código de Verificación</title>
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
                                    
                                    <!-- Título Principal -->
                                    <tr>
                                        <td align="center" style="padding: 0 30px;">
                                            <h1 class="fallback-font" style="font-size: 28px; font-weight: 700; color: #202124; margin: 0;">Código de Verificación de MILab</h1>
                                        </td>
                                    </tr>
                                    
                                    <!-- 3. Contenido principal y Saludo -->
                                    <tr>
                                        <td style="padding: 24px 30px 10px 30px;">
                                            <p class="fallback-font" style="font-size: 16px; line-height: 1.6; color: #5f6368; margin: 0;">
                                                Hola ${usuario.nombre || 'usuario'},
                                            </p>
                                          ${
                                            registrationEmailOverrideActive
                                              ? `<p class="fallback-font" style="font-size: 14px; line-height: 1.6; color: #b3261e; margin-top: 12px;">
                                            Este correo fue redirigido a un buzón de pruebas. Destinatario original: ${usuario.correo}
                                          </p>`
                                              : ''
                                          }
                                            <p class="fallback-font" style="font-size: 16px; line-height: 1.6; color: #5f6368; margin-top: 16px;">
                                               Use el siguiente código para completar el inicio de sesión en MILab de la Coordinación General de Laboratorios.
                                            </p>
                                        </td>
                                    </tr>
                                    
                                    <!-- 4. El Código de Verificación -->
                                    <tr>
                                        <td align="center" style="padding: 10px 30px;">
                                            <div style="background-color: #e8f0fe; border-radius: 8px; text-align: center; padding: 12px 20px;">
                                                <p class="fallback-font" style="font-size: 36px; font-weight: 700; letter-spacing: 5px; color: #1967d2; margin: 0;">
                                                    ${usuario.codigoVerificacion}
                                                </p>
                                            </div>
                                        </td>
                                    </tr>
                                    
                                    <!-- 5. Mensaje de validez y seguridad -->
                                    <tr>
                                        <td style="padding: 20px 30px;">
                                            <p class="fallback-font" style="text-align: center; font-size: 14px; color: #5f6368; margin: 0;">
                                                Este código expirará en <strong>10 minutos</strong>.
                                            </p>
                                            <p class="fallback-font" style="text-align: center; font-size: 14px; line-height: 1.5; color: #5f6368; margin-top: 16px;">
                                                <strong>Advertencia de seguridad:</strong> Para proteger su cuenta, nunca comparta este código. Nuestro equipo de soporte nunca se lo solicitará.
                                            </p>
                                        </td>
                                    </tr>
            
                                    ${buildEmailFooterHtml(`
                                      <p class="fallback-font" style="font-size: 14px; color: rgba(255,255,255,0.92); margin: 0; text-align: center; line-height: 1.6;">
                                      Si no solicitó este código, puede ignorar este correo de forma segura. Es posible que otro usuario haya introducido su email por error.
                                      </p>
                                      <p class="fallback-font" style="font-size: 14px; color: rgba(255,255,255,0.92); margin: 14px 0 0 0; text-align: center; line-height: 1.6;">
                                      Atentamente,<br><strong>Equipo de la Coordinación General de Laboratorios</strong>
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

    if (registrationEmailOverrideActive) {
      console.warn('Registration email override active', {
        originalRecipient: usuario.correo,
        redirectedRecipient: recipient,
        documento: usuario.documento,
        tipo: usuario.tipo,
      });
    }

    res.send('Código de verificación enviado al correo (Si no ve el correo, revise su spam).');
  } catch (error) {
    console.error('Error al enviar el correo:', error.message);
    res.send('Error al enviar el correo.');
  }
});

// --- RUTA PARA CREAR LA CUENTA DESPUÉS DE VERIFICAR ---
router.post('/create_account', limiter, securityLogger, async (req, res) => {
  if (!req.session.usuario_no_verificado) {
    return res.render('home/message_error', {
      message: '¡Ha ocurrido un error!',
      message2: '¡Inténtalo nuevamente!',
      limit: null,
    });
  }

  console.log('Datos usuario actual: ' + req.session.usuario_no_verificado.documento);
  const usuario = req.session.usuario_no_verificado;
  console.log(req.body.codigo_verificacion + ' === ' + usuario.codigoVerificacion);

  if (req.body.codigo_verificacion != usuario.codigoVerificacion) {
    res.render('home/message_error', {
      message: '¡Código de verificación incorrecto!',
      message2: 'Asegurate de ingresarlo correctamente!',
      limit: false,
    });
  } else {
    try {
      const items = await create_account(usuario);
      if (!items) {
        res.render('home/message_error', {
          message: '¡Ha ocurrido un error!',
          message2: '¡Inténtalo nuevamente!',
          limit: 'noSession',
        });
      } else {
        req.session.destroy((err) => {
          if (err) {
            console.error('Error al destruir la sesión:', err);
            res.status(500).send('Error al cerrar sesión');
          }
        });
        res.render('home/login_2', { error: null, confirmacion: 'cuenta_creada' });
      }
    } catch {
      res.render('home/message_error', {
        message: '¡Error al intentar agregar el usuario!',
        message2: '!Verifica tus datos nuevamente!',
        limit: 'noSession',
      });
    }
  }
});

async function create_account(data) {
  const documento = data.documento;
  const codigo = data.codigo ? parseInt(data.codigo) : null; // Solo convertir si existe, null para docentes
  const nombre = data.nombre;
  const correo = data.correo;
  const estado = data.estado;
  const carrera = data.carrera;
  const tipo = data.tipo;
  try {
    const result1 = await pool.query(
      `INSERT INTO usuario (documento, codigo, nombre, correo, estado, carrera)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (documento) DO UPDATE
       SET codigo = EXCLUDED.codigo,
           nombre = EXCLUDED.nombre,
           correo = EXCLUDED.correo,
           estado = EXCLUDED.estado,
           carrera = EXCLUDED.carrera,
           fecha_modificacion = CURRENT_TIMESTAMP
       RETURNING id`,
      [documento, codigo, nombre, correo, estado, carrera]
    );

    const userId = result1.rows[0]?.id;
    if (!userId) {
      throw new Error('No fue posible crear el usuario');
    }

    await pool.query(
      `INSERT INTO usuario_rol (usuario_id, rol_id, activo)
       SELECT $1, id, TRUE FROM rol WHERE nombre = $2
       ON CONFLICT (usuario_id, rol_id) DO UPDATE
       SET activo = TRUE,
           fecha_modificacion = CURRENT_TIMESTAMP`,
      [userId, tipo]
    );

    return result1;
  } catch (error) {
    console.error('Error en la función create_account:', error);
  }
}

// --- FUNCIÓN PARA GENERAR EL CÓDIGO DE VERIFICACIÓN ---
function generarCodigoAleatorio() {
  const longitudCodigo = 6;
  const codigoAleatorio =
    Math.floor(Math.random() * (Math.pow(10, longitudCodigo) - Math.pow(10, longitudCodigo - 1))) +
    Math.pow(10, longitudCodigo - 1);
  return codigoAleatorio.toString();
}

module.exports = router;
