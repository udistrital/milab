const { consultarCurso, consultarCursosUsuario, USE_MOCK } = require('./edx-cert-client');

/**
 * Consulta CERTIFICACIONES LOCALES VIGENTES del usuario (tabla certificacion_usuario).
 * Complementa EDX. Si existe activa + fecha_vencimiento > CURRENT_TIMESTAMP → OK vigente.
 *
 * @param {object} pool - conexión o cliente transaccional.
 * @param {string} documentoUsuario - documento (no codigo_usuario).
 * @returns {Promise<Map<string, object>>} Map<code_curso → certRow completo>.
 */
async function getCertificacionesLocalesVigentes(pool, documentoUsuario) {
  const doc = String(documentoUsuario || '').trim();
  const out = new Map();
  if (!doc) return out;
  try {
    const rs = await pool.query(
      `
      SELECT id,
             codigo_curso,
             usuario_documento,
             usuario_nombre,
             modalidad,
             fecha_emision,
             fecha_vencimiento,
             vigencia_meses,
             sesion_capacitacion_id AS sesion_id,
             solicitud_prestamo_id AS prestamo_solicitud_id,
             entrega_equipo_id,
             certificado_por_laboratorista_doc,
             certificado_por_laboratorista_nombre,
             notas,
             activo
        FROM certificacion_usuario
       WHERE usuario_documento = $1
         AND activo = TRUE
         AND fecha_vencimiento > CURRENT_TIMESTAMP
       ORDER BY fecha_vencimiento DESC
      `,
      [doc]
    );
    (rs.rows || []).forEach(function (r) {
      if (!out.has(String(r.codigo_curso || ''))) {
        out.set(String(r.codigo_curso || ''), r);
      }
    });
    return out;
  } catch {
    return out;
  }
}

/**
 * Consulta cursos ACTIVOS de capacitación asociados a un equipo.
 *
 * @param {object} pool - conexión o cliente transaccional.
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
 * Valida que el usuario haya completado TODOS los cursos activos del equipo.
 *
 * @param {object} opts
 * @param {object} opts.pool
 * @param {{id:number, documento?:string, nombre?:string}} opts.usuario - usuario en sesión.
 * @param {number|string} opts.idEquipo
 * @param {object} opts.ctxLogger
 * @param {function(string=): Promise<void>} opts.onErrorTecnico - hook para loguear en tabla `log`.
 * @returns {Promise<{permitir:true, cursos:Array}>}
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
  const origenPorCurso = new Map();
  let errorTecnicoGlobal = null;

  const localesVigentes = await getCertificacionesLocalesVigentes(pool, codigoUsuario);
  cursos.forEach(function (curso) {
    const certLocal = localesVigentes.get(String(curso.codigo_curso || ''));
    if (certLocal) {
      completadoPorCurso.set(String(curso.codigo_curso || ''), true);
      origenPorCurso.set(String(curso.codigo_curso || ''), {
        origen_completado: 'local_milab',
        modalidad_cert: certLocal.modalidad || null,
        fecha_emision: certLocal.fecha_emision || null,
        fecha_vencimiento: certLocal.fecha_vencimiento || null,
        certificado_por_laboratorista_doc: certLocal.certificado_por_laboratorista_doc || null,
        sesion_id: certLocal.sesion_id || null,
        prestamo_solicitud_id: certLocal.prestamo_solicitud_id || null,
      });
    }
  });

  const cursosSinLocal = cursos.filter(
    (c) => !completadoPorCurso.has(String(c.codigo_curso || ''))
  );

  if (cursosSinLocal.length) {
    try {
      const batch = await consultarCursosUsuario(codigoUsuario);
      (batch.cursos || []).forEach(function (c) {
        const key = String(c.codigo_curso || '');
        if (!completadoPorCurso.has(key)) {
          completadoPorCurso.set(key, Boolean(c.completado));
          if (c.completado) {
            origenPorCurso.set(key, { origen_completado: 'edx' });
          }
        }
      });
    } catch (batchErr) {
      errorTecnicoGlobal = batchErr;
    }
  }

  const pendientes = [];
  const erroresIndividuales = [];

  for (const curso of cursos) {
    const key = String(curso.codigo_curso || '');
    if (completadoPorCurso.has(key)) {
      if (!completadoPorCurso.get(key)) {
        pendientes.push(curso);
      }
      continue;
    }

    try {
      const individual = await consultarCurso(codigoUsuario, curso.codigo_curso);
      if (!individual.completado) {
        pendientes.push(curso);
      } else {
        origenPorCurso.set(key, { origen_completado: 'edx' });
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

  const cursosConDetalle = cursos.map(function (c) {
    const key = String(c.codigo_curso || '');
    const origen = origenPorCurso.get(key) || { origen_completado: null };
    return Object.assign({}, c, {
      completado: Boolean(completadoPorCurso.get(key) || false),
      origen_completado: origen.origen_completado || null,
      detalle_certificacion: origen.origen_completado ? origen : null,
    });
  });

  const cursosCompletados = cursosConDetalle.filter((c) => c.completado);
  const cursosPendientes = cursosConDetalle.filter((c) => !c.completado);

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
      cursos: cursosConDetalle,
      mensaje:
        'El servicio de certificación (EDX) no está disponible en este momento. No podemos confirmar que completaste la capacitación requerida, por lo que la reserva se bloquea por seguridad. Inténtalo más tarde; si el problema persiste, contacta al administrador.',
      causas: msgs,
      mock_en_uso: USE_MOCK,
      cursos_todos: cursosConDetalle,
      cursos_completados: cursosCompletados,
      cursos_pendientes: cursosPendientes,
    };
    throw bloqueo;
  }

  if (cursosPendientes.length) {
    const bloqueo = new Error(
      `Debes completar ${cursosPendientes.length} curso(s) de capacitación antes de reservar este equipo.`
    );
    bloqueo.bloqueoCert = {
      tipo: 'pendientes',
      cursos: cursosPendientes,
      mensaje:
        cursosPendientes.length === 1
          ? `Para reservar este equipo debes completar el curso de capacitación: ${cursosPendientes[0].nombre_curso}.`
          : `Para reservar este equipo debes completar los cursos: ${cursosPendientes.map((c) => '“' + c.nombre_curso + '”').join(', ')}.`,
      cursos_todos: cursosConDetalle,
      cursos_completados: cursosCompletados,
      cursos_pendientes: cursosPendientes,
    };
    throw bloqueo;
  }

  return {
    permitir: true,
    cursos: cursosCompletados,
    cursos_todos: cursosConDetalle,
    cursos_completados: cursosCompletados,
    cursos_pendientes: [],
  };
}

module.exports = {
  getCursosActivosDeEquipo,
  buildCodigoUsuarioEdx,
  getCertificacionesLocalesVigentes,
  validarCertificacionesParaReserva,
};
