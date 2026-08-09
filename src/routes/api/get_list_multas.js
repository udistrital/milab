var express = require('express');

var router = express.Router();
const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');
const { resolveOatiName } = require('../../libs/oati-name');
const { renderApplicationError, wantsJson } = require('../middlewares/error-handler');

const bp = require('body-parser');
router.use(bp.json());
router.use(bp.urlencoded({ extended: true }));

const requireMultasAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.get('/resolve_name', requireMultasAccess, async (req, res) => {
  const documento = String(req.query.documento || '').trim();

  if (!documento) {
    return res.json({ ok: false, nombre: '' });
  }

  try {
    const nombre = await resolveOatiName(documento);
    return res.json({ ok: true, nombre: nombre || '' });
  } catch (error) {
    console.error('Error resolviendo nombre OATI:', error);
    return res.status(500).json({ ok: false, nombre: '' });
  }
});

router.get('/', requireMultasAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  let client;

  try {
    client = await pool.connect();

    let result;

    if (req.session.user.tipo === 'coordinador') {
      const scope = await resolveCoordinatorScope(client, req.session.user.documento);

      if (scope.facultyIds.length === 0) {
        client.release();
        return res.render('home/message_error', {
          message: '¡Acceso denegado!',
          message2: 'El coordinador no tiene facultades asociadas.',
          limit: null,
        });
      }

      result = await client.query(
        `
          SELECT
            m.id,
            m.cat_multa,
            l.nombre AS nombre_laboratorista,
            l.documento AS cc_laboratorista,
            COALESCE(pe.documento, pd.documento, us.documento) AS documento_sancionado,
            COALESCE(pe.codigo::text, us.codigo::text, '') AS codigo_sancionado,
            CASE WHEN pd.usuario_id IS NOT NULL THEN 'docente' ELSE 'estudiante' END AS tipo_sancionado,
            u.nombre AS ual,
            TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa_formateada,
            m.con_estado_multa,
            m.obs_multa,
            m.tipo_sancion
          FROM multa m
          INNER JOIN ual u ON u.ual_id = m.ual_id
          LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
          LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id
          LEFT JOIN perfil_estudiante pe ON pe.usuario_id = m.usuario_sancionado_id
          LEFT JOIN perfil_docente pd ON pd.usuario_id = m.usuario_sancionado_id
          WHERE u.facultad_id = ANY($1::int[])
          ORDER BY m.fecha_multa DESC NULLS LAST, m.id DESC
        `,
        [scope.facultyIds]
      );
    } else {
      result = await client.query(`
        SELECT
          m.id,
          m.cat_multa,
          l.nombre AS nombre_laboratorista,
          l.documento AS cc_laboratorista,
          COALESCE(pe.documento, pd.documento, us.documento) AS documento_sancionado,
          COALESCE(pe.codigo::text, us.codigo::text, '') AS codigo_sancionado,
          CASE WHEN pd.usuario_id IS NOT NULL THEN 'docente' ELSE 'estudiante' END AS tipo_sancionado,
          u.nombre AS ual,
          TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa_formateada,
          m.con_estado_multa,
          m.obs_multa,
          m.tipo_sancion
        FROM multa m
          LEFT JOIN ual u ON u.ual_id = m.ual_id
          LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
          LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id
          LEFT JOIN perfil_estudiante pe ON pe.usuario_id = m.usuario_sancionado_id
          LEFT JOIN perfil_docente pd ON pd.usuario_id = m.usuario_sancionado_id
        ORDER BY m.fecha_multa DESC NULLS LAST, m.id DESC
      `);
    }

    client.release();
    const rows = result.rows;
    const sancionesEstudiantes = rows.filter((row) => row.tipo_sancionado !== 'docente');
    const sancionesDocentes = rows.filter((row) => row.tipo_sancionado === 'docente');

    res.render('home/get_list_multas', {
      sampleData: rows,
      sancionesEstudiantes,
      sancionesDocentes,
    });
    //res.send(rows); // Puedes cambiar esto a una plantilla HTML para mostrar los datos de manera más amigable
  } catch (error) {
    if (client) {
      client.release();
    }

    console.error(error);

    if (wantsJson(req)) {
      return res.status(500).json({
        ok: false,
        message: 'No fue posible cargar el listado de multas.',
        message2: 'Intenta nuevamente en unos minutos.',
      });
    }

    return renderApplicationError(res, {
      status: 500,
      message: 'No fue posible cargar el listado de multas.',
      message2: 'Intenta nuevamente en unos minutos.',
      limit: null,
    });
  }
});

module.exports = router;
