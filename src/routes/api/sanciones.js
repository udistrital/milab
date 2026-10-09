const express = require('express');
const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');
const { renderApplicationError } = require('../middlewares/error-handler');
const { sendEmailNotification } = require('../../libs/email-notifications');
const { buildAppUrl } = require('../../libs/app-url');
const {
  claimError,
  hasClaimRole,
  validateClaimId,
  resolveClaimStudent,
  resolveClaimLaboratorista,
  createSanctionClaim,
  respondToSanctionClaim,
  reassignSanctionClaim,
} = require('../../libs/sanction-claims');

const router = express.Router();
router.use(express.json());
router.use(express.urlencoded({ extended: false }));
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const requireStudent = requireRoles('estudiante', {
  message: 'Acceso denegado',
  limit: 'loginOnly',
});
const requireInbox = requireRoles(['admin', 'laboratorista'], {
  message: 'Acceso denegado',
  limit: 'loginOnly',
});

function renderError(req, res, error) {
  if (!error.status || error.status >= 500)
    console.error('Error gestionando reclamaciones de sanciones:', error);
  return renderApplicationError(
    res,
    {
      status: error.status || 500,
      message:
        error.status && error.status < 500
          ? error.message
          : 'No fue posible procesar la reclamación.',
      message2:
        error.status && error.status < 500
          ? 'Regresa a la plataforma para consultar el estado actual.'
          : 'Inténtalo nuevamente. Si el problema persiste, contacta al soporte de MILab.',
      limit: null,
    },
    req,
    error
  );
}

function takeFeedback(req) {
  const feedback = req.session.sanctionClaimFeedback || null;
  delete req.session.sanctionClaimFeedback;
  return feedback;
}

router.get('/mis-sanciones', requireStudent, async (req, res) => {
  try {
    const studentId = await resolveClaimStudent(pool, req.session.user);
    const result = await pool.query(
      `SELECT m.id, m.cat_multa, m.tipo_sancion, m.obs_multa,
              TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa, m.con_estado_multa,
              ual.nombre AS laboratorio, l.nombre AS creador,
              r.id AS reclamacion_id, r.texto, r.fecha_creacion AS fecha_reclamacion,
              r.respuesta, r.decision, r.fecha_respuesta, r.fecha_lectura,
              responsable.nombre AS responsable, responsable.activo AS responsable_activo,
              respondiente.nombre AS respondido_por
       FROM multa m
       LEFT JOIN ual ON ual.ual_id = m.ual_id
       JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
       LEFT JOIN reclamacion_sancion r ON r.multa_id = m.id
       LEFT JOIN laboratorista responsable ON responsable.documento = r.responsable_documento_id
       LEFT JOIN laboratorista respondiente ON respondiente.documento = r.respondido_por_id
       WHERE m.usuario_sancionado_id = $1
       ORDER BY m.fecha_multa DESC NULLS LAST, m.id DESC`,
      [studentId]
    );
    return res.render('home/mis_sanciones', {
      sanctions: result.rows,
      feedback: takeFeedback(req),
    });
  } catch (error) {
    return renderError(req, res, error);
  }
});

router.get('/reclamaciones', requireInbox, async (req, res) => {
  try {
    const user = req.session.user;
    const isAdmin = hasClaimRole(user, 'admin');
    const readOnly = !isAdmin && hasClaimRole(user, 'coordinador_general');
    const document = isAdmin || readOnly ? null : await resolveClaimLaboratorista(pool, user);
    const result = await pool.query(
      `SELECT r.*, m.cat_multa, m.obs_multa, m.con_estado_multa,
              TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa,
              ual.nombre AS laboratorio, estudiante.nombre AS estudiante,
              estudiante.documento, estudiante.codigo,
              responsable.nombre AS responsable, responsable.activo AS responsable_activo,
              respondiente.nombre AS nombre_respondiente
       FROM reclamacion_sancion r
       JOIN multa m ON m.id = r.multa_id
       JOIN usuario estudiante ON estudiante.id = m.usuario_sancionado_id
       LEFT JOIN ual ON ual.ual_id = m.ual_id
       JOIN laboratorista responsable ON responsable.documento = r.responsable_documento_id
       LEFT JOIN laboratorista respondiente ON respondiente.documento = r.respondido_por_id
       WHERE ($1::text IS NULL OR r.responsable_documento_id = $1)
       ORDER BY (r.fecha_respuesta IS NULL) DESC, r.fecha_creacion DESC`,
      [document]
    );
    const laboratoristas = isAdmin
      ? (
          await pool.query(
            'SELECT documento, nombre FROM laboratorista WHERE activo = TRUE ORDER BY nombre'
          )
        ).rows
      : [];
    return res.render('home/reclamaciones_sanciones', {
      claims: result.rows,
      laboratoristas,
      isAdmin,
      readOnly,
      feedback: takeFeedback(req),
    });
  } catch (error) {
    return renderError(req, res, error);
  }
});

