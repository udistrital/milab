const express = require('express');
const { requireJsonRoles } = require('../middlewares/auth');

const pool = require('../../libs/db');
const { normalizeLogDocument } = require('../../libs/account-email');
const { resolveLaboratoristaScope } = require('../../libs/capacitacion-scope');

const router = express.Router();

router.use(express.json({ limit: '256kb' }));
router.use(express.urlencoded({ extended: false, limit: '256kb' }));

const requireEquiposAccess = requireJsonRoles(['admin', 'laboratorista'], {
  message: 'No tiene permisos para gestionar la asociación de cursos con equipos.',
});

function getLogActorDocument(req) {
  return normalizeLogDocument(req.session?.user?.documento);
}

function getLogActorName(req) {
  return String(req.session?.user?.tipo || '').trim() || 'admin';
}

function parseEquiposIds(rawIds) {
  if (rawIds == null) return [];
  if (Array.isArray(rawIds)) return rawIds;
  if (typeof rawIds === 'number') return [rawIds];
  if (typeof rawIds === 'string') {
    const s = rawIds.trim();
    if (!s) return [];
    return s
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  return [];
}

async function assertCursoInScope(codigoCurso, scope) {
  if (scope.isAdmin) return { allowed: true };
  if (!codigoCurso) return { allowed: false, reason: 'codigo_curso es obligatorio.' };
  if (scope.facultyIds.length === 0 || scope.ualIds.length === 0) {
    return { allowed: false, reason: 'No tiene laboratorios autorizados para gestionar cursos.' };
  }
  const check = await pool.query(
    `SELECT 1 AS ok
     FROM cursos c
     WHERE c.codigo_curso = $1
       AND c.activo = TRUE
       AND c.id_facultad = ANY($2::int[])
       AND EXISTS (
         SELECT 1
         FROM curso_laboratorio cl
         WHERE cl.codigo_curso = c.codigo_curso
           AND cl.activo = TRUE
           AND cl.id_laboratorio = ANY($3::int[])
       )
     LIMIT 1`,
    [codigoCurso, scope.facultyIds, scope.ualIds]
  );
  if (check.rows.length === 0) {
    return {
      allowed: false,
      reason: 'El curso no pertenece a sus facultades o laboratorios autorizados, o está inactivo.',
    };
  }
  return { allowed: true };
}

async function getScopedCursos(scope) {
  if (scope.isAdmin) {
    const rows = await pool.query(
      `SELECT c.codigo_curso,
              c.id_facultad,
              f.nombre AS nombre_facultad,
              c.nombre_curso,
              c.url_edx,
              c.activo,
              COALESCE(lab.nombres, '[]') AS laboratorios_nombres
       FROM cursos c
       JOIN facultad f ON f.facultad_id = c.id_facultad
       LEFT JOIN (
           SELECT cl.codigo_curso,
                  json_agg(json_build_object(
                    'id_laboratorio', u.ual_id,
                    'nombre', u.nombre
                  ) ORDER BY u.nombre) AS nombres
           FROM curso_laboratorio cl
           JOIN ual u ON u.ual_id = cl.id_laboratorio
           WHERE cl.activo = TRUE
           GROUP BY cl.codigo_curso
       ) lab ON lab.codigo_curso = c.codigo_curso
       WHERE c.activo = TRUE
       ORDER BY c.fecha_creacion DESC`
    );
    return rows.rows;
  }
  if (scope.facultyIds.length === 0 || scope.ualIds.length === 0) return [];
  const rows = await pool.query(
    `SELECT c.codigo_curso,
            c.id_facultad,
            f.nombre AS nombre_facultad,
            c.nombre_curso,
            c.url_edx,
            c.activo,
            COALESCE(lab.nombres, '[]') AS laboratorios_nombres
     FROM cursos c
     JOIN facultad f ON f.facultad_id = c.id_facultad
     LEFT JOIN (
         SELECT cl.codigo_curso,
                json_agg(json_build_object(
                  'id_laboratorio', u.ual_id,
                  'nombre', u.nombre
                ) ORDER BY u.nombre) AS nombres
         FROM curso_laboratorio cl
         JOIN ual u ON u.ual_id = cl.id_laboratorio
         WHERE cl.activo = TRUE
         GROUP BY cl.codigo_curso
     ) lab ON lab.codigo_curso = c.codigo_curso
     WHERE c.activo = TRUE
       AND c.id_facultad = ANY($1::int[])
       AND EXISTS (
         SELECT 1
         FROM curso_laboratorio cl2
         WHERE cl2.codigo_curso = c.codigo_curso
           AND cl2.activo = TRUE
           AND cl2.id_laboratorio = ANY($2::int[])
       )
     ORDER BY c.fecha_creacion DESC`,
    [scope.facultyIds, scope.ualIds]
  );
  return rows.rows;
}

router.get('/list', requireEquiposAccess, async function (req, res) {
  try {
    const scope = await resolveLaboratoristaScope(req);
    const cursos = await getScopedCursos(scope);

    const codigosPermitidos = cursos.map((c) => c.codigo_curso);

    const equiposQ = scope.isAdmin
      ? await pool.query(
          `SELECT id, codigo, nombre, descripcion, categoria, laboratorio, facultad, estado, ubicacion, activo
           FROM equipo
           WHERE activo = TRUE
           ORDER BY nombre ASC, codigo ASC`
        )
      : await pool.query(
          `SELECT id, codigo, nombre, descripcion, categoria, laboratorio, facultad, estado, ubicacion, activo
           FROM equipo
           WHERE activo = TRUE
           ORDER BY nombre ASC, codigo ASC`
        );
    const equipos = equiposQ.rows;

    const asociadosQ = codigosPermitidos.length
      ? await pool.query(
          `SELECT ee.codigo_curso,
                  ee.id_equipo,
                  ee.activo,
                  e.codigo AS equipo_codigo,
                  e.nombre AS equipo_nombre,
                  e.facultad AS equipo_facultad,
                  e.laboratorio AS equipo_laboratorio,
                  e.estado AS equipo_estado
           FROM equipo_especializado ee
           JOIN equipo e ON e.id = ee.id_equipo
           WHERE ee.activo = TRUE
             AND ee.codigo_curso = ANY($1::varchar(100)[])
           ORDER BY ee.codigo_curso ASC, e.nombre ASC`,
          [codigosPermitidos]
        )
      : { rows: [] };

    return res.status(200).json({
      ok: true,
      scope,
      cursos,
      equipos,
      asociados: asociadosQ.rows,
    });
  } catch (error) {
    console.error('[capacitacion-equipos:/list]', error);
    return res
      .status(500)
      .json({ ok: false, message: 'Error al cargar la asociación de cursos con equipos.' });
  }
});

router.post('/asociar', requireEquiposAccess, async function (req, res) {
  const codigoCurso = String(req.body?.codigo_curso || '').trim();
  if (!codigoCurso) {
    return res.status(400).json({ ok: false, message: 'codigo_curso es obligatorio.' });
  }
  const rawIds = parseEquiposIds(req.body?.id_equipos || req.body?.equipos || []);
  const idsSet = Array.from(
    new Set(
      rawIds
        .map((x) => {
          const n = Number(x);
          return Number.isInteger(n) && n > 0 ? n : NaN;
        })
        .filter((x) => !Number.isNaN(x))
    )
  );

  const client = await pool.connect();
  try {
    const scope = await resolveLaboratoristaScope(req);
    const permiso = await assertCursoInScope(codigoCurso, scope);
    if (!permiso.allowed) {
      return res.status(403).json({ ok: false, message: permiso.reason });
    }

    const existCurso = await client.query(
      'SELECT codigo_curso, nombre_curso FROM cursos WHERE codigo_curso = $1',
      [codigoCurso]
    );
    if (existCurso.rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Curso no encontrado.' });
    }

    await client.query('BEGIN');

    await client.query(
      'DELETE FROM equipo_especializado WHERE codigo_curso = $1 AND id_equipo != ALL($2::int[])',
      [codigoCurso, idsSet.length ? idsSet : [0]]
    );

    for (const idEquipo of idsSet) {
      await client.query(
        `INSERT INTO equipo_especializado (codigo_curso, id_equipo, activo)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (codigo_curso, id_equipo) DO UPDATE
           SET activo = TRUE,
               fecha_modificacion = CURRENT_TIMESTAMP`,
        [codigoCurso, idEquipo]
      );
    }

    await client.query(
      `INSERT INTO log (nombre, documento, accion, persona)
       VALUES ($1, $2, $3, $4)`,
      [
        getLogActorName(req),
        getLogActorDocument(req),
        'asociar curso-equipo capacitacion',
        `${codigoCurso} | ${existCurso.rows[0].nombre_curso} | equipos=${idsSet.length}`,
      ]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      ok: true,
      message: 'Asociación guardada exitosamente.',
      codigo_curso: codigoCurso,
      id_equipos: idsSet,
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* no-op */
    }
    console.error('[capacitacion-equipos:/asociar]', error);
    const code = String(error.code || '');
    const constraint = String(error.constraint || '');
    if (code === '23503') {
      if (constraint.includes('fk_equipo_especializado_equipo')) {
        return res.status(400).json({ ok: false, message: 'Uno o más equipos no existen.' });
      }
      if (constraint.includes('fk_equipo_especializado_curso')) {
        return res.status(400).json({ ok: false, message: 'El curso no existe.' });
      }
    }
    return res
      .status(400)
      .json({ ok: false, message: 'No se pudo guardar la asociación. Inténtelo nuevamente.' });
  } finally {
    client.release();
  }
});

router.post('/retirar', requireEquiposAccess, async function (req, res) {
  const codigoCurso = String(req.body?.codigo_curso || '').trim();
  const idEquipoRaw = req.body?.id_equipo;
  const idEquipo = Number.isFinite(Number(idEquipoRaw)) ? Number(idEquipoRaw) : NaN;
  if (!codigoCurso) {
    return res.status(400).json({ ok: false, message: 'codigo_curso es obligatorio.' });
  }
  if (!Number.isInteger(idEquipo) || idEquipo <= 0) {
    return res.status(400).json({ ok: false, message: 'id_equipo inválido.' });
  }

  try {
    const scope = await resolveLaboratoristaScope(req);
    const permiso = await assertCursoInScope(codigoCurso, scope);
    if (!permiso.allowed) {
      return res.status(403).json({ ok: false, message: permiso.reason });
    }

    const curso = await pool.query(
      'SELECT codigo_curso, nombre_curso FROM cursos WHERE codigo_curso = $1',
      [codigoCurso]
    );
    const equipo = await pool.query('SELECT id, nombre FROM equipo WHERE id = $1', [idEquipo]);

    const deleted = await pool.query(
      'DELETE FROM equipo_especializado WHERE codigo_curso = $1 AND id_equipo = $2 RETURNING codigo_curso, id_equipo',
      [codigoCurso, idEquipo]
    );
    if (deleted.rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Asociación no encontrada.' });
    }

    await pool.query(
      `INSERT INTO log (nombre, documento, accion, persona)
       VALUES ($1, $2, $3, $4)`,
      [
        getLogActorName(req),
        getLogActorDocument(req),
        'retirar curso-equipo capacitacion',
        `${codigoCurso} | ${curso.rows[0]?.nombre_curso || ''} | equipo=${idEquipo} ${equipo.rows[0]?.nombre || ''}`,
      ]
    );

    return res.status(200).json({ ok: true, message: 'Equipo retirado del curso.' });
  } catch (error) {
    console.error('[capacitacion-equipos:/retirar]', error);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo retirar el equipo. Inténtelo nuevamente.' });
  }
});

module.exports = router;
