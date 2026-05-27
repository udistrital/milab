const express = require('express');
const pool = require('../../libs/db');
const transporter = require('../../libs/mail');
const {
  buildBrandedEmailAttachments,
  buildEmailFooterHtml,
  buildEmailHeaderHtml,
  escapeHtml,
} = require('../../libs/email-layout');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

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

async function resolveStudentContactByUsuarioId(usuarioId) {
  if (!usuarioId) return null;

  const result = await pool.query(
    `
      SELECT u.nombre, u.documento, u.codigo, u.correo
      FROM usuario u
      WHERE u.id = $1
      LIMIT 1
    `,
    [usuarioId]
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
  const h = escapeHtml;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: correo,
    subject: 'Notificación de sanción activada - MILab Laboratorios UD',
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
                      Hola ${h(safeNombre)},
                    </p>
                    <p style="font-size:15px;line-height:1.6;color:#5f6368;margin-top:16px;">
                      Se ha activado una sanción asociada a tu registro con código <strong>${h(codigo)}</strong>.
                    </p>
                    <div style="background:#f8f9fa;border-radius:8px;padding:16px;border-left:4px solid #e53935;margin-top:16px;">
                      <p style="margin:0;font-size:14px;color:#202124;"><strong>Tipo de sanción:</strong> ${h(tipoSancion)}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Laboratorio:</strong> ${h(laboratorio || 'N/A')}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Fecha:</strong> ${h(fecha || 'N/A')}</p>
                      <p style="margin:6px 0 0 0;font-size:14px;color:#202124;"><strong>Observaciones:</strong> ${h(observaciones || 'Sin observaciones')}</p>
                    </div>
                    <p style="font-size:14px;line-height:1.6;color:#5f6368;margin-top:18px;">
                      Si tienes dudas, comunícate con la coordinación de laboratorios.
                    </p>
                  </td>
                </tr>
                ${buildEmailFooterHtml(`
                  <p style="font-size:14px;color:rgba(255,255,255,0.92);margin:0;text-align:center;line-height:1.6;">
                    MILab - Coordinación General de Laboratorios
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
        m.usuario_id_sancionado,
        COALESCE(pe.documento, pd.documento, us.documento) AS documento_sancionado,
        CASE WHEN pd.usuario_id IS NOT NULL THEN 'docente' ELSE 'estudiante' END AS tipo_sancionado,
        us.codigo AS codigo_sancionado,
        l.nombre AS nombre_laboratorista,
        m.cat_multa,
        u.nombre AS ual, 
        m.fecha_multa, 
        m.con_estado_multa, 
        m.obs_multa,
        m.tipo_sancion
      FROM multa m
      INNER JOIN ual u ON u.id_ual = m.id_ual
      LEFT JOIN laboratorista l ON l.documento = m.documento_laboratorista
      LEFT JOIN usuario us ON us.id = m.usuario_id_sancionado
      LEFT JOIN perfil_estudiante pe ON pe.usuario_id = m.usuario_id_sancionado
      LEFT JOIN perfil_docente pd ON pd.usuario_id = m.usuario_id_sancionado
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
  const body = req.body || {};
  const { multa_id } = body;
  const tipo_sancion = normalizeSanctionType(body.tipo_sancion);

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
      UPDATE multa AS m
      SET con_estado_multa = 'ACTIVA',
          tipo_sancion = $2
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'Pendiente'
        AND u.id_ual = m.id_ual
        AND u.id_facultad = ANY($3::int[])
    `,
      [multa_id, tipo_sancion, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo activar la sanción.',
        message2: "Verifica que esté en estado 'Pendiente'.",
        limit: null,
      });
    }

    try {
      const multaInfo = await pool.query(
        'SELECT m.usuario_id_sancionado, m.fecha_multa, u.nombre AS ual, m.obs_multa FROM multa m LEFT JOIN ual u ON u.id_ual = m.id_ual WHERE m.id = $1',
        [multa_id]
      );
      const usuarioId = multaInfo.rows[0]?.usuario_id_sancionado;
      const studentInfo = await resolveStudentContactByUsuarioId(usuarioId);
      const referencia = studentInfo?.codigo || studentInfo?.documento || '';
      await pool.query(
        `
        INSERT INTO log (nombre, documento, accion, persona)
        VALUES ($1, $2, $3, $4)
      `,
        [
          req.session.user.tipo,
          scope.coordinatorDocument,
          'Cambiar estado de multa a ACTIVA',
          referencia || String(multa_id),
        ]
      );
      if (studentInfo?.correo) {
        await sendSanctionActivationEmail({
          correo: studentInfo.correo,
          nombre: studentInfo.nombre,
          codigo: referencia,
          tipoSancion: tipo_sancion,
          observaciones: multaInfo.rows[0]?.obs_multa,
          laboratorio: multaInfo.rows[0]?.ual,
          fecha: multaInfo.rows[0]?.fecha_multa,
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
  const body = req.body || {};
  const { multa_id } = body;

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
      UPDATE multa AS m
      SET con_estado_multa = 'SALDADA'
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'POR SALDAR'
        AND u.id_ual = m.id_ual
        AND u.id_facultad = ANY($2::int[])
    `,
      [multa_id, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo marcar como saldada.',
        message2: "Verifica que esté en estado 'POR SALDAR'.",
        limit: null,
      });
    }

    const sancionadoResult = await pool.query(
      'SELECT u.documento FROM multa m LEFT JOIN usuario u ON u.id = m.usuario_id_sancionado WHERE m.id = $1',
      [multa_id]
    );
    const documentoSancionado = sancionadoResult.rows[0]?.documento || String(multa_id);

    await pool.query(
      `
      INSERT INTO log (nombre, documento, accion, persona)
      VALUES ($1, $2, $3, $4)
    `,
      [
        req.session.user.tipo,
        scope.coordinatorDocument,
        'Cambiar estado de multa a SALDADA',
        documentoSancionado,
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
