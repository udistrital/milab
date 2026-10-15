const { renderApplicationError, wantsJson } = require('./error-handler');

function studentSearchLimit(req) {
  const searchType = String(req.body?.tipo_busqueda || req.query?.tipo_busqueda || '')
    .trim()
    .toLowerCase();
  return searchType === 'codigo' ? 19 : 50;
}

function validateBulkStudentQuery(value) {
  const entries = Array.isArray(value) ? value : [value];
  const oversizedDocument = entries
    .filter((entry) => typeof entry === 'string')
    .flatMap((entry) => entry.split(/[\s,;]+/))
    .map((document) => document.trim())
    .find((document) => document.length > 50);

  return oversizedDocument
    ? 'Cada documento o código de la consulta masiva debe tener máximo 50 caracteres.'
    : null;
}

const FORM_TEXT_LIMIT_RULES = [
  {
    methods: ['GET'],
    path: /^\/api\/admins\/load_info$/,
    fields: { documento: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/admins$/,
    fields: { nombre: 200, documento: 50, correo: 255 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/admin\/menus(?:\/update)?$/,
    fields: { label: 200, route: 200, icon: 100 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/admin\/roles\/(?:crear|[^/]+\/editar)$/,
    fields: { nombre: 40 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/admin\/sanciones\/(?:crear|[^/]+\/editar)$/,
    fields: { nombre: 150, descripcion: 500 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/facultad\/(?:add|editar)$/,
    fields: { nombre: 255 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/facultad\/ual\/(?:add|editar)$/,
    fields: {
      nombre: 255,
      codigo_abreviacion: 30,
      sal_id_espacio: 30,
      sal_ocupantes: 30,
      descripcion: 255,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/facultad\/ual\/asignar-dependencia$/,
    fields: { busqueda: 255, dependencia: 255 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/capacitacion-cursos\/(?:nuevo|editar)$/,
    fields: { codigo_curso: 100, nombre_curso: 255, url_edx: 5000 },
  },
  {
    methods: ['GET'],
    path: /^\/api\/capacitacion-equipos\/equipos\/search$/,
    fields: { q: 255 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/capacitacion-gestion\/solicitar$/,
    fields: {
      codigo_curso: 100,
      motivo: 500,
      mensaje: 1000,
      mensaje_solicitante: 1000,
      ual_id_solicitud: 10,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/capacitacion-gestion\/gestion\/sesiones\/programar$/,
    fields: {
      codigo_curso: 100,
      lugar: 255,
      ubicacion: 255,
      descripcion: 1000,
      detalle: 1000,
      enlace_sesion: 500,
      enlaceSesion: 500,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/capacitacion-gestion\/gestion\/asistencia\/marcar$/,
    fields: { documento: 50, usuario_documento: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/verificar_estudiante$/,
    fields: {
      valor_busqueda: { maxLength: studentSearchLimit },
      documento: 50,
      codigo: 19,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/get-data1$/,
    fields: { numero_documento_identificacion: 50, documento: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/(?:get-data|get-data2|get-data-docente)$/,
    fields: {
      valor_busqueda: 50,
      documento: 50,
      numero_documento_identificacion: 50,
      codigo: 19,
      con_codigo: 19,
      con_nombre: 500,
      con_documento: 50,
      con_estado: 50,
      con_carrera: 255,
      correo: 255,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/generate_cert_(?:docente|estudiante)_lab$/,
    fields: {
      numero_documento_identificacion: 50,
      con_nombre: 500,
      con_documento: 50,
      con_codigo: 19,
      con_estado: 50,
      con_carrera: 255,
      correo: 255,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/(?:submit|submit_docente)$/,
    fields: {
      ual_id: 10,
      obs_multa: 500,
      con_estado_multa: 50,
      con_nombre: 200,
      con_documento: 50,
      numero_documento_identificacion: 50,
      con_carrera: 100,
      con_estado: 20,
      con_codigo: 19,
      cod_multado: 19,
      codigo_referencia: 19,
      nombre_laboratorista: 100,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/quitar-multa$/,
    fields: { con_id: 10 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/consulta-invit$/,
    fields: { documento: 20 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/get_list_estudiantes\/consulta_masiva$/,
    fields: { consulta_masiva: 1038 },
    validate: (body) => validateBulkStudentQuery(body?.consulta_masiva),
  },
  {
    methods: ['POST'],
    path: /^\/api\/register(?:\/(?:email_verification|enviar-codigo|create_account))?$/,
    fields: {
      nombre: 200,
      documento: 50,
      codigo: 19,
      con_nombre: 200,
      con_documento: 50,
      numero_documento_identificacion: 50,
      con_codigo: 19,
      con_estado: 20,
      con_carrera: 100,
      con_estado_multa: 50,
      cod_multado: 19,
      correo: 255,
      email: 255,
      password: 255,
      confirmar_password: 255,
    },
  },
  {
    methods: ['GET'],
    path: /^\/api\/register_labs\/load_info$/,
    fields: { documento: 50, coordinador_documento_lookup: 255, ualSearch: 255 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/register_labs$/,
    fields: {
      nombre: 100,
      documento: 50,
      n_usuario: 50,
      contrato: 50,
      correo: 50,
      coordinador_documento: 50,
      coordinador_documento_display: 255,
      soporte_contrato: 1000,
      ualSearch: 255,
    },
  },
  {
    methods: ['GET'],
    path: /^\/api\/register_monitor\/load_info$/,
    fields: { documento: 50, coordinador_documento_lookup: 255 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/register_monitor$/,
    fields: {
      nombre: 255,
      documento: 50,
      codigo: 19,
      programa: 255,
      correo: 255,
      numero_contrato: 100,
      tipo_vinculacion: 100,
      soporte_contrato: 1000,
      coordinador_documento: 50,
      coordinador_documento_display: 255,
    },
  },
  {
    methods: ['GET'],
    path: /^\/api\/registro_coordinador\/load_info$/,
    fields: { documento: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/registro_coordinador$/,
    fields: {
      nombre: 255,
      documento: 50,
      correo: 255,
      numero_resolucion_coordinador: 100,
      soporte_resolucion: 1000,
      dependenciasSearch: 255,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/laboratoristas_registrados\/editar$/,
    fields: { documento: 50, n_usuario: 50, nombre: 100, contrato: 50, correo: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/(?:laboratoristas_registrados|coordinadores_registrados|monitores_registrados)\/(?:actualizar|actualizar-correo)$/,
    fields: {
      documento: 50,
      nombre: 255,
      coordinadorEditorCurrent: 255,
      correo: 255,
      email: 255,
      n_usuario: 50,
      emailEditorCurrent: 255,
      emailEditorDocument: 50,
      numero_resolucion_coordinador: 100,
      soporte_resolucion: 1000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/profile(?:\/identify)?$/,
    fields: {
      nombre: 200,
      correo: 255,
      email: 255,
      documento: 50,
      codigo: 19,
      estado: 20,
      carrera: 100,
      tipo_usuario: 40,
    },
  },
  {
    methods: ['POST'],
    path: /^\/api\/sanciones\/(?:mis-sanciones\/)?[^/]+\/(?:reclamar|reclamacion)$/,
    fields: { texto: 500 },
  },
  {
    methods: ['POST'],
    path: /^\/api\/sanciones\/reclamaciones\/[^/]+\/responder$/,
    fields: { respuesta: 500 },
  },
  {
    methods: ['POST'],
    path: /^\/auth\/dev-login$/,
    fields: { correo: 255, password: 255 },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/equipos\/(?:crear|[^/]+\/editar)$/,
    fields: {
      codigo: 50,
      nombre: 255,
      descripcion: 2000,
      categoria: 100,
      laboratorio: 100,
      facultad: 100,
      area_conocimiento: 100,
      estado: 50,
      ubicacion: 255,
      marca: 2000,
      modelo: 2000,
      serie_equipo: 2000,
      detalles_tecnicos: 2000,
      codigo_curso_asociado: 100,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/inventario\/(?:crear|[^/]+\/editar)$/,
    fields: {
      serie: 100,
      placa: 100,
      nombre_bien: 1000,
      grupo_inventario: 100,
      nivel_inventario: 50,
      funcionario_doc: 50,
      nombre_funcionario: 255,
      sede: 100,
      dependencia: 100,
      espacio_fisico: 100,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/solicitudes\/crear$/,
    fields: {
      justificacion: 2000,
      justificacion_academica: 2000,
      solicitudSignatureText: 255,
      categoria_practica: 20,
      formato_archivo: 100,
      formato_payload: { maxLength: 2000, deep: true, parseJson: true },
      formatoPayload: { maxLength: 2000, deep: true, parseJson: true },
      pdf_fecha: 10,
      pdf_cod_equipo: 50,
      pdf_clase_equipo: 255,
      pdf_nombre: 200,
      pdf_celular: 20,
      pdf_proyecto: 255,
      pdf_salon: 150,
      pdf_hora_salida: 5,
      pdf_hora_entrega: 5,
      pdf_observaciones: 2000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/gestion-solicitudes\/[^/]+\/rechazar$/,
    fields: { motivo_rechazo: 1000, motivoRechazo: 1000 },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/cola\/prestamos\/[^/]+\/asignar-ultima-hora$/,
    fields: { documento: 50, ultimaHoraDocumento: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/entrega-equipos\/[^/]+\/(?:marcar-prestado|ultima-hora|recibir|incidencia)$/,
    fields: {
      documento: 50,
      ultimaHoraDocumento: 50,
      condicion_entrega: 2000,
      entregaCondicion: 2000,
      condicion_devolucion: 2000,
      devolucionCondicion: 2000,
      lista_componentes: { maxLength: 2000, deep: true, parseJson: true },
      devolucionComponentes: 2000,
      descripcion: 2000,
      incidenciaDescripcion: 2000,
      tipo: 120,
      tipo_incidencia: 120,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/incidencias\/[^/]+\/(?:pendiente-cierre|aprobar|solucionar|convertir-bloqueo)$/,
    fields: {
      justificacion: 2000,
      detalle: 2000,
      descripcion: 2000,
      texto: 2000,
      convertirBloqueoJustificacion: 2000,
      pazYSalvoJustificacion: 2000,
      paz_y_salvo_decision_justificacion: 2000,
      aprobarSancionDetalle: 2000,
      sancion_detalle: 2000,
      cerrarIncidenciaDescripcion: 2000,
      descripcion_cierre: 2000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/(?:practicas\/reservar|practicas\/[^/]+\/reenviar)$/,
    fields: {
      justificacion: 2000,
      tipo_practica: 20,
      asignatura_codigo: 80,
      asignatura_nombre: 255,
      codigo: 80,
      nombre: 255,
      laboratorio: 150,
      facultad: 150,
      documento: 50,
      codigo_estudiante: 19,
      practicaSignatureText: 255,
      formato_archivo: 100,
      formato_payload: { maxLength: 2000, deep: true, parseJson: true },
      formatoPayload: { maxLength: 2000, deep: true, parseJson: true },
      detalle_practica_json: { maxLength: 2000, deep: true, parseJson: true },
      detallePracticaJson: { maxLength: 2000, deep: true, parseJson: true },
      pdf_fecha: 10,
      pdf_cod_equipo: 50,
      pdf_clase_equipo: 255,
      pdf_nombre: 200,
      pdf_celular: 20,
      pdf_proyecto: 255,
      pdf_salon: 150,
      pdf_hora_salida: 5,
      pdf_hora_entrega: 5,
      pdf_observaciones: 2000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/formatos\/audiovisuales\/fill$/,
    fields: {
      formato_payload: { maxLength: 2000, deep: true, parseJson: true },
      fecha: 10,
      codigo_equipo: 50,
      cod_equipo: 50,
      clase_equipo: 255,
      nombre: 200,
      celular: 20,
      proyecto: 255,
      salon: 150,
      hora_salida: 5,
      hora_entrega: 5,
      observaciones: 2000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/practicas\/[^/]+\/(?:ultima-hora|asignar-ultima-hora)$/,
    fields: { documento: 50, ultimaHoraPracticaDocumento: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/cola\/practicas\/[^/]+\/asignar-ultima-hora$/,
    fields: { documento: 50, ultimaHoraPracticaDocumento: 50 },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/practicas\/[^/]+\/(?:rechazar|comentarios)$/,
    fields: {
      motivo: 1000,
      motivo_rechazo: 1000,
      comentarios: 1000,
      comentario: 1000,
      texto: 1000,
      rechazoPracticaMotivo: 1000,
      comentariosPracticaTexto: 1000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/practicas\/[^/]+\/(?:incidencia|reportar-incidencia)$/,
    fields: {
      tipo: 120,
      tipo_incidencia: 120,
      incidencia_tipo: 120,
      incidenciaDocenteTipo: 120,
      descripcion: 2000,
      incidenciaDocenteDescripcion: 2000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/practicas\/[^/]+\/completar$/,
    fields: {
      incidencia_tipo: 120,
      incidenciaTipo: 120,
      tipo_incidencia: 120,
      incidencia_descripcion: 2000,
      incidenciaDescripcion: 2000,
      descripcion_incidencia: 2000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/coordinador\/practicas\/(?:config|config\/schema|catalogo)$/,
    fields: {
      nombre: 255,
      tipo_practica: 120,
      descripcion: 2000,
      recomendaciones: { maxLength: 2000, deep: true, parseJson: true },
      observaciones: { maxLength: 2000, deep: true, parseJson: true },
      insumos: { maxLength: 2000, deep: true, parseJson: true },
      equipos: { maxLength: 2000, deep: true, parseJson: true },
      competencias: { maxLength: 2000, deep: true, parseJson: true },
      guias: { maxLength: 2000, deep: true, parseJson: true },
      seguridad: { maxLength: 2000, deep: true, parseJson: true },
      evaluacion: { maxLength: 2000, deep: true, parseJson: true },
      schema_json: { maxLength: 2000, deep: true, parseJson: true },
      schemaJson: { maxLength: 2000, deep: true, parseJson: true },
      configuracion_json: { maxLength: 2000, deep: true, parseJson: true },
      campos_adicionales: { maxLength: 2000, deep: true, parseJson: true },
      schemaFieldName: 255,
      schemaFieldOptions: 2000,
      schemaFieldPlaceholder: 255,
      schemaFieldHelp: 2000,
      key: 255,
      placeholder: 255,
      ayuda: 2000,
      valores: { maxLength: 2000, deep: true, parseJson: true },
      codigo: 80,
      asignatura_codigo: 80,
      asignatura_nombre: 255,
      enlace: 2000,
      url: 2000,
    },
  },
  {
    methods: ['POST'],
    path: /^\/prestamos\/salas(?:\/[^/]+)?$/,
    fields: {
      nombre: 150,
      tipo_espacio: 30,
      formato_practica_libre: 80,
      formato_practica_docente: 80,
      descripcion: 2000,
      equipos_nombres: 2500,
    },
  },
  {
    methods: ['POST'],
    path: /^\/inventarios\/(?:individual|registros\/[^/]+\/editar)$/,
    fields: {
      descripcion: 1000,
      placa: 100,
      serie: 100,
      marca: 255,
      modelo: 255,
      proveedor: 255,
      referencia: 255,
      unidad: 50,
      codigo_interno: 255,
      identificador_id: 255,
      codigo_barras: 255,
      qr: 255,
      placa_local: 255,
      etiquetado: 255,
      espacio_fisico: 255,
      observaciones: 2000,
      unidad_stock_gt: 50,
      unidad_stock_ra: 50,
      unidad_circulacion_gt: 50,
      unidad_circulacion_ra: 50,
      identificadores_adicionales: { maxLength: 255, deep: true, parseJson: true },
    },
  },
  {
    methods: ['POST'],
    path: /^\/inventarios\/aprobaciones\/[^/]+\/resolver$/,
    fields: { comentario: 2000 },
  },
];

function normalizeRequestPath(req) {
  const rawUrl = req.originalUrl || req.url || req.path || '/';
  const pathname = String(rawUrl).split('?')[0] || '/';
  const normalized = pathname.replace(/^\/(?:milab|pazysalvos)(?=\/|$)/, '') || '/';
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
}

function resolveFieldRule(rule, req) {
  if (typeof rule === 'function') {
    return { maxLength: rule(req) };
  }
  if (typeof rule === 'number') {
    return { maxLength: rule };
  }

  return {
    ...rule,
    maxLength: typeof rule?.maxLength === 'function' ? rule.maxLength(req) : rule?.maxLength,
  };
}

function findTooLongText(value, maxLength, deep, parseJson, fieldPath) {
  if (typeof value === 'string') {
    if (parseJson) {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object') {
          return findTooLongText(parsed, maxLength, true, false, fieldPath);
        }
      } catch {
        // Invalid JSON remains subject to the field's ordinary string limit.
      }
    }

    return value.length > maxLength ? fieldPath : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).length > maxLength ? fieldPath : null;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const tooLongPath = findTooLongText(
        value[index],
        maxLength,
        deep,
        parseJson,
        `${fieldPath}[${index}]`
      );
      if (tooLongPath) {
        return tooLongPath;
      }
    }
    return null;
  }

  if (!deep || !value || typeof value !== 'object') {
    return null;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const overlongField = findTooLongText(
      nestedValue,
      maxLength,
      true,
      parseJson,
      `${fieldPath}.${key}`
    );
    if (overlongField) {
      return overlongField;
    }
  }

  return null;
}

function findFieldValue(source, fieldName, fieldRule, sourceName, req) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const resolvedRule = resolveFieldRule(fieldRule, req);
  const maxLength = resolvedRule?.maxLength;

  if (!Number.isInteger(maxLength) || maxLength < 0) {
    return null;
  }

  const visit = (value, path) => {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        const result = visit(value[index], `${path}[${index}]`);
        if (result) return result;
      }
      return null;
    }

    if (!value || typeof value !== 'object') {
      return null;
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      const fieldPath = `${path}.${key}`;
      if (key === fieldName) {
        const tooLongPath = findTooLongText(
          nestedValue,
          maxLength,
          resolvedRule.deep === true,
          resolvedRule.parseJson === true,
          fieldPath,
          resolvedRule.maxSerializedLength
        );
        if (tooLongPath) {
          return tooLongPath;
        }
      }

      const nestedResult = visit(nestedValue, fieldPath);
      if (nestedResult) {
        return nestedResult;
      }
    }

    return null;
  };

  return visit(source, sourceName);
}

function getMatchingRule(req, rules = FORM_TEXT_LIMIT_RULES) {
  const method = String(req.method || '').toUpperCase();
  const requestPath = normalizeRequestPath(req);

  return rules.find((rule) => rule.methods.includes(method) && rule.path.test(requestPath));
}

function requestExpectsJson(req) {
  return (
    wantsJson(req) ||
    Boolean(req.is?.('application/json')) ||
    Boolean(req.is?.('application/*+json'))
  );
}

function respondWithTextLimitError(req, res, fieldPath, maxLength) {
  const message = 'Formulario no válido';
  const message2 = `El campo ${fieldPath} supera el máximo permitido de ${maxLength} caracteres.`;

  if (requestExpectsJson(req)) {
    return res.status(400).json({
      ok: false,
      success: false,
      message,
      message2,
    });
  }

  return renderApplicationError(res, { status: 400, message, message2 }, req);
}

function validateFormTextLengths(req, res, next) {
  const rule = getMatchingRule(req);
  if (!rule) {
    return next();
  }

  for (const source of [
    ['body', req.body],
    ['query', req.query],
  ]) {
    const [sourceName, values] = source;
    for (const [fieldName, fieldRule] of Object.entries(rule.fields || {})) {
      const fieldPath = findFieldValue(values, fieldName, fieldRule, sourceName, req);
      if (fieldPath) {
        const resolvedRule = resolveFieldRule(fieldRule, req);
        return respondWithTextLimitError(req, res, fieldPath, resolvedRule.maxLength);
      }
    }
  }

  if (typeof rule.validate === 'function') {
    const validationMessage = rule.validate(req.body || {}, req.query || {});
    if (validationMessage) {
      if (requestExpectsJson(req)) {
        return res.status(400).json({
          ok: false,
          success: false,
          message: 'Formulario no válido',
          message2: validationMessage,
        });
      }
      return renderApplicationError(
        res,
        { status: 400, message: 'Formulario no válido', message2: validationMessage },
        req
      );
    }
  }

  return next();
}

module.exports = {
  FORM_TEXT_LIMIT_RULES,
  normalizeRequestPath,
  validateFormTextLengths,
};
