var express = require('express');

var router = express.Router();
const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');
const { resolveOatiName } = require('../../libs/oati-name');

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
            m.nombre_laboratorista,
            m.cc_laboratorista,
            COALESCE(sancionado.documento, m.cod_multado::text) AS documento_sancionado,
            COALESCE(sancionado.tipo, 'estudiante') AS tipo_sancionado,
            m.ual,
            TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa_formateada,
            m.con_estado_multa,
            m.obs_multa,
            m.tipo_sancion
          FROM multas m
          INNER JOIN ual ual_ref ON ual_ref.nombre = m.ual
            LEFT JOIN LATERAL (
              SELECT documento, tipo
              FROM (
                SELECT u2.documento, 'estudiante'::text AS tipo, 0 AS priority
                FROM usuarios u2
                WHERE u2.documento = m.cod_multado::text

                UNION ALL

                SELECT pe.documento, 'estudiante'::text AS tipo, 1 AS priority
                FROM perfil_estudiante pe
                WHERE pe.documento = m.cod_multado::text
                  OR pe.codigo::text = m.cod_multado::text

                UNION ALL

                SELECT pd.documento, 'docente'::text AS tipo, 2 AS priority
                FROM perfil_docente pd
                WHERE pd.documento = m.cod_multado::text

                UNION ALL

                SELECT u.documento, 'estudiante'::text AS tipo, 3 AS priority
                FROM usuario u
                WHERE u.documento = m.cod_multado::text
                  OR u.codigo::text = m.cod_multado::text

                UNION ALL

                SELECT e.cc::text AS documento, 'estudiante'::text AS tipo, 4 AS priority
                FROM estudiante e
                WHERE e.cc::text = m.cod_multado::text
                  OR e.codigo::text = m.cod_multado::text

                UNION ALL

                SELECT d.cc::text AS documento, 'docente'::text AS tipo, 5 AS priority
                FROM docente d
                WHERE d.cc::text = m.cod_multado::text
              ) candidates
              ORDER BY priority
              LIMIT 1
            ) sancionado ON true
          WHERE ual_ref.id_facultad = ANY($1::int[])
          ORDER BY m.fecha_multa DESC NULLS LAST, m.id DESC
        `,
        [scope.facultyIds]
      );
    } else {
      result = await client.query(`
        SELECT
          m.id,
          m.cat_multa,
          m.nombre_laboratorista,
          m.cc_laboratorista,
          COALESCE(sancionado.documento, m.cod_multado::text) AS documento_sancionado,
          COALESCE(sancionado.tipo, 'estudiante') AS tipo_sancionado,
          m.ual,
          TO_CHAR(m.fecha_multa, 'YYYY-MM-DD') AS fecha_multa_formateada,
          m.con_estado_multa,
          m.obs_multa,
          m.tipo_sancion
        FROM multas m
          LEFT JOIN LATERAL (
            SELECT documento, tipo
            FROM (
              SELECT u2.documento, 'estudiante'::text AS tipo, 0 AS priority
              FROM usuarios u2
              WHERE u2.documento = m.cod_multado::text

              UNION ALL

              SELECT pe.documento, 'estudiante'::text AS tipo, 1 AS priority
              FROM perfil_estudiante pe
              WHERE pe.documento = m.cod_multado::text
                OR pe.codigo::text = m.cod_multado::text

              UNION ALL

              SELECT pd.documento, 'docente'::text AS tipo, 2 AS priority
              FROM perfil_docente pd
              WHERE pd.documento = m.cod_multado::text

              UNION ALL

              SELECT u.documento, 'estudiante'::text AS tipo, 3 AS priority
              FROM usuario u
              WHERE u.documento = m.cod_multado::text
                OR u.codigo::text = m.cod_multado::text

              UNION ALL

              SELECT e.cc::text AS documento, 'estudiante'::text AS tipo, 4 AS priority
              FROM estudiante e
              WHERE e.cc::text = m.cod_multado::text
                OR e.codigo::text = m.cod_multado::text

              UNION ALL

              SELECT d.cc::text AS documento, 'docente'::text AS tipo, 5 AS priority
              FROM docente d
              WHERE d.cc::text = m.cod_multado::text
            ) candidates
            ORDER BY priority
            LIMIT 1
          ) sancionado ON true
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
    res.status(500).send('Error en el servidor');
  }
});

module.exports = router;
