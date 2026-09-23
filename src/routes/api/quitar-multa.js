// ...existing code...
const express = require('express');
const pool = require('../../libs/db');
const { fetchUserById } = require('../../libs/user-identity');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');
const { resolveMultaConfigForMultaId } = require('../../libs/multa-config');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const requireFineRemovalAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

async function resolveLaboratoristaDocument(userDocument) {
  const result = await pool.query(
    'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1 LIMIT 1',
    [String(userDocument || '').trim()]
  );
  return result.rows[0]?.documento || null;
}

function getSessionDocument(req) {
  return req.session?.user?.documento_real || req.session?.user?.documento || null;
}

router.post('/', requireFineRemovalAccess, async (req, res) => {
  const conId = Number(req.body?.con_id);

  if (!Number.isInteger(conId) || conId <= 0) {
    return res.render('home/message_error', {
      message: 'Sanción inválida',
      message2: 'No se pudo identificar la sanción a retirar.',
      limit: null,
    });
  }

  let con_estado_saldado = 'POR SALDAR';
  let accionLog = 'Cambiar estado de multa a SALDADO';
  let mensajeSuccess = 'Multa actualizada correctamente';
  let mensajeSuccess2 = '';

  try {
    // Primero obtenemos la información base y alcance de la multa
    const multaResult = await pool.query(
      `
        SELECT m.usuario_sancionado_id, m.con_estado_multa, m.ual_id, u.facultad_id
        FROM multa m
        INNER JOIN ual u ON u.ual_id = m.ual_id
        WHERE m.id = $1
        LIMIT 1
      `,
      [conId]
    );

    if (multaResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: '¡Multa no encontrada!',
        message2: 'Inténtalo nuevamente',
        limit: 'noSession',
      });
    }

    const multaActual = multaResult.rows[0];
    const userType = String(req.session?.user?.tipo || '').toLowerCase();

    if (userType === 'coordinador') {
      const coordinatorScope = await resolveCoordinatorScope(pool, getSessionDocument(req));
      if (!coordinatorScope.coordinatorDocument || coordinatorScope.facultyIds.length === 0) {
        return res.render('home/message_error', {
          message: 'No autorizado',
          message2: 'La cuenta de coordinador no tiene facultades asociadas.',
          limit: null,
        });
      }

      const facultadId = Number(multaActual.facultad_id);
      if (!Number.isFinite(facultadId) || !coordinatorScope.facultyIds.includes(facultadId)) {
        return res.render('home/message_error', {
          message: 'No autorizado',
          message2: 'No puedes retirar sanciones de una facultad fuera de tu alcance.',
          limit: null,
        });
      }
    }

    if (userType === 'laboratorista') {
      const laboratoristaDocument = await resolveLaboratoristaDocument(getSessionDocument(req));
      if (!laboratoristaDocument) {
        return res.render('home/message_error', {
          message: 'No autorizado',
          message2: 'No se encontró un laboratorista asociado a la sesión activa.',
          limit: null,
        });
      }

      const asignacionResult = await pool.query(
        `
          SELECT 1
          FROM laboratorista_ual
          WHERE laboratorista_documento_id = $1
            AND ual_id = $2
          LIMIT 1
        `,
        [laboratoristaDocument, multaActual.ual_id]
      );

      if (!asignacionResult.rows.length) {
        return res.render('home/message_error', {
          message: 'No autorizado',
          message2: 'La sanción no pertenece a una UAL asignada al laboratorista.',
          limit: null,
        });
      }
    }

    if (
      multaActual.con_estado_multa === 'SALDADA' ||
      multaActual.con_estado_multa === 'POR SALDAR'
    ) {
      return res.render('home/message_error', {
        message: 'La sanción ya está en proceso de retiro o saldada.',
        message2: 'Verifica el estado de la sanción e intenta nuevamente.',
        limit: 'noSession',
      });
    }

    const cfg = await resolveMultaConfigForMultaId(conId);
    const permiteSaldarDirecto = Boolean(cfg && cfg.permite_saldar_multas_directas);
    if (permiteSaldarDirecto) {
      con_estado_saldado = 'SALDADA';
      accionLog = 'Cambiar estado de multa a SALDADA';
      mensajeSuccess = 'Multa saldada directamente';
      mensajeSuccess2 =
        'La facultad cuenta con autorización para saldar sin aprobación del coordinador.';
    }

    const usuarioSancionadoId = multaActual.usuario_sancionado_id;
    const usuarioSancionado = await fetchUserById(usuarioSancionadoId);
    const referenciaSancionado = usuarioSancionado?.documento || 'desconocido';

    // Actualizamos el estado de la multa
    await pool.query('UPDATE multa SET con_estado_multa = $1 WHERE id = $2', [
      con_estado_saldado,
      conId,
    ]);

    let documentoReal = getSessionDocument(req);
    if (userType === 'laboratorista') {
      documentoReal = (await resolveLaboratoristaDocument(documentoReal)) || documentoReal;
    }
    if (userType === 'coordinador') {
      const coordinatorScope = await resolveCoordinatorScope(pool, documentoReal);
      documentoReal = coordinatorScope.coordinatorDocument || documentoReal;
    }

    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, documentoReal, accionLog, referenciaSancionado]
    );

    return res.render('home/message_success', {
      message: mensajeSuccess,
      message2: mensajeSuccess2 || `Sancionado registrado: ${referenciaSancionado}`,
    });
  } catch (error) {
    console.error('Error:', error);
    res.render('home/message_error', {
      message: '¡Error en la operación!',
      message2: 'Inténtalo nuevamente',
      limit: 'noSession',
    });
  }
});

module.exports = router;
