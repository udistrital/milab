const express = require('express');

const pool = require('../../libs/db');
const { normalizeLogDocument } = require('../../libs/account-email');
const { requireJsonRoles } = require('../middlewares/auth');

const router = express.Router();

router.use(express.json({ limit: '256kb' }));
router.use(express.urlencoded({ extended: false, limit: '256kb' }));

const requireCursosRead = requireJsonRoles(['admin', 'laboratorista'], {
  message: 'No tiene permisos para consultar el catálogo de cursos.',
});
const requireCursosWrite = requireJsonRoles(['admin'], {
  message: 'Solo los administradores pueden crear, editar o eliminar cursos.',
});

function getLogActorDocument(req) {
  return normalizeLogDocument(req.session?.user?.documento);
}

function getLogActorName(req) {
  return String(req.session?.user?.tipo || '').trim() || 'admin';
}

function parseBooleanish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'on' || v === 'si' || v === 's' || v === 'yes';
  }
  return false;
}

function parseLaboratoriosIds(rawIds) {
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

function validateCursoPayload(body, { forEdit = false } = {}) {
  const errors = [];

  let codigoCurso = String(body.codigo_curso || '').trim();
  if (!codigoCurso) errors.push('El código del curso es obligatorio.');
  if (codigoCurso.length > 100) errors.push('El código del curso no puede superar 100 caracteres.');

  const idFacultadRaw = body.id_facultad;
  let idFacultad = Number.isFinite(Number(idFacultadRaw)) ? Number(idFacultadRaw) : NaN;
  if (!Number.isInteger(idFacultad) || idFacultad <= 0) errors.push('La facultad es obligatoria.');

  const nombreCurso = String(body.nombre_curso || '').trim();
  if (!nombreCurso) errors.push('El nombre del curso es obligatorio.');
  if (nombreCurso.length > 255) errors.push('El nombre del curso no puede superar 255 caracteres.');

  const urlEdx = String(body.url_edx || '').trim();
  if (!urlEdx) errors.push('La URL EDX es obligatoria.');
  if (urlEdx.length > 5000) errors.push('La URL EDX es demasiado larga.');
  if (urlEdx && !/^https?:\/\//i.test(urlEdx)) {
    errors.push('La URL EDX debe iniciar con http:// o https://.');
  }

  const activo = parseBooleanish(body.activo ?? true);

  const laboratoriosRawIds = parseLaboratoriosIds(
    body.id_laboratorios || body.laboratorios || body.id_laboratorio
  );
  const laboratoriosIds = laboratoriosRawIds
    .map((x) => {
      const n = Number(x);
      return Number.isInteger(n) && n > 0 ? n : NaN;
    })
    .filter((x) => !Number.isNaN(x));

  const laboratoriosSet = Array.from(new Set(laboratoriosIds));
  if (laboratoriosSet.length === 0) {
    errors.push('Debe seleccionar al menos un laboratorio asociado.');
  }

  if (!forEdit && !codigoCurso) {
    // ya agregado
  }

  return {
    errors,
    data: {
      codigoCurso,
      idFacultad,
      nombreCurso,
      urlEdx,
      activo,
      laboratoriosIds: laboratoriosSet,
    },
  };
}

function mapDbErrorToMessage(error, defaultMsg) {
  if (!error) return defaultMsg;
  const code = String(error.code || '');
  const constraint = String(error.constraint || '');
  const message = String(error.message || '');

  if (code === '23505') {
    if (constraint.includes('pk_cursos')) return 'Ya existe un curso con ese código (duplicado).';
    return `Registro duplicado: ${message || constraint}`;
  }
  if (code === '23503') {
    if (constraint.includes('fk_cursos_facultad')) return 'La facultad seleccionada no existe.';
    if (constraint.includes('fk_curso_laboratorio_laboratorio'))
      return 'Uno o más laboratorios seleccionados no existen.';
    return `Referencia inválida: ${message || constraint}`;
  }
  if (code === '23514') return `Validación fallida: ${message || constraint}`;
  if (code === 'P0001' || /no pertenece a la facultad/i.test(message)) {
    return message || 'Uno o más laboratorios no pertenecen a la facultad seleccionada.';
  }
  return defaultMsg;
}

router.get('/facultades', requireCursosRead, async function (req, res) {
  try {
    const result = await pool.query(
      'SELECT facultad_id, nombre FROM facultad WHERE activo = TRUE ORDER BY nombre ASC'
    );
    return res.status(200).json({ ok: true, facultades: result.rows });
  } catch (error) {
    console.error('[capacitacion-cursos:/facultades]', error);
    return res.status(500).json({ ok: false, message: 'Error al cargar facultades.' });
  }
});

router.get('/facultades/:id_facultad/laboratorios', requireCursosRead, async function (req, res) {
  const idFacultadRaw = req.params.id_facultad;
  const idFacultad = Number.isFinite(Number(idFacultadRaw)) ? Number(idFacultadRaw) : NaN;
  if (!Number.isInteger(idFacultad) || idFacultad <= 0) {
    return res.status(400).json({ ok: false, message: 'id_facultad inválido.' });
  }
  try {
    const facRes = await pool.query(
      'SELECT facultad_id, nombre FROM facultad WHERE facultad_id = $1 AND activo = TRUE',
      [idFacultad]
    );
    if (facRes.rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Facultad no existe o está inactiva.' });
    }
    const labs = await pool.query(
      `SELECT u.ual_id AS id_laboratorio,
              u.nombre,
              u.codigo_abreviacion,
              u.activo
       FROM ual u
       WHERE u.facultad_id = $1
         AND u.activo = TRUE
       ORDER BY u.nombre ASC`,
      [idFacultad]
    );
    return res.status(200).json({
      ok: true,
      facultad: facRes.rows[0],
      laboratorios: labs.rows,
    });
  } catch (error) {
    console.error('[capacitacion-cursos:/facultades/:id/laboratorios]', error);
    return res.status(500).json({ ok: false, message: 'Error al cargar laboratorios.' });
  }
});

router.get('/list', requireCursosRead, async function (req, res) {
  try {
    const result = await pool.query(
      `SELECT c.codigo_curso,
              c.id_facultad,
              f.nombre AS nombre_facultad,
              c.nombre_curso,
              c.url_edx,
              c.activo,
              c.fecha_creacion,
              c.fecha_modificacion,
              COALESCE(lab.count_labs, 0)::int AS cantidad_laboratorios,
              COALESCE(lab.nombres, '[]') AS laboratorios_nombres
       FROM cursos c
       JOIN facultad f ON f.facultad_id = c.id_facultad
       LEFT JOIN (
           SELECT cl.codigo_curso,
                  COUNT(*) AS count_labs,
                  json_agg(json_build_object(
                    'id_laboratorio', u.ual_id,
                    'nombre', u.nombre
                  ) ORDER BY u.nombre) AS nombres
           FROM curso_laboratorio cl
           JOIN ual u ON u.ual_id = cl.id_laboratorio
           WHERE cl.activo = TRUE
           GROUP BY cl.codigo_curso
       ) lab ON lab.codigo_curso = c.codigo_curso
       ORDER BY c.activo DESC, c.fecha_creacion DESC`
    );
    return res.status(200).json({ ok: true, cursos: result.rows });
  } catch (error) {
    console.error('[capacitacion-cursos:/list]', error);
    return res.status(500).json({ ok: false, message: 'Error al cargar listado de cursos.' });
  }
});

router.get('/detalle/:codigo_curso', requireCursosRead, async function (req, res) {
  const codigoCurso = String(req.params.codigo_curso || '').trim();
  if (!codigoCurso) {
    return res.status(400).json({ ok: false, message: 'codigo_curso inválido.' });
  }
  try {
    const cursoRes = await pool.query(
      `SELECT c.codigo_curso,
              c.id_facultad,
              f.nombre AS nombre_facultad,
              c.nombre_curso,
              c.url_edx,
              c.activo
       FROM cursos c
       JOIN facultad f ON f.facultad_id = c.id_facultad
       WHERE c.codigo_curso = $1`,
      [codigoCurso]
    );
    if (cursoRes.rows.length === 0) {
      return res.status(404).json({ ok: false, message: 'Curso no encontrado.' });
    }
    const labsRes = await pool.query(
      `SELECT cl.id_laboratorio AS id_laboratorio,
              u.nombre AS nombre,
              cl.activo
       FROM curso_laboratorio cl
       JOIN ual u ON u.ual_id = cl.id_laboratorio
       WHERE cl.codigo_curso = $1
       ORDER BY u.nombre ASC`,
      [codigoCurso]
    );
    return res.status(200).json({
      ok: true,
      curso: cursoRes.rows[0],
      laboratorios_asociados: labsRes.rows,
    });
  } catch (error) {
    console.error('[capacitacion-cursos:/detalle/:codigo_curso]', error);
    return res.status(500).json({ ok: false, message: 'Error al cargar detalle del curso.' });
  }
});

router.post('/nuevo', requireCursosWrite, async function (req, res) {
  const { errors, data } = validateCursoPayload(req.body, { forEdit: false });
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, message: 'Validaciones fallidas.', errors });
  }

  const { codigoCurso, idFacultad, nombreCurso, urlEdx, activo, laboratoriosIds } = data;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const facRes = await client.query(
      'SELECT nombre FROM facultad WHERE facultad_id = $1 AND activo = TRUE',
      [idFacultad]
    );
    if (facRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .json({ ok: false, message: 'La facultad seleccionada no existe o está inactiva.' });
    }

    const insertCurso = await client.query(
      `INSERT INTO cursos (codigo_curso, id_facultad, nombre_curso, url_edx, activo)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING codigo_curso, id_facultad, nombre_curso, url_edx, activo, fecha_creacion`,
      [codigoCurso, idFacultad, nombreCurso, urlEdx, activo]
    );

    for (const idLab of laboratoriosIds) {
      await client.query(
        `INSERT INTO curso_laboratorio (codigo_curso, id_laboratorio, activo)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (codigo_curso, id_laboratorio) DO UPDATE
           SET activo = TRUE,
               fecha_modificacion = CURRENT_TIMESTAMP`,
        [codigoCurso, idLab]
      );
    }

    await client.query(
      `INSERT INTO log (nombre, documento, accion, persona)
       VALUES ($1, $2, $3, $4)`,
      [
        getLogActorName(req),
        getLogActorDocument(req),
        'crear curso capacitacion',
        `${codigoCurso} | ${nombreCurso} | ${facRes.rows[0].nombre} | labs=${laboratoriosIds.length}`,
      ]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      ok: true,
      curso: insertCurso.rows[0],
      message: 'Curso creado exitosamente.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[capacitacion-cursos:/nuevo]', error);
    const msg = mapDbErrorToMessage(error, 'No se pudo crear el curso. Inténtelo nuevamente.');
    if (msg.includes('código') || msg.includes('duplicado')) {
      return res.status(409).json({ ok: false, message: msg });
    }
    return res.status(400).json({ ok: false, message: msg });
  } finally {
    client.release();
  }
});

