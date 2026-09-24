
const { consultarCurso, consultarCursosUsuario, USE_MOCK } = require('./edx-cert-client');


 * @param {import('pg').Pool | import('pg').PoolClient} pool - conexión o cliente transaccional.
 * @param {number|string} idEquipo - PK equipo.id.
 * @returns {Promise<Array<{codigo_curso:string, nombre_curso:string, url_edx:string}>>}
 */
async function getCursosActivosDeEquipo(pool, idEquipo) {
  const id = Number(idEquipo);
  if (!Number.isInteger(id) || id <= 0) return [];
  const rs = await pool.query(
    `
      SELECT c.codigo_curso, c.nombre_curso, c.url_edx
      FROM equipo_especializado ee
      JOIN cursos c ON c.codigo_curso = ee.codigo_curso
      WHERE ee.id_equipo = $1
        AND ee.activo = TRUE
        AND c.activo = TRUE
      ORDER BY c.nombre_curso ASC, c.codigo_curso ASC
    `,
    [id]
  );
  return rs.rows || [];
}


function buildCodigoUsuarioEdx(usuario) {
  if (!usuario) return '';
  const raw = usuario.documento || usuario.codigo_usuario || usuario.codigo || '';
  return String(raw || '').trim();
}

/**
 *
 * @param {object} opts
 * @param {import('pg').Pool | import('pg').PoolClient} opts.pool
 * @param {{id:number, documento?:string, nombre?:string}} opts.usuario - usuario en sesión.
 * @param {number|string} opts.idEquipo
 * @param {object} opts.ctxLogger
 * @param {(msg:string, extra?:object) => Promise<void>} opts.onErrorTecnico - hook para loguear en tabla `log`.
 * @returns {Promise<{permitir:true, cursos:Array}>}
 * @throws {Error & {bloqueoCert: object}} Cuando se debe bloquear la reserva.
 */
async function validarCertificacionesParaReserva({ pool, usuario, idEquipo, onErrorTecnico }) {
  const cursos = await getCursosActivosDeEquipo(pool, idEquipo);

  if (!cursos.length) {
    return { permitir: true, cursos: [] };
  }

  const codigoUsuario = buildCodigoUsuarioEdx(usuario);
  if (!codigoUsuario) {
    const err = new Error(
      'No se pudo identificar el documento del usuario para consultar sus certificaciones.'
    );
    err.bloqueoCert = {
      tipo: 'error_tecnico',
      cursos,
      mensaje:
        'No fue posible consultar las certificaciones requeridas (documento de usuario no disponible). Inténtelo nuevamente o contacte al administrador.',
      causas: ['usuario_sin_documento'],
    };
    if (typeof onErrorTecnico === 'function') {
      try {
        await onErrorTecnico(
          `[CAP-CERT-BLOQUEO] usuario sin documento. idEquipo=${idEquipo} cursosRequeridos=${cursos.map((c) => c.codigo_curso).join(',')}`
        );
      } catch {
        /* no-op */
      }
    }
    throw err;
  }

  const completadoPorCurso = new Map();
  let errorTecnicoGlobal = null;

  try {
    const batch = await consultarCursosUsuario(codigoUsuario);
    (batch.cursos || []).forEach(function (c) {
      completadoPorCurso.set(String(c.codigo_curso || ''), Boolean(c.completado));
    });
  } catch (batchErr) {
    errorTecnicoGlobal = batchErr;
  }

  const pendientes = [];
  const erroresIndividuales = [];

  for (const curso of cursos) {
    if (completadoPorCurso.has(curso.codigo_curso)) {
      if (!completadoPorCurso.get(curso.codigo_curso)) {
        pendientes.push(curso);
      }
      continue;
    }

    try {
      const individual = await consultarCurso(codigoUsuario, curso.codigo_curso);
      if (!individual.completado) {
        pendientes.push(curso);
      }
    } catch (individualErr) {
      erroresIndividuales.push({
        codigo_curso: curso.codigo_curso,
        message: individualErr.message,
      });
      if (typeof onErrorTecnico === 'function') {
        try {
          await onErrorTecnico(
            `[CAP-CERT] Error EDX consultando curso=${curso.codigo_curso} usuario=${codigoUsuario}: ${individualErr.message}`
          );
        } catch {
          /* no-op */
        }
      }
    }
  }

  const hayErrorTecnico = Boolean(errorTecnicoGlobal || erroresIndividuales.length);

  if (hayErrorTecnico) {
    const msgs = [];
    if (errorTecnicoGlobal) msgs.push('Batch: ' + errorTecnicoGlobal.message);
    erroresIndividuales.forEach(function (e) {
      msgs.push(`[${e.codigo_curso}] ${e.message}`);
    });

    if (typeof onErrorTecnico === 'function') {
      try {
        await onErrorTecnico(
          `[CAP-CERT-BLOQUEO] Error servicio EDX. idEquipo=${idEquipo} usuario=${codigoUsuario} detalles=${msgs.join(' || ')}`
        );
      } catch {
        /* no-op */
      }
    }

    const bloqueo = new Error(
      'No se pudo consultar el servicio de certificaciones. La reserva se bloquea por seguridad hasta que el servicio esté disponible.'
    );
    bloqueo.bloqueoCert = {
      tipo: 'error_tecnico',
      cursos,
      mensaje:
        'El servicio de certificación (EDX) no está disponible en este momento. No podemos confirmar que completaste la capacitación requerida, por lo que la reserva se bloquea por seguridad. Inténtalo más tarde; si el problema persiste, contacta al administrador.',
      causas: msgs,
      mock_en_uso: USE_MOCK,
    };
    throw bloqueo;
  }

  if (pendientes.length) {
    const bloqueo = new Error(
      `Debes completar ${pendientes.length} curso(s) de capacitación antes de reservar este equipo.`
    );
    bloqueo.bloqueoCert = {
      tipo: 'pendientes',
      cursos: pendientes,
      mensaje:
        pendientes.length === 1
          ? `Para reservar este equipo debes completar el curso de capacitación: ${pendientes[0].nombre_curso}.`
          : `Para reservar este equipo debes completar los cursos: ${pendientes.map((c) => '“' + c.nombre_curso + '”').join(', ')}.`,
      cursos_todos: cursos,
    };
    throw bloqueo;
  }

  return { permitir: true, cursos };
}

module.exports = {
  getCursosActivosDeEquipo,
  buildCodigoUsuarioEdx,
  validarCertificacionesParaReserva,
};
