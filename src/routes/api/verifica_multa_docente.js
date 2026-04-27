const express = require('express');
const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');
// Variables de entorno
require('dotenv').config();

var router = express.Router();

const requireTeacherCertificateAccess = requireRoles(['admin', 'docente'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

async function resolveTeacherEmailForSession(documento) {
  const result = await pool.query(
    `
      SELECT correo
      FROM (
        SELECT d.correo, 1 AS priority
        FROM docente d
        WHERE d.cc::text = $1

        UNION ALL

        SELECT a.correo, 2 AS priority
        FROM auth a
        WHERE a.documento = $1
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

  const query =
    "SELECT COUNT(*) AS multado FROM multas WHERE cod_multado = $1 AND con_estado_multa='ACTIVA'";
  const values = [con_documento];

  const result = await pool.query(query, values);
  const con_multado = result.rows[0].multado > 0;

  let multaInfo = null;
  if (con_multado) {
    const queryMultaInfo =
      "SELECT * FROM multas WHERE cod_multado = $1 AND con_estado_multa='ACTIVA'";
    const valuesMultaInfo = [con_documento];

    const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
    multaInfo = resultMultaInfo.rows;
    console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
    console.log(multaInfo);
  }
  if (con_multado) {
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
