const express = require('express');
const pool = require('../../libs/db');
const transporter = require('../../libs/mail');
const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
} = require('../../libs/email-layout');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');

const router = express.Router();

const SANCTION_TYPES = [
  'Suspensión temporal del acceso al laboratorio',
  'Realizar cursos de buenas prácticas o seguridad',
  'Amonestación verbal o escrita',
  'Firma de compromiso de buen uso',
  'Apoyo en organización del laboratorio',
  'Reposición de materiales o insumos',
  'Reemplazar exactamente lo que dañó o perdió',
];

function normalizeSanctionType(value) {
  return (value || '').toString().trim();
}

async function resolveStudentContactByCodigo(codigo) {
  const codigoParam = codigo ? String(codigo).trim() : '';

  if (!codigoParam) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT nombre, documento, correo
      FROM (
        SELECT u.nombre, u.documento, u.correo, 1 AS priority
        FROM usuario u
        WHERE u.codigo::text = $1

        UNION ALL

        SELECT e.nombre, e.cc::text AS documento, e.correo, 2 AS priority
        FROM estudiante e
        WHERE e.codigo::text = $1
      ) candidates
      WHERE correo IS NOT NULL
        AND correo <> ''
      ORDER BY priority
      LIMIT 1
    `,
    [codigoParam]
  );

  return result.rows[0] || null;
}

async function sendSanctionActivationEmail({
  correo,
  nombre,
  codigo,
  tipoSancion,
  observaciones,
  laboratorio,
  fecha,
}) {
  if (!correo) return;

  const safeNombre = nombre || 'estudiante';

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: correo,
    subject: 'Notificación de sanción activada - MiLab Laboratorios UD',
    text: `Hola ${safeNombre},\n\nSe ha activado una sanción asociada a tu registro con código ${codigo}.\n\nTipo de sanción: ${tipoSancion}.\nLaboratorio: ${laboratorio || 'N/A'}.\nFecha: ${fecha || 'N/A'}.\nObservaciones: ${observaciones || 'Sin observaciones'}.\n\nSi tienes dudas, comunícate con la coordinación de laboratorios.`,
    html: `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light only">
        <meta name="supported-color-schemes" content="light only">
        <title>Sanción activada</title>
      </head>
      <body style="margin:0;padding:0;background-color:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color:#f8f9fa;">
          <tr>
            <td align="center" style="padding:20px 10px;">
              <table width="600" border="0" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;box-shadow:0 6px 18px rgba(0,0,0,0.06);">
                ${buildEmailHeaderHtml()}
                <tr>
                  <td align="center" style="padding:30px 30px 20px 30px;">
                    <h1 style="font-size:22px;margin:0;color:#202124;">Se activó una sanción</h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 30px 20px 30px;">
                    <p style="font-size:16px;line-height:1.6;color:#5f6368;margin:0;">
                      Hola ${safeNombre},
                    </p>
                    <p style="font-size:15px;line-height:1.6;color:#5f6368;margin-top:16px;">
                      Se ha activado una sanción asociada a tu registro con código <strong>${codigo}</strong>.
                    </p>
                    <div style="background:#f8f9fa;border-radius:8px;padding:16px;border-left:4px solid #e53935;margin-top:16px;">
                      <p style="margin:0;font-size:14px;color:#202124;"><strong>Tipo de sanción:</strong> ${tipoSancion}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Laboratorio:</strong> ${laboratorio || 'N/A'}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Fecha:</strong> ${fecha || 'N/A'}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Observaciones:</strong> ${observaciones || 'Sin observaciones'}</p>
                    </div>
                    <p style="font-size:14px;line-height:1.6;color:#5f6368;margin-top:18px;">
                      Si tienes dudas, comunícate con la coordinación de laboratorios.
                    </p>
                  </td>
                </tr>
                ${buildEmailFooterHtml(`
                  <p style="font-size:14px;color:rgba(255,255,255,0.92);margin:0;text-align:center;line-height:1.6;">
                    Sistema de Paz y Salvos - Coordinación General de Laboratorios
                  </p>
                `)}
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `,
    attachments: buildBrandedEmailAttachments(),
  };

  await transporter.sendMail(mailOptions);
}

const requireCoordinadorApprovalAccess = requireRoles('coordinador', {
  message: '¡Algo ha salido mal!',
  message2: 'No tienes permisos para acceder a esta vista.',
  limit: 'noSession',
});

const requireCoordinadorApprovalAction = requireRoles('coordinador', {
  message: 'No autorizado',
  message2: 'Tu sesión no tiene permisos suficientes.',
  limit: 'noSession',
});

// GET: Vista de aprobación de multas
router.get('/', requireCoordinadorApprovalAccess, async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const scope = await resolveCoordinatorScope(pool, req.session.user.documento);

    if (!scope.coordinatorDocument) {
      return res.render('home/message_error', {
        message: 'No se encontró información del coordinador.',
        message2: 'Verifique su cuenta',
        limit: null,
      });
    }

    if (scope.facultyIds.length === 0) {
      return res.render('home/message_error', {
        message: 'No hay facultades asociadas al coordinador.',
        message2: 'Contacte al administrador',
        limit: null,
      });
    }

    const result = await pool.query(
      `SELECT 
        m.id,
        COALESCE(sancionado.documento, m.cod_multado::text) AS documento_sancionado,
        m.nombre_laboratorista,
        m.cat_multa,
        m.cod_multado, 
        m.ual, 
        m.fecha_multa, 
        m.con_estado_multa, 
        m.obs_multa,
        m.tipo_sancion
      FROM multas m
      INNER JOIN ual u ON m.ual = u.nombre
      LEFT JOIN LATERAL (
        SELECT documento
        FROM (
         SELECT u2.documento, 0 AS priority
         FROM usuarios u2
         WHERE u2.documento = m.cod_multado::text

         UNION ALL

         SELECT pe.documento, 1 AS priority
         FROM perfil_estudiante pe
         WHERE pe.documento = m.cod_multado::text
           OR pe.codigo::text = m.cod_multado::text

         UNION ALL

         SELECT pd.documento, 2 AS priority
         FROM perfil_docente pd
         WHERE pd.documento = m.cod_multado::text

         UNION ALL

         SELECT u.documento, 3 AS priority
         FROM usuario u
         WHERE u.documento = m.cod_multado::text
           OR u.codigo::text = m.cod_multado::text

         UNION ALL

         SELECT e.cc::text AS documento, 4 AS priority
         FROM estudiante e
         WHERE e.cc::text = m.cod_multado::text
           OR e.codigo::text = m.cod_multado::text

         UNION ALL

         SELECT d.cc::text AS documento, 5 AS priority
         FROM docente d
         WHERE d.cc::text = m.cod_multado::text
        ) candidates
        ORDER BY priority
        LIMIT 1
      ) sancionado ON true
      WHERE m.con_estado_multa IN ('Pendiente', 'POR SALDAR')
        AND u.id_facultad = ANY($1::int[])`,
      [scope.facultyIds]
    );

    const multasPendientes = result.rows;

    res.set('Cache-Control', 'no-store');
    return res.render('home/aprobacion_multa', {
      multas: multasPendientes,
      nombreCoordinador: req.session.user.nombre,
    });
  } catch (error) {
    console.error('Error en /aprobacion_multa:', error);
    return res.render('home/message_error', {
      message: 'Error al cargar sanciones.',
      message2: 'Por favor, intenta más tarde.',
      limit: null,
    });
  }
});

// POST: Activar sanción (de Pendiente a ACTIVA)
router.post('/activar', requireCoordinadorApprovalAction, async function (req, res) {
  const { cod_multado, fecha_multa } = req.body;
  const tipo_sancion = normalizeSanctionType(req.body.tipo_sancion);

  if (!SANCTION_TYPES.includes(tipo_sancion)) {
    return res.render('home/message_error', {
      message: 'Tipo de sanción inválido',
      message2: 'Selecciona una opción válida antes de activar la sanción.',
      limit: null,
    });
  }

  try {
    const scope = await resolveCoordinatorScope(pool, req.session.user.documento);

    if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: 'La cuenta no tiene facultades asociadas.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multas AS m
      SET con_estado_multa = 'ACTIVA',
          tipo_sancion = $4
      FROM ual u
      WHERE m.cod_multado = $1
        AND m.fecha_multa = $2::date
        AND m.con_estado_multa = 'Pendiente'
        AND u.nombre = m.ual
        AND u.id_facultad = ANY($3::int[])
    `,
      [cod_multado, fecha_multa, scope.facultyIds, tipo_sancion]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo activar la sanción.',
        message2: "Verifica que esté en estado 'Pendiente'.",
        limit: null,
      });
    }

    await pool.query(
      `
      INSERT INTO logs (nombre, documento, accion, persona)
      VALUES ($1, $2, $3, $4)
    `,
      [
        req.session.user.tipo,
        scope.coordinatorDocument,
        'Cambiar estado de multa a ACTIVA',
        cod_multado,
      ]
    );

    try {
      const multaInfo = await pool.query(
        'SELECT cod_multado, ual, obs_multa FROM multas WHERE cod_multado = $1 AND fecha_multa = $2::date',
        [cod_multado, fecha_multa]
      );
      const studentInfo = await resolveStudentContactByCodigo(cod_multado);
      if (studentInfo?.correo) {
        await sendSanctionActivationEmail({
          correo: studentInfo.correo,
          nombre: studentInfo.nombre,
          codigo: cod_multado,
          tipoSancion: tipo_sancion,
          observaciones: multaInfo.rows[0]?.obs_multa,
          laboratorio: multaInfo.rows[0]?.ual,
          fecha: fecha_multa,
        });
      }
    } catch (emailError) {
      console.error('Error al enviar correo de sanción activada:', emailError);
    }

    res.redirect('./');
  } catch (error) {
    console.error('Error al activar sanción:', error);
    res.render('home/message_error', {
      message: 'Error al activar la sanción.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

// POST: Marcar sanción como SALDADA (de POR SALDAR a SALDADA)
router.post('/saldar', requireCoordinadorApprovalAction, async function (req, res) {
  const { cod_multado, fecha_multa } = req.body;

  try {
    const scope = await resolveCoordinatorScope(pool, req.session.user.documento);

    if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: 'La cuenta no tiene facultades asociadas.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multas AS m
      SET con_estado_multa = 'SALDADA'
      FROM ual u
      WHERE m.cod_multado = $1
        AND m.fecha_multa = $2::date
        AND m.con_estado_multa = 'POR SALDAR'
        AND u.nombre = m.ual
        AND u.id_facultad = ANY($3::int[])
    `,
      [cod_multado, fecha_multa, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo marcar como saldada.',
        message2: "Verifica que esté en estado 'POR SALDAR'.",
        limit: null,
      });
    }

    await pool.query(
      `
      INSERT INTO logs (nombre, documento, accion, persona)
      VALUES ($1, $2, $3, $4)
    `,
      [
        req.session.user.tipo,
        scope.coordinatorDocument,
        'Cambiar estado de multa a SALDADA',
        cod_multado,
      ]
    );

    res.redirect('./');
  } catch (error) {
    console.error('Error al marcar sanción como saldada:', error);
    res.render('home/message_error', {
      message: 'Error al marcar como saldada.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

module.exports = router;
