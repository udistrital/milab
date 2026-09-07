require('dotenv').config();

const express = require('express');

const pool = require('../../libs/db');
const { resolveUsuarioIdForStudent } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');
const {
  isValidSanctionType,
  normalizeSanctionType,
  resolveMultaConfigForUalId,
} = require('../../libs/multa-config');
const {
  resolveStudentContactByUsuarioId,
  sendSanctionActivationEmail,
} = require('../../libs/sanction-email');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireFineSubmissionAccess = requireRoles('laboratorista', {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireFineSubmissionAccess, async (req, res) => {
  const requestBody = req.body || {};
  const {
    cat_multa,
    cod_multado,
    identificador,
    numero_documento_identificacion,
    tipo_busqueda,
    ual_id,
    fecha_multa,
    con_estado_multa,
    obs_multa,
  } = requestBody;

  const tipoBusqueda = String(tipo_busqueda || '')
    .trim()
    .toLowerCase();
  const rawIdentificador = String(identificador || cod_multado || '').trim();
  const documentoCapturado = String(numero_documento_identificacion || '').trim();
  const hasDocumento = documentoCapturado !== '';
  let effectiveTipo = 'codigo';

  if (['codigo', 'documento'].includes(tipoBusqueda)) {
    effectiveTipo = tipoBusqueda;
  } else if (hasDocumento) {
    effectiveTipo = 'documento';
  }
  const rawDocumento = documentoCapturado || null;
  const rawCodigo = rawIdentificador || null;
  const documentoMultado = effectiveTipo === 'documento' ? rawDocumento || rawCodigo : null;
  const codigoMultado = effectiveTipo === 'codigo' ? rawCodigo : null;
  const referenciaSancionado = documentoMultado || rawCodigo || rawDocumento || '';
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (!fecha_multa) {
      return res.render('home/message_error', {
        message: 'Fecha de sancion obligatoria.',
        message2: 'Selecciona una fecha valida antes de registrar la sancion.',
        limit: null,
      });
    }

    if (fecha_multa > today) {
      return res.render('home/message_error', {
        message: 'La fecha de la sancion no puede ser futura.',
        message2: 'Selecciona una fecha igual o anterior al dia de hoy.',
        limit: null,
      });
    }

    const usuarioIdSancionado = await resolveUsuarioIdForStudent({
      documento: documentoMultado,
      codigo: codigoMultado,
    });

    if (!usuarioIdSancionado) {
      return res.render('home/message_error', {
        message: 'No se encontró el estudiante para registrar la sanción.',
        message2: 'Verifica el documento o código e intenta nuevamente.',
        limit: null,
      });
    }

    const sessionDocumento = req.session.user.documento_real || req.session.user.documento;
    const laboratoristaResult = await pool.query(
      'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1',
      [sessionDocumento]
    );

    if (laboratoristaResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: 'No se encontró laboratorista asociado a la sesión.',
        message2: 'Verifica tu cuenta e intenta nuevamente.',
        limit: null,
      });
    }

    const laboratorista = laboratoristaResult.rows[0];
    const idUal = Number(ual_id);

    if (!Number.isInteger(idUal)) {
      return res.render('home/message_error', {
        message: 'UAL inválida.',
        message2: 'Selecciona una UAL válida antes de registrar la sanción.',
        limit: null,
      });
    }

    const ualResult = await pool.query(
      'SELECT 1 FROM laboratorista_ual WHERE laboratorista_documento_id = $1 AND ual_id = $2',
      [laboratorista.documento, idUal]
    );

    if (ualResult.rows.length === 0) {
      return res.render('home/message_error', {
        message: 'UAL no autorizada para este laboratorista.',
        message2: 'Selecciona una UAL de tu facultad.',
        limit: null,
      });
    }

    const cfg = await resolveMultaConfigForUalId(idUal);
    const permiteCrearActivaDirecta = Boolean(cfg && cfg.permite_crear_multas_activas_directas);

    let finalEstado = con_estado_multa;
    let tipoSancionFinal = null;
    let accionLog = 'Multa pendiente a estudiante';
    let mensajeSuccessExtra = '';
    let multaIdNueva = null;

    if (permiteCrearActivaDirecta) {
      const rawTipo = requestBody.tipo_sancion;
      if (!isValidSanctionType(rawTipo)) {
        return res.render('home/message_error', {
          message: 'Tipo de sanción inválido para creación directa.',
          message2: 'Selecciona una opción válida de tipo de sanción antes de continuar.',
          limit: null,
        });
      }
      tipoSancionFinal = normalizeSanctionType(rawTipo);
      finalEstado = 'ACTIVA';
      accionLog = 'Multa activa directa a estudiante';
      mensajeSuccessExtra =
        'La sanción fue activada inmediatamente y el correo de notificación fue enviado.';
      const inserted = await pool.query(
        'INSERT INTO multa (cat_multa, laboratorista_documento_id, usuario_sancionado_id, ual_id, fecha_multa, con_estado_multa, obs_multa, tipo_sancion) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [
          cat_multa,
          laboratorista.documento,
          usuarioIdSancionado,
          idUal,
          fecha_multa,
          finalEstado,
          obs_multa,
          tipoSancionFinal,
        ]
      );
      multaIdNueva = inserted.rows && inserted.rows[0] ? inserted.rows[0].id : null;
    } else {
      await pool.query(
        'INSERT INTO multa (cat_multa, laboratorista_documento_id, usuario_sancionado_id, ual_id, fecha_multa, con_estado_multa, obs_multa) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [
          cat_multa,
          laboratorista.documento,
          usuarioIdSancionado,
          idUal,
          fecha_multa,
          finalEstado,
          obs_multa,
        ]
      );
    }

    if (multaIdNueva) {
      try {
        const contacto = await resolveStudentContactByUsuarioId(usuarioIdSancionado);
        if (contacto && contacto.correo) {
          const ualRes = await pool.query('SELECT nombre FROM ual WHERE ual_id = $1', [idUal]);
          await sendSanctionActivationEmail({
            correo: contacto.correo,
            nombre: contacto.nombre,
            codigo: contacto.codigo || contacto.documento || referenciaSancionado,
            tipoSancion: tipoSancionFinal,
            observaciones: obs_multa,
            laboratorio: ualRes.rows[0]?.nombre,
            fecha: fecha_multa,
          });
        }
      } catch (emailErr) {
        console.error('Error enviando correo de activación directa estudiante:', emailErr);
      }
    }

    await pool.query(
      'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
      [req.session.user.tipo, laboratorista.documento, accionLog, referenciaSancionado]
    );

    return res.render('home/message_success', {
      message: 'Multa registrada correctamente',
      message2: mensajeSuccessExtra || `Sancionado registrado: ${referenciaSancionado}`,
    });
  } catch (error) {
    console.error('Error registrando multa:', error);
    return res.render('home/message_error', {
      message: 'Error al registrar la sanción.',
      message2: 'Inténtalo nuevamente.',
      limit: null,
    });
  }
});

module.exports = router;