async function notifyClaim(claimId, event) {
  try {
    const result = await pool.query(
      `SELECT r.id, r.multa_id, r.fecha_respuesta, l.correo AS correo_laboratorista,
              l.activo AS responsable_activo, estudiante.correo AS correo_estudiante
       FROM reclamacion_sancion r
       JOIN multa m ON m.id = r.multa_id
       JOIN usuario estudiante ON estudiante.id = m.usuario_sancionado_id
       JOIN laboratorista l ON l.documento = r.responsable_documento_id
       WHERE r.id = $1`,
      [claimId]
    );
    const data = result.rows[0];
    if (!data) throw new Error('No encontramos la reclamación guardada para notificar.');
    if (event !== 'respuesta' && data.responsable_activo === false) {
      return 'La reclamación quedó guardada, pero el responsable está inactivo. Un administrador debe reasignarla.';
    }
    const recipient = event === 'respuesta' ? data.correo_estudiante : data.correo_laboratorista;
    if (!recipient || /@placeholder\.milab\.local$/i.test(recipient))
      throw new Error('El destinatario no tiene un correo disponible.');
    const response = await sendEmailNotification({
      sourceSystem: 'sanciones',
      templateName: 'sanciones/reclamacion',
      recipient,
      subject:
        event === 'respuesta'
          ? 'Respuesta a tu reclamación de sanción - MILab'
          : 'Reclamación de sanción pendiente - MILab',
      correlationId: `reclamacion-${claimId}-${event}`,
      variables: {
        answered: event === 'respuesta',
        multaId: data.multa_id,
        actionUrl: buildAppUrl(
          event === 'respuesta' ? '/api/sanciones/mis-sanciones' : '/api/sanciones/reclamaciones'
        ),
      },
    });
    if (response.status !== 'SENT')
      throw new Error(response.error || 'No se pudo enviar el aviso por correo.');
    return null;
  } catch (error) {
    console.error('La reclamación fue guardada, pero falló su notificación por correo:', error);
    return 'El cambio quedó guardado y visible en MILab, pero no fue posible enviar el aviso por correo.';
  }
}

async function mutateClaim(req, res, operation, destination, event) {
  let client;
  let committed = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const claimId = await operation(client, req.session.user);
    await client.query('COMMIT');
    committed = true;
    client.release();
    client = null;
    const warning = await notifyClaim(claimId, event);
    req.session.sanctionClaimFeedback = {
      type: warning ? 'warning' : 'success',
      message:
        warning ||
        (event === 'respuesta'
          ? 'La respuesta quedó registrada. La reclamación está cerrada; el estado de la sanción no se modificó.'
          : event === 'reasignacion'
            ? 'La reclamación fue reasignada y el responsable recibió un aviso.'
            : 'Tu reclamación fue enviada al responsable. Puedes consultar la respuesta en Mis sanciones.'),
    };
    return res.redirect(303, destination);
  } catch (error) {
    if (client && !committed) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo reclamación:', rollbackError);
      }
    }
    return renderError(req, res, error);
  } finally {
    if (client) client.release();
  }
}

router.post('/mis-sanciones/:id/reclamar', requireStudent, (req, res) =>
  mutateClaim(
    req,
    res,
    (client, user) => createSanctionClaim(client, user, req.params.id, req.body?.texto),
    '/milab/api/sanciones/mis-sanciones',
    'reclamacion'
  )
);
router.post('/reclamaciones/:id/responder', requireInbox, (req, res) =>
  mutateClaim(
    req,
    res,
    (client, user) =>
      respondToSanctionClaim(client, user, req.params.id, req.body?.respuesta, req.body?.decision),
    '/milab/api/sanciones/reclamaciones',
    'respuesta'
  )
);
router.post('/reclamaciones/:id/reasignar', requireInbox, (req, res) =>
  mutateClaim(
    req,
    res,
    (client, user) =>
      reassignSanctionClaim(client, user, req.params.id, req.body?.responsable_documento),
    '/milab/api/sanciones/reclamaciones',
    'reasignacion'
  )
);

router.post('/mis-sanciones/:id/leida', requireStudent, async (req, res) => {
  try {
    const studentId = await resolveClaimStudent(pool, req.session.user);
    const result = await pool.query(
      `UPDATE reclamacion_sancion r SET fecha_lectura = COALESCE(r.fecha_lectura, CURRENT_TIMESTAMP)
       FROM multa m WHERE m.id = r.multa_id AND m.usuario_sancionado_id = $1
       AND r.id = $2 AND r.fecha_respuesta IS NOT NULL RETURNING r.id`,
      [studentId, validateClaimId(req.params.id)]
    );
    if (!result.rows.length) throw claimError(404, 'No encontramos esa respuesta en tu cuenta.');
    return res.redirect(303, '/milab/api/sanciones/mis-sanciones');
  } catch (error) {
    return renderError(req, res, error);
  }
});

module.exports = router;
