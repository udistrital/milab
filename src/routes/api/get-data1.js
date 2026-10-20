const express = require('express');

const pool = require('../../libs/db');
const {
  ensurePerfilEstudiante,
  isPlaceholderEmail,
  resolveUsuarioIdForStudent,
} = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');

const router = express.Router();

const requireStudentSelfServiceAccess = requireRoles(['admin', 'estudiante'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

async function resolveStudentEmailForSession(documento, codigo) {
  const codigoParam = codigo ? String(codigo) : null;

  const result = await pool.query(
    `
      SELECT correo
      FROM (
        SELECT u.correo, 1 AS priority
        FROM usuario u
        WHERE u.documento = $1::text
          OR ($2::text IS NOT NULL AND u.codigo::text = $2::text)
      ) candidates
      WHERE correo IS NOT NULL
        AND correo <> ''
        AND LOWER(correo) <> LOWER($1::text || '@udistrital.edu.co')
        AND LOWER(correo) NOT LIKE 'no-email+%@placeholder.milab.local'
      ORDER BY priority
      LIMIT 1
    `,
    [documento, codigoParam]
  );

  return result.rows[0]?.correo || '';
}

router.get('/verificacion', requireStudentSelfServiceAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');
  console.log('sesion: ' + req.session.user.documento);
  let con_codigo = 0;

  const query1 =
    'SELECT documento, nombre, codigo, estado, carrera, correo FROM usuario WHERE documento = $1';
  const values1 = [req.session.user.documento];
  const result1 = await pool.query(query1, values1);
  const profileRow = result1.rows[0] || {};

  if (req.session.user.tipo === 'estudiante') {
    con_codigo = profileRow.codigo || 0;
  }

  const placeholderStudentAccount =
    req.session.user.tipo === 'estudiante' && isPlaceholderEmail(profileRow.correo || '');

  console.log('Resultado query: ' + con_codigo);

  let usuarioId = await resolveUsuarioIdForStudent({
    documento: req.session.user.documento,
    codigo: con_codigo,
  });
  if (!usuarioId && profileRow?.documento) {
    usuarioId = await ensurePerfilEstudiante({
      documento: profileRow.documento,
      nombre: profileRow.nombre || req.session.user?.nombre || '',
      codigo: profileRow.codigo || con_codigo,
      programa: profileRow.carrera || '',
      estado: profileRow.estado || '',
      correo: profileRow.correo || '',
    });
  }
  let con_multado = false;
  if (!placeholderStudentAccount && usuarioId) {
    const query =
      "SELECT COUNT(*) AS multado FROM multa WHERE usuario_sancionado_id = $1 AND con_estado_multa='ACTIVA'";
    const values = [usuarioId];

    const result = await pool.query(query, values);
    con_multado = Number(result.rows[0]?.multado || 0) > 0;
  }

  let multaInfo = null;
  if (con_multado && usuarioId) {
    const queryMultaInfo =
      "SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, COALESCE(facultad.nombre, unidad.nombre) AS laboratorio_facultad, CASE WHEN unidad.padre_id IS NULL THEN NULL ELSE unidad.nombre END AS laboratorio_dependencia, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id LEFT JOIN ual u ON u.ual_id = m.ual_id LEFT JOIN dependencia_facultad unidad ON unidad.dependencia_facultad_id = u.facultad_id LEFT JOIN dependencia_facultad facultad ON facultad.dependencia_facultad_id = unidad.padre_id LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id WHERE m.usuario_sancionado_id = $1 AND m.con_estado_multa='ACTIVA'";
    const valuesMultaInfo = [usuarioId];

    const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
    multaInfo = resultMultaInfo.rows;
    console.log(`Cantidad de registros de multas: ${multaInfo.length}`);
    console.log(multaInfo);
  }
  if (con_multado) {
    console.log('El estudiante es multado. No se puede continuar.');
    return res.render('home/alerta-multado', { multaInfo });
  } else {
    const resolvedCorreo = await resolveStudentEmailForSession(
      req.session.user.documento,
      con_codigo
    );

    return res.render('home/get-info2', {
      correo: resolvedCorreo || profileRow.correo || '',
      tipo: req.session.user?.tipo,
      nombre: profileRow.nombre || req.session.user?.nombre || '',
      documento:
        profileRow.documento || req.session.user?.documento_real || req.session.user?.documento,
      carrera: profileRow.carrera || '',
      estado: profileRow.estado || '',
      codigo: profileRow.codigo || '',
    });
  }
});

module.exports = router;