router.post('/editar', requireCursosWrite, async function (req, res) {
  const codigoCursoOriginal = String(
    req.body.codigo_curso_original || req.body.codigo_curso || ''
  ).trim();
  if (!codigoCursoOriginal) {
    return res
      .status(400)
      .json({ ok: false, message: 'codigo_curso_original es obligatorio para editar.' });
  }
  const { errors, data } = validateCursoPayload(req.body, { forEdit: true });
  if (errors.length > 0) {
    return res.status(400).json({ ok: false, message: 'Validaciones fallidas.', errors });
  }

  const { codigoCurso, idFacultad, nombreCurso, urlEdx, activo, laboratoriosIds } = data;
  if (!codigoCurso) {
    return res
      .status(400)
      .json({ ok: false, message: 'El nuevo código del curso es obligatorio.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existRes = await client.query('SELECT codigo_curso FROM cursos WHERE codigo_curso = $1', [
      codigoCursoOriginal,
    ]);
    if (existRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, message: 'Curso original no encontrado.' });
    }

    const facRes = await client.query(
      'SELECT nombre FROM facultad WHERE facultad_id = $1 AND activo = TRUE',
      [idFacultad]
    );
    if (facRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .json({ ok: false, message: 'La facultad seleccionada no existe o está inactiva.' });
    }

    if (codigoCurso !== codigoCursoOriginal) {
      const dupRes = await client.query('SELECT codigo_curso FROM cursos WHERE codigo_curso = $1', [
        codigoCurso,
      ]);
      if (dupRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return res
          .status(409)
          .json({ ok: false, message: 'Ya existe un curso con ese nuevo código.' });
      }
    }

    const updateRes = await client.query(
      `UPDATE cursos
       SET codigo_curso = $1,
           id_facultad = $2,
           nombre_curso = $3,
           url_edx = $4,
           activo = $5,
           fecha_modificacion = CURRENT_TIMESTAMP
       WHERE codigo_curso = $6
       RETURNING codigo_curso, id_facultad, nombre_curso, url_edx, activo, fecha_modificacion`,
      [codigoCurso, idFacultad, nombreCurso, urlEdx, activo, codigoCursoOriginal]
    );

    await client.query('DELETE FROM curso_laboratorio WHERE codigo_curso = $1', [codigoCurso]);

    for (const idLab of laboratoriosIds) {
      await client.query(
        `INSERT INTO curso_laboratorio (codigo_curso, id_laboratorio, activo)
         VALUES ($1, $2, TRUE)`,
        [codigoCurso, idLab]
      );
    }

    await client.query(
      `INSERT INTO log (nombre, documento, accion, persona)
       VALUES ($1, $2, $3, $4)`,
      [
        getLogActorName(req),
        getLogActorDocument(req),
        'editar curso capacitacion',
        `${codigoCursoOriginal} -> ${codigoCurso} | ${nombreCurso} | labs=${laboratoriosIds.length}`,
      ]
    );

    await client.query('COMMIT');
    return res.status(200).json({
      ok: true,
      curso: updateRes.rows[0],
      message: 'Curso actualizado exitosamente.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[capacitacion-cursos:/editar]', error);
    const msg = mapDbErrorToMessage(error, 'No se pudo editar el curso. Inténtelo nuevamente.');
    if (msg.includes('código') || msg.includes('duplicado')) {
      return res.status(409).json({ ok: false, message: msg });
    }
    return res.status(400).json({ ok: false, message: msg });
  } finally {
    client.release();
  }
});

