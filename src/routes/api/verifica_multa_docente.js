const express = require('express');
const pool = require('../../libs/db');
const { ensurePerfilDocente, resolveUsuarioIdForDocente } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');
// Variables de entorno
require('dotenv').config();

var router = express.Router();

const requireTeacherCertificateAccess = requireRoles(['admin', 'docente', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

async function resolveTeacherEmailForSession(documento) {
  const result = await pool.query(
    `
      SELECT correo
      FROM (
        SELECT u.correo, 1 AS priority
        FROM usuario u
        WHERE u.documento = $1::text
      ) candidates
      WHERE correo IS NOT NULL
        AND correo <> ''
      ORDER BY priority
      LIMIT 1
    `,
    [documento]
  );

  return result.rows[0]?.correo || '';
}

router.get('/verificacion', requireTeacherCertificateAccess, async function (req, res) {
  // Usar pool en vez de Client
  console.log('sesion: ' + req.session.user.documento);
  const con_documento = req.session.user.documento_real || req.session.user.documento;

  const profileResult = await pool.query(
    'SELECT documento, nombre, estado, correo FROM usuario WHERE documento = $1',
    [con_documento]
  );
  const profileRow = profileResult.rows[0] || {};

  let usuarioId = await resolveUsuarioIdForDocente(con_documento);
  if (!usuarioId && profileRow?.documento) {
    usuarioId = await ensurePerfilDocente({
      documento: profileRow.documento,
      nombre: profileRow.nombre || req.session.user?.nombre || '',
      estado: profileRow.estado || '',
      correo: profileRow.correo || '',
    });
  }
  const query =
    "SELECT COUNT(*) AS multado FROM multa WHERE usuario_id_sancionado = $1 AND con_estado_multa='ACTIVA'";
  const values = [usuarioId];

  const result = await pool.query(query, values);
  const con_multado = result.rows[0].multado > 0;

  let multaInfo = null;
  if (con_multado && usuarioId) {
    const queryMultaInfo =
      "SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_id_sancionado LEFT JOIN ual u ON u.id_ual = m.id_ual LEFT JOIN laboratorista l ON l.documento = m.documento_laboratorista WHERE m.usuario_id_sancionado = $1 AND m.con_estado_multa='ACTIVA'";
    const valuesMultaInfo = [usuarioId];

    const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
    multaInfo = resultMultaInfo.rows;
    console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
    console.log(multaInfo);
  }
  if (con_multado && usuarioId) {
    console.log('El docente es multado. No se puede continuar.');
    return res.render('home/alerta-multado', { multaInfo });
  } else {
    const correo = await resolveTeacherEmailForSession(con_documento);

    return res.render('home/get-info-docente', {
      correo: correo || profileRow.correo || '',
      tipo: req.session.user?.tipo,
      nombre: profileRow.nombre || req.session.user?.nombre || '',
      documento: profileRow.documento || con_documento,
      estado: profileRow.estado || '',
    });
  }
});

module.exports = router;