router.post('/cambiar-estado', requireCursosWrite, async function (req, res) {
  const codigoCurso = String(req.body.codigo_curso || '').trim();
  const activo = parseBooleanish(req.body.activo);
  if (!codigoCurso) {
    return res.status(400).json({ ok: false, message: 'codigo_curso inválido.' });
  }
  try {
    const exist = await pool.query(
      'SELECT codigo_curso, nombre_curso, activo FROM cursos WHERE codigo_curso = $1',
      [codigoCurso]
    );
    if (exist.rows.length === 0)
      return res.status(404).json({ ok: false, message: 'Curso no encontrado.' });
    const anterior = exist.rows[0];

    await pool.query(
      'UPDATE cursos SET activo = $1, fecha_modificacion = CURRENT_TIMESTAMP WHERE codigo_curso = $2',
      [activo, codigoCurso]
    );
    await pool.query(
      `INSERT INTO log (nombre, documento, accion, persona)
       VALUES ($1, $2, $3, $4)`,
      [
        getLogActorName(req),
        getLogActorDocument(req),
        activo ? 'activar curso capacitacion' : 'inactivar curso capacitacion',
        `${codigoCurso} | ${anterior.nombre_curso} | activo=${anterior.activo} -> ${activo}`,
      ]
    );
    return res
      .status(200)
      .json({ ok: true, message: `Curso ${activo ? 'activado' : 'inactivado'}.`, activo });
  } catch (error) {
    console.error('[capacitacion-cursos:/cambiar-estado]', error);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo actualizar el estado del curso.' });
  }
});

module.exports = router;
