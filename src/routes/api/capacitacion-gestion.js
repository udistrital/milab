const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { requireJsonRoles } = require('../middlewares/auth');
const pool = require('../../libs/db');
const { resolveLaboratoristaScope } = require('../../libs/capacitacion-scope');
const { sendEmailNotification } = require('../../libs/email-notifications');

const router = express.Router();

router.use(express.json({ limit: '256kb' }));
router.use(express.urlencoded({ extended: false, limit: '256kb' }));

const CAPACITACION_SCHEMA_MISSING_MESSAGE =
  'Falta aplicar la migración del módulo de Capacitación en la base de datos. ' +
  'Ejecutar el script sql-scripts/db_structure_certificacion.sql para crear ' +
  'las tablas solicitud_capacitacion, sesion_capacitacion, inscripcion_sesion_capacitacion, ' +
  'asistencia_capacitacion y certificacion_usuario.';

const SOLICITUD_ESTADOS = new Set(['pendiente', 'notificado', 'atendido', 'cancelado']);
const SESION_ESTADOS = new Set(['programada', 'en_curso', 'realizada', 'cancelada']);
const INSCRIPCION_ESTADOS = new Set(['inscrito', 'cancelado', 'cupo_excedido']);
const ASISTENCIA_METODOS = new Set(['manual', 'qr_documento', 'lista_asistencia']);

const ESTUDIANTE_DOCENTE_ROLES = [
  'estudiante',
  'alumno',
  'docente',
  'profesor',
  'profesora',
  'docente_ocacional',
];

const LAB_ADMIN_ROLES = [
  'admin',
  'administrador',
  'administradora',
  'coordinador_general',
  'coordinador general',
  'coordinador',
  'laboratorista',
  'laboratorista_ud',
  'laboratorista_ual',
];

const requireEstudianteODocente = requireJsonRoles(ESTUDIANTE_DOCENTE_ROLES, {
  message:
    'Debe iniciar sesión como estudiante o docente para realizar esta acción de capacitación.',
});

const requireLaboratoristaOAdmin = requireJsonRoles(LAB_ADMIN_ROLES, {
  message:
    'No tiene permisos para gestionar capacitaciones (solo administrador, coordinación o laboratorista).',
});

function isGestionSchemaMissingError(error) {
  if (!error) return false;
  if (error.code === '42P01') {
    const msg = String(error.message || '').toLowerCase();
    return (
      msg.includes('solicitud_capacitacion') ||
      msg.includes('sesion_capacitacion') ||
      msg.includes('inscripcion_sesion_capacitacion') ||
      msg.includes('asistencia_capacitacion') ||
      msg.includes('certificacion_usuario')
    );
  }
  return false;
}

function handleSchemaMissing(res, error) {
  if (isGestionSchemaMissingError(error)) {
    return res.status(503).json({
      ok: false,
      migration_faltante: true,
      message: CAPACITACION_SCHEMA_MISSING_MESSAGE,
      script_requerido: 'sql-scripts/db_structure_certificacion.sql',
    });
  }
  return null;
}

function okJson(res, data, status = 200) {
  setCacheDynamic(res);
  return res.status(status).json(Object.assign({ ok: true }, data || {}));
}

function setCacheDynamic(res) {
  try {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, private, proxy-revalidate'
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  } catch {
    /* ignore if headers already sent */
  }
}

router.use(function setCapacitacionGestionNoCache(req, res, next) {
  setCacheDynamic(res);
  next();
});

function badRequest(res, message, details) {
  setCacheDynamic(res);
  const body = { ok: false, message };
  if (details) body.details = details;
  return res.status(400).json(body);
}

function forbidden(res, message) {
  setCacheDynamic(res);
  return res.status(403).json({ ok: false, message });
}

function notFound(res, message) {
  setCacheDynamic(res);
  return res.status(404).json({ ok: false, message });
}

function serverError(res, error, fallbackMessage) {
  setCacheDynamic(res);
  const schemaResp = handleSchemaMissing(res, error);
  if (schemaResp) return schemaResp;
  const body = {
    ok: false,
    message: fallbackMessage || 'Ocurrió un error interno al procesar la solicitud.',
  };
  if (error && typeof error === 'object') {
    body.details = {
      name: error.name || null,
      message: error.message || null,
      code: error.code || null,
    };
  }
  return res.status(500).json(body);
}

function getSessionDocument(req) {
  const doc =
    req?.session?.user?.documento_real ||
    req?.session?.user?.documento ||
    req?.session?.user?.codigo ||
    req?.session?.user?.id_documento ||
    null;
  return doc ? String(doc).trim() : '';
}

function getSessionUserId(req) {
  const id = Number(req?.session?.user?.id);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getSessionUserNombre(req) {
  return String(req?.session?.user?.tipo || req?.session?.user?.nombre || '').trim() || null;
}

function parsePosInt(raw, fieldName) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(fieldName + ' debe ser un número entero positivo.');
  }
  return n;
}

function truncate(s, n) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  return str.length > n ? str.substring(0, n) : str;
}

async function fetchActiveSanctionsCount(usuarioId) {
  if (!usuarioId) return 0;
  try {
    const result = await pool.query(
      `
      SELECT COUNT(*)::int AS total
        FROM multa
       WHERE usuario_sancionado_id = $1
         AND activo = TRUE
         AND UPPER(COALESCE(con_estado_multa, '')) IN ('ACTIVA', 'PENDIENTE', 'POR SALDAR')
      `,
      [usuarioId]
    );
    return Number(result.rows[0]?.total || 0);
  } catch {
    return 0;
  }
}

async function assertUsuarioSinSancionesActivas(req, res) {
  const uid = getSessionUserId(req);
  const total = await fetchActiveSanctionsCount(uid);
  if (total > 0) {
    return forbidden(
      res,
      'Tienes sanciones activas y no puedes solicitar ni inscribirte a capacitaciones por ahora. Regulariza tu situación con el administrador.'
    );
  }
  return null;
}

function scopeUalIdList(scope, fallbackAll = false) {
  if (scope.isAdmin) return fallbackAll ? null : [];
  return scope.ualIds && scope.ualIds.length ? scope.ualIds.slice() : [];
}

function scopeFacultyIdList(scope, fallbackAll = false) {
  if (scope.isAdmin) return fallbackAll ? null : [];
  return scope.facultyIds && scope.facultyIds.length ? scope.facultyIds.slice() : [];
}

/* ============================================================
   1. SOLICITUDES DE CAPACITACIÓN
   ============================================================ */

router.post('/solicitar', requireEstudianteODocente, async function (req, res) {
  try {
    const bloqueoSanciones = await assertUsuarioSinSancionesActivas(req, res);
    if (bloqueoSanciones) return bloqueoSanciones;

    const doc = getSessionDocument(req);
    const uid = getSessionUserId(req);
    if (!doc) return badRequest(res, 'No se pudo identificar el documento del usuario.');
    if (!uid) return badRequest(res, 'Usuario de sesión inválido (falta id).');

    const codigoCurso = truncate(req.body?.codigo_curso, 80);
    const motivo = truncate(req.body?.motivo, 500);
    const mensajeSolicitante = truncate(req.body?.mensaje || req.body?.mensaje_solicitante, 1000);
    const ualIdRaw = req.body?.ual_id_solicitud;
    const ualId =
      ualIdRaw != null && ualIdRaw !== '' ? parsePosInt(ualIdRaw, 'ual_id_solicitud') : null;
    if (!codigoCurso) return badRequest(res, 'El campo codigo_curso es obligatorio.');

    const cursoCheck = await pool.query(
      `SELECT codigo_curso, nombre_curso, id_facultad FROM cursos WHERE codigo_curso = $1 AND activo = TRUE LIMIT 1`,
      [codigoCurso]
    );
    if (cursoCheck.rows.length === 0) {
      return notFound(res, 'El curso especificado no existe o está inactivo.');
    }
    const curso = cursoCheck.rows[0];

    const pendienteCheck = await pool.query(
      `SELECT 1 AS ok FROM solicitud_capacitacion
        WHERE solicitante_documento = $1
          AND codigo_curso = $2
          AND estado = 'pendiente'
        LIMIT 1`,
      [doc, codigoCurso]
    );
    if (pendienteCheck.rows.length > 0) {
      return res.status(409).json({
        ok: false,
        message:
          'Ya tienes una solicitud pendiente para este curso. Por favor espera a que el laboratorista programe una capacitación.',
      });
    }

    const insert = await pool.query(
      `
      INSERT INTO solicitud_capacitacion (
        solicitante_documento,
        solicitante_usuario_id,
        solicitante_nombre,
        codigo_curso,
        nombre_curso_snapshot,
        facultad_id,
        ual_id,
        motivo,
        mensaje_solicitante,
        estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pendiente')
      RETURNING id, codigo_curso, nombre_curso_snapshot, estado, fecha_creacion,
                ual_id AS ual_id_solicitud
      `,
      [
        doc,
        uid,
        getSessionUserNombre(req),
        codigoCurso,
        truncate(curso.nombre_curso, 255),
        curso.id_facultad || null,
        ualId,
        motivo,
        mensajeSolicitante,
      ]
    );

    return okJson(
      res,
      {
        solicitud: insert.rows[0],
        message:
          'Solicitud enviada exitosamente. El laboratorista asignado a la facultad recibirá una notificación y programará una sesión.',
      },
      201
    );
  } catch (err) {
    return serverError(res, err, 'Ocurrió un error al registrar la solicitud de capacitación.');
  }
});

router.get('/mis-solicitudes', requireEstudianteODocente, async function (req, res) {
  try {
    const doc = getSessionDocument(req);
    if (!doc) return badRequest(res, 'Sesión sin documento de usuario.');
    const estadoRaw =
      String(req.query?.estado || '')
        .trim()
        .toLowerCase() || null;
    const estadoValido = estadoRaw && SOLICITUD_ESTADOS.has(estadoRaw) ? estadoRaw : null;

    const sql = [
      `SELECT id, solicitante_documento, codigo_curso, nombre_curso_snapshot, facultad_id, motivo, estado, observaciones_laboratorista, notas_internas, fecha_creacion, fecha_modificacion, ual_id AS ual_id_solicitud, sesion_capacitacion_id AS id_sesion_programada_notificada, fecha_notificacion_programacion FROM solicitud_capacitacion WHERE solicitante_documento = $1`,
      estadoValido ? ` AND estado = $2` : '',
      ` ORDER BY fecha_creacion DESC, id DESC LIMIT 200`,
    ]
      .filter(Boolean)
      .join('');
    const params = estadoValido ? [doc, estadoValido] : [doc];
    const rs = await pool.query(sql, params);

    return okJson(res, { solicitudes: rs.rows, filas: rs.rows.length });
  } catch (err) {
    return serverError(res, err, 'No fue posible listar sus solicitudes.');
  }
});

router.get('/gestion/solicitudes', requireLaboratoristaOAdmin, async function (req, res) {
  try {
    const scope = await resolveLaboratoristaScope(req);
    const stateOnly = scope.isAdmin;
    const facultyIds = scopeFacultyIdList(scope);
    const ualIds = Array.isArray(scope.ualIds) ? scope.ualIds.filter(Boolean) : [];
    const estadoRaw =
      String(req.query?.estado || '')
        .trim()
        .toLowerCase() || null;
    const estadoValido = estadoRaw && SOLICITUD_ESTADOS.has(estadoRaw) ? estadoRaw : null;
    const offset = Number(req.query?.offset) || 0;
    const limit = Math.min(500, Math.max(20, Number(req.query?.limit) || 200));

    if (!stateOnly && facultyIds.length === 0 && ualIds.length === 0) {
      return okJson(res, {
        solicitudes: [],
        filas: 0,
        scope_is_admin: false,
        scope_faculty_ids: [],
        scope_ual_ids: [],
        scope_resolved_from: scope.resolvedFrom,
        scope_facultades_detalle: [],
        scope_laboratorios_detalle: [],
        scope_vacio: true,
        mensaje:
          'Usted no tiene UALes ni facultades asignadas. Contacte Coordinación General para asignar alcance.',
      });
    }

    const clauses = [];
    const params = [];
    if (estadoValido) {
      params.push(estadoValido);
      clauses.push('sc.estado = $' + params.length);
    }
    if (!stateOnly) {
      if (facultyIds.length > 0 || ualIds.length > 0) {
        if (ualIds.length > 0) {
          params.push(ualIds);
          clauses.push('(sc.ual_id IS NULL OR sc.ual_id = ANY($' + params.length + '::int[]))');
        }
        if (facultyIds.length > 0) {
          params.push(facultyIds);
          clauses.push(
            '(sc.ual_id IS NULL OR sc.facultad_id = ANY($' + params.length + '::int[]))'
          );
        }
      } else {
        clauses.push('FALSE');
      }
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';

    const sql = `
      SELECT sc.id,
             sc.solicitante_documento,
             sc.solicitante_usuario_id,
             sc.solicitante_nombre,
             sc.codigo_curso,
             sc.nombre_curso_snapshot,
             sc.facultad_id,
             f.nombre AS facultad_nombre,
             sc.ual_id AS ual_id_solicitud,
             u.nombre AS ual_nombre,
             sc.sesion_capacitacion_id AS id_sesion_programada_notificada,
             sc.fecha_notificacion_programacion,
             sc.motivo,
             sc.estado,
             sc.observaciones_laboratorista,
             sc.fecha_creacion,
             sc.fecha_modificacion
        FROM solicitud_capacitacion sc
        LEFT JOIN facultad f ON f.facultad_id = sc.facultad_id
        LEFT JOIN ual u ON u.ual_id = sc.ual_id
      ${where}
       ORDER BY sc.estado = 'pendiente' DESC, sc.fecha_creacion DESC, sc.id DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}
    `;
    params.push(limit, offset);
    const rs = await pool.query(sql, params);
    return okJson(res, {
      solicitudes: rs.rows,
      filas: rs.rows.length,
      scope_is_admin: scope.isAdmin,
      scope_faculty_ids: facultyIds,
      scope_ual_ids: ualIds,
      scope_resolved_from: scope.resolvedFrom,
      scope_facultades_detalle: Array.isArray(scope.facultades) ? scope.facultades : [],
      scope_laboratorios_detalle: Array.isArray(scope.laboratorios) ? scope.laboratorios : [],
    });
  } catch (err) {
    return serverError(res, err, 'No fue posible listar las solicitudes de capacitación.');
  }
});

/* ============================================================
   2. SESIONES PROGRAMADAS
   ============================================================ */

router.post('/gestion/sesiones/programar', requireLaboratoristaOAdmin, async function (req, res) {
  try {
    const scope = await resolveLaboratoristaScope(req);
    const cursoCodigo = truncate(req.body?.codigo_curso, 80);
    const ualIdRaw = req.body?.ual_id;
    const fechaInicioRaw = req.body?.fecha_inicio || req.body?.fechaInicio;
    const fechaFinRaw = req.body?.fecha_fin || req.body?.fechaFin;
    const cupoRaw = req.body?.cupo || req.body?.cupo_maximo || req.body?.cupo_disponible;
    const lugar = truncate(req.body?.lugar || req.body?.ubicacion, 255);
    const descripcion = truncate(req.body?.descripcion || req.body?.detalle, 1000);
    const enlaceSesion = truncate(req.body?.enlace_sesion || req.body?.enlaceSesion, 500);

    if (!cursoCodigo) return badRequest(res, 'codigo_curso es obligatorio.');
    if (!fechaInicioRaw || !fechaFinRaw) {
      return badRequest(res, 'fecha_inicio y fecha_fin son obligatorios.');
    }
    const fechaInicio = new Date(fechaInicioRaw);
    const fechaFin = new Date(fechaFinRaw);
    if (isNaN(fechaInicio.getTime()) || isNaN(fechaFin.getTime())) {
      return badRequest(res, 'Las fechas no tienen un formato válido (ISO 8601).');
    }
    if (fechaFin.getTime() <= fechaInicio.getTime()) {
      return badRequest(res, 'fecha_fin debe ser posterior a fecha_inicio.');
    }
    const cupo = parsePosInt(cupoRaw, 'cupo');
    if (cupo > 5000) return badRequest(res, 'cupo no puede exceder 5000.');

    const curso = await pool.query(
      `SELECT codigo_curso, nombre_curso, id_facultad FROM cursos WHERE codigo_curso = $1 AND activo = TRUE LIMIT 1`,
      [cursoCodigo]
    );
    if (curso.rows.length === 0) {
      return notFound(res, 'El curso especificado no existe o está inactivo.');
    }
    const cursoRow = curso.rows[0];
    let ualId = null;
    if (ualIdRaw != null && ualIdRaw !== '') {
      ualId = parsePosInt(ualIdRaw, 'ual_id');
      const ualRs = await pool.query(
        `SELECT u.ual_id, u.facultad_id, u.nombre FROM ual u WHERE u.ual_id = $1 AND u.activo = TRUE LIMIT 1`,
        [ualId]
      );
      if (ualRs.rows.length === 0) {
        return notFound(res, 'El laboratorio/UAL indicado no existe o está inactivo.');
      }
      const ual = ualRs.rows[0];
      if (!scope.isAdmin) {
        const allowedUal = scope.ualIds.includes(ual.ual_id);
        if (!allowedUal) {
          return forbidden(
            res,
            'No puede programar capacitaciones en este laboratorio (UAL) porque no está asignado a él.'
          );
        }
      }
      if (
        cursoRow.id_facultad &&
        ual.facultad_id &&
        Number(cursoRow.id_facultad) !== Number(ual.facultad_id)
      ) {
        return badRequest(
          res,
          'El curso y la UAL (laboratorio) deben pertenecer a la misma facultad (consistencia de datos).'
        );
      }
    } else if (!scope.isAdmin) {
      if (scope.facultyIds.length > 0 && cursoRow.id_facultad) {
        if (!scope.facultyIds.includes(Number(cursoRow.id_facultad))) {
          return forbidden(
            res,
            'No puede programar capacitaciones para este curso, pues pertenece a una facultad que no gestiona.'
          );
        }
      }
    }
    const labDoc = getSessionDocument(req);
    const labNombre = getSessionUserNombre(req);
    const insert = await pool.query(
      `
      INSERT INTO sesion_capacitacion (
        codigo_curso,
        nombre_curso_snapshot,
        facultad_id,
        ual_id,
        fecha_inicio,
        fecha_fin,
        cupo_maximo,
        lugar,
        descripcion,
        enlace_sesion,
        estado,
        laboratorista_responsable_doc,
        laboratorista_responsable_nombre
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'programada', $11, $12)
      RETURNING id, codigo_curso, nombre_curso_snapshot, facultad_id, ual_id, fecha_inicio, fecha_fin, cupo_maximo, lugar, descripcion, enlace_sesion, estado, fecha_creacion,
                laboratorista_responsable_doc, laboratorista_responsable_nombre
      `,
      [
        cursoCodigo,
        truncate(cursoRow.nombre_curso, 255),
        cursoRow.id_facultad || null,
        ualId,
        fechaInicio,
        fechaFin,
        cupo,
        lugar,
        descripcion,
        enlaceSesion,
        labDoc || null,
        labNombre,
      ]
    );
    const sesionNueva = insert.rows[0];

    if (String(req.body?.marcar_solicitudes_notificado || 'false') === 'true') {
      await pool.query(
        `UPDATE solicitud_capacitacion SET estado = 'notificado_programada',
           observaciones_laboratorista = COALESCE(observaciones_laboratorista, '') || $1,
           sesion_capacitacion_id = $3,
           fecha_notificacion_programacion = CURRENT_TIMESTAMP,
           fecha_modificacion = CURRENT_TIMESTAMP
         WHERE solicitante_documento IN (
           SELECT solicitante_documento FROM solicitud_capacitacion WHERE codigo_curso = $2 AND estado = 'pendiente' LIMIT 200
         ) AND codigo_curso = $2 AND estado = 'pendiente'`,
        [
          '; Notificación automática: nueva sesión programada id=' + sesionNueva.id + '. ',
          cursoCodigo,
          sesionNueva.id,
        ]
      );
    }

    const notificarEmail =
      String(req.body?.notificar_por_email ?? 'true') === 'true' &&
      String(req.body?.marcar_solicitudes_notificado ?? 'true') === 'true';

    if (notificarEmail) {
      Promise.resolve()
        .then(async function () {
          try {
            const appBase =
              process.env.PUBLIC_APP_URL || process.env.APP_URL || 'https://labs.udistrital.edu.co';
            const APP_PATH = process.env.APP_PATH || '/milab';
            const appUrlBase = String(appBase || '').replace(/\/$/, '') + String(APP_PATH || '');
            const misCapacitacionesUrl =
              appUrlBase +
              '/capacitacion/mis-capacitaciones/load_info?tab=sesiones&codigo_curso=' +
              encodeURIComponent(sesionNueva.codigo_curso) +
              '&sesion=' +
              encodeURIComponent(String(sesionNueva.id || ''));

            const rsDest = await pool.query(
              `
                WITH documentos_target AS (
                  SELECT solicitante_documento AS documento,
                         COALESCE(solicitante_nombre, '') AS nombre_snapshot
                  FROM solicitud_capacitacion
                  WHERE codigo_curso = $1
                    AND estado IN ('pendiente','notificado','notificado_programada')
                    AND activo = TRUE
                  UNION
                  SELECT usuario_documento AS documento,
                         COALESCE(usuario_nombre, '') AS nombre_snapshot
                  FROM inscripcion_sesion_capacitacion
                  WHERE sesion_capacitacion_id = $2
                    AND estado IN ('inscrito','cupo_excedido_lista_espera')
                    AND activo = TRUE
                )
                SELECT DISTINCT ON (dt.documento)
                       dt.documento,
                       COALESCE(NULLIF(dt.nombre_snapshot,''), u.nombre, u.nombres || ' ' || u.apellidos, 'Usuario MiLab') AS usuario_nombre,
                       u.correo AS correo
                FROM documentos_target dt
                LEFT JOIN usuario u ON u.documento = dt.documento OR CAST(u.id AS TEXT) = dt.documento
                WHERE u.correo IS NOT NULL AND BTRIM(u.correo) <> ''
                LIMIT 250
              `,
              [sesionNueva.codigo_curso, sesionNueva.id]
            );

            const destinatarios = (rsDest.rows || []).filter(function (r) {
              return r && r.correo && /\S+@\S+\.\S+/.test(String(r.correo));
            });
            if (!destinatarios.length) return;

            const ualNombre = sesionNueva.ual_id
              ? (
                  await pool.query(`SELECT nombre FROM ual WHERE ual_id = $1 LIMIT 1`, [
                    sesionNueva.ual_id,
                  ])
                ).rows[0]?.nombre || null
              : null;
            const cupoLibreHint =
              sesionNueva.cupo_maximo -
                (
                  await pool.query(
                    `SELECT COUNT(*)::int AS c FROM inscripcion_sesion_capacitacion WHERE sesion_capacitacion_id = $1 AND estado = 'inscrito' AND activo = TRUE`,
                    [sesionNueva.id]
                  )
                ).rows[0]?.c || 0;

            function fmtFecha(ts) {
              try {
                const d = new Date(ts);
                return d.toLocaleString('es-CO', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                });
              } catch {
                return String(ts || '');
              }
            }

            const subject =
              'MiLab · Nueva capacitación programada: ' +
              (sesionNueva.nombre_curso_snapshot ||
                sesionNueva.codigo_curso ||
                'Curso de capacitación');

            for (const dest of destinatarios) {
              try {
                await sendEmailNotification({
                  sourceSystem: 'capacitacion',
                  templateName: 'capacitacion/sesion_programada_notificacion',
                  recipient: String(dest.correo),
                  subject,
                  correlationId:
                    'sesion_cap_' + sesionNueva.id + '_' + String(dest.documento || 'user'),
                  throwOnError: false,
                  variables: {
                    usuarioNombre: String(dest.usuario_nombre || 'Usuario MiLab'),
                    cursoNombre: String(
                      sesionNueva.nombre_curso_snapshot ||
                        sesionNueva.codigo_curso ||
                        'Capacitación'
                    ),
                    cursoCodigo: String(sesionNueva.codigo_curso || ''),
                    fechaInicioTexto: fmtFecha(sesionNueva.fecha_inicio),
                    fechaFinTexto: fmtFecha(sesionNueva.fecha_fin),
                    lugar: String(sesionNueva.lugar || ''),
                    ualNombre: String(ualNombre || ''),
                    cupoMaximo: String(sesionNueva.cupo_maximo || ''),
                    cupoDisponibleHint: String(Math.max(0, Number(cupoLibreHint || 0))),
                    responsableNombre: String(sesionNueva.laboratorista_responsable_nombre || ''),
                    responsableDocumento: String(sesionNueva.laboratorista_responsable_doc || ''),
                    descripcion: String(sesionNueva.descripcion || ''),
                    enlaceSesion: String(sesionNueva.enlace_sesion || ''),
                    misCapacitacionesUrl,
                    appUrl: String(appUrlBase || ''),
                  },
                });
              } catch (errMail) {
                console.error(
                  '[cap-email] Error enviando notificacion a',
                  dest.correo,
                  ':',
                  errMail?.message || errMail
                );
              }
            }
          } catch (errOuter) {
            console.error(
              '[cap-email] Error general fire-and-forget programar sesion:',
              errOuter?.message || errOuter
            );
          }
        })
        .catch(function () {
          /* silently ignore - fire-and-forget */
        });
    }

    return okJson(
      res,
      {
        sesion: sesionNueva,
        notificacion_email: notificarEmail,
        message:
          'Sesión de capacitación programada exitosamente. Los estudiantes podrán inscribirse a partir de ahora.',
      },
      201
    );
  } catch (err) {
    return serverError(res, err, 'No fue posible programar la sesión de capacitación.');
  }
});

router.get('/gestion/sesiones', requireLaboratoristaOAdmin, async function (req, res) {
  try {
    const scope = await resolveLaboratoristaScope(req);
    const estadoRaw =
      String(req.query?.estado || '')
        .trim()
        .toLowerCase() || null;
    const estadoValido = estadoRaw && SESION_ESTADOS.has(estadoRaw) ? estadoRaw : null;
    const facultadIdRaw = req.query?.facultad_id;
    const facultadId = facultadIdRaw ? parsePosInt(facultadIdRaw, 'facultad_id') : null;
    const ualIdRaw = req.query?.ual_id;
    const ualId = ualIdRaw ? parsePosInt(ualIdRaw, 'ual_id') : null;
    const codigoCurso = truncate(req.query?.codigo_curso, 80);
    const desde = req.query?.desde ? new Date(req.query.desde) : null;
    const hasta = req.query?.hasta ? new Date(req.query.hasta) : null;
    if (desde && isNaN(desde.getTime())) return badRequest(res, 'Parametro desde inválido.');
    if (hasta && isNaN(hasta.getTime())) return badRequest(res, 'Parametro hasta inválido.');

    const facultyIds = Array.isArray(scope.facultyIds) ? scope.facultyIds.filter(Boolean) : [];
    const ualIds = Array.isArray(scope.ualIds) ? scope.ualIds.filter(Boolean) : [];
    if (!scope.isAdmin && facultyIds.length === 0 && ualIds.length === 0) {
      return okJson(res, {
        sesiones: [],
        filas: 0,
        scope_is_admin: false,
        scope_resolved_from: scope.resolvedFrom,
        scope_vacio: true,
        mensaje:
          'Usted no tiene UALes ni facultades asignadas. Contacte Coordinación General para asignar alcance.',
      });
    }

    const clauses = [];
    const params = [];
    if (estadoValido) {
      params.push(estadoValido);
      clauses.push('s.estado = $' + params.length);
    }
    if (facultadId) {
      params.push(facultadId);
      clauses.push('s.facultad_id = $' + params.length);
    }
    if (ualId) {
      params.push(ualId);
      clauses.push('s.ual_id = $' + params.length);
    }
    if (codigoCurso) {
      params.push(codigoCurso);
      clauses.push('s.codigo_curso = $' + params.length);
    }
    if (desde) {
      params.push(desde);
      clauses.push('s.fecha_fin >= $' + params.length);
    }
    if (hasta) {
      params.push(hasta);
      clauses.push('s.fecha_inicio <= $' + params.length);
    }
    if (!scope.isAdmin) {
      if (scope.ualIds.length > 0 || scope.facultyIds.length > 0) {
        if (scope.ualIds.length > 0) {
          params.push(scope.ualIds);
          clauses.push('s.ual_id = ANY($' + params.length + '::int[])');
        }
        if (scope.facultyIds.length > 0) {
          params.push(scope.facultyIds);
          clauses.push('(s.ual_id IS NULL OR s.facultad_id = ANY($' + params.length + '::int[]))');
        }
      } else {
        clauses.push('FALSE');
      }
    }
    const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
    const sql = `
      SELECT s.id, s.codigo_curso, s.nombre_curso_snapshot, s.facultad_id, s.ual_id,
             u.nombre AS ual_nombre, f.nombre AS facultad_nombre,
             s.fecha_inicio, s.fecha_fin, s.cupo_maximo, s.lugar, s.descripcion,
             s.enlace_sesion, s.estado, s.evidencia_path, s.evidencia_mime,
             s.laboratorista_responsable_doc, s.laboratorista_responsable_nombre,
             s.fecha_creacion, s.fecha_modificacion,
             (SELECT COUNT(*)::int FROM inscripcion_sesion_capacitacion i
                WHERE i.sesion_capacitacion_id = s.id AND i.estado = 'inscrito') AS inscripciones_activas
        FROM sesion_capacitacion s
        LEFT JOIN ual u ON u.ual_id = s.ual_id
        LEFT JOIN facultad f ON f.facultad_id = s.facultad_id
      ${where}
       ORDER BY s.fecha_inicio DESC, s.id DESC
       LIMIT 500
    `;
    const rs = await pool.query(sql, params);
    return okJson(res, {
      sesiones: rs.rows,
      filas: rs.rows.length,
      scope_is_admin: scope.isAdmin,
      scope_resolved_from: scope.resolvedFrom,
      scope_faculty_ids: Array.isArray(scope.facultyIds) ? scope.facultyIds : [],
      scope_ual_ids: Array.isArray(scope.ualIds) ? scope.ualIds : [],
      scope_facultades_detalle: Array.isArray(scope.facultades) ? scope.facultades : [],
      scope_laboratorios_detalle: Array.isArray(scope.laboratorios) ? scope.laboratorios : [],
    });
  } catch (err) {
    return serverError(res, err, 'No fue posible listar las sesiones programadas.');
  }
});

router.get('/sesiones-disponibles', requireEstudianteODocente, async function (req, res) {
  try {
    const codigoCurso = truncate(req.query?.codigo_curso, 80);
    const facultadIdRaw = req.query?.facultad_id;
    const facultadId = facultadIdRaw ? parsePosInt(facultadIdRaw, 'facultad_id') : null;
    const incluirCerradas = String(req.query?.incluir_cerradas || '').toLowerCase() === 'true';

    const clauses = ["s.estado IN ('programada', 'en_curso')"];
    const params = [];
    if (codigoCurso) {
      params.push(codigoCurso);
      clauses.push('s.codigo_curso = $' + params.length);
    }
    if (facultadId) {
      params.push(facultadId);
      clauses.push('s.facultad_id = $' + params.length);
    }
    if (!incluirCerradas) {
      params.push(new Date());
      clauses.push('s.fecha_fin >= $' + params.length);
    }
    const where = ' WHERE ' + clauses.join(' AND ');
    const sql = `
      SELECT s.id, s.codigo_curso, s.nombre_curso_snapshot, s.facultad_id, s.ual_id,
             u.nombre AS ual_nombre, f.nombre AS facultad_nombre,
             s.fecha_inicio, s.fecha_fin, s.cupo_maximo, s.lugar, s.descripcion,
             s.enlace_sesion, s.estado, s.laboratorista_responsable_nombre,
             (SELECT COUNT(*)::int FROM inscripcion_sesion_capacitacion i
                WHERE i.sesion_capacitacion_id = s.id AND i.estado = 'inscrito') AS inscripciones_activas,
             LEAST(GREATEST(s.cupo_maximo - (
               SELECT COUNT(*)::int FROM inscripcion_sesion_capacitacion i
                WHERE i.sesion_capacitacion_id = s.id AND i.estado = 'inscrito'
             ), 0), s.cupo_maximo) AS cupo_disponible
        FROM sesion_capacitacion s
        LEFT JOIN ual u ON u.ual_id = s.ual_id
        LEFT JOIN facultad f ON f.facultad_id = s.facultad_id
      ${where}
       ORDER BY s.fecha_inicio ASC, s.id ASC
       LIMIT 500
    `;
    const rs = await pool.query(sql, params);
    return okJson(res, { sesiones: rs.rows, filas: rs.rows.length });
  } catch (err) {
    return serverError(res, err, 'No fue posible listar las sesiones disponibles.');
  }
});

/* ============================================================
   3. INSCRIPCIONES
   ============================================================ */

router.post('/inscribirme/:sesionId', requireEstudianteODocente, async function (req, res) {
  let client = null;
  try {
    const bloqueoSanciones = await assertUsuarioSinSancionesActivas(req, res);
    if (bloqueoSanciones) return bloqueoSanciones;

    const sesionId = parsePosInt(req.params.sesionId, 'sesion_id');
    const doc = getSessionDocument(req);
    const uid = getSessionUserId(req);
    if (!doc) return badRequest(res, 'Usuario sin documento de sesión.');
    if (!uid) return badRequest(res, 'Usuario sin id de sesión.');
    const origen = ASISTENCIA_METODOS.has(String(req.body?.origen || '').trim())
      ? String(req.body?.origen).trim()
      : 'directa';
    const solicitudIdRaw = req.body?.solicitud_capacitacion_id;
    const solicitudId = solicitudIdRaw
      ? parsePosInt(solicitudIdRaw, 'solicitud_capacitacion_id')
      : null;

    client = await pool.connect();
    await client.query('BEGIN');

    const sesionRs = await client.query(
      `SELECT s.id, s.codigo_curso, s.nombre_curso_snapshot, s.cupo_maximo, s.estado, s.fecha_fin, s.facultad_id, s.ual_id
         FROM sesion_capacitacion s
        WHERE s.id = $1
        LIMIT 1`,
      [sesionId]
    );
    if (sesionRs.rows.length === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'La sesión de capacitación no existe.');
    }
    const sesion = sesionRs.rows[0];
    if (!SESION_ESTADOS.has(sesion.estado) || !['programada', 'en_curso'].includes(sesion.estado)) {
      await client.query('ROLLBACK');
      return badRequest(res, 'La sesión no admite inscripciones en este momento.');
    }
    if (sesion.fecha_fin && new Date(sesion.fecha_fin).getTime() < Date.now()) {
      await client.query('ROLLBACK');
      return badRequest(res, 'La sesión ya finalizó y no admite más inscripciones.');
    }

    const exist = await client.query(
      `SELECT estado FROM inscripcion_sesion_capacitacion
        WHERE sesion_capacitacion_id = $1 AND usuario_documento = $2 LIMIT 1`,
      [sesionId, doc]
    );
    if (exist.rows.length > 0 && exist.rows[0].estado === 'inscrito') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        ok: false,
        message: 'Ya estás inscrito en esta sesión de capacitación.',
      });
    }

    const cupoOcupado = await client.query(
      `SELECT COUNT(*)::int AS total FROM inscripcion_sesion_capacitacion
        WHERE sesion_capacitacion_id = $1 AND estado = 'inscrito'`,
      [sesionId]
    );
    const ocupado = Number(cupoOcupado.rows[0]?.total || 0);
    let estadoInscripcion = 'inscrito';
    if (ocupado >= Number(sesion.cupo_maximo || 0)) {
      estadoInscripcion = 'cupo_excedido';
    }
    const nombre = getSessionUserNombre(req);
    let saved;
    if (exist.rows.length > 0) {
      saved = await client.query(
        `UPDATE inscripcion_sesion_capacitacion
            SET estado = $1,
                origen = $2,
                solicitud_capacitacion_id = COALESCE($3, solicitud_capacitacion_id),
                fecha_inscripcion = CURRENT_TIMESTAMP,
                fecha_modificacion = CURRENT_TIMESTAMP
          WHERE sesion_capacitacion_id = $4 AND usuario_documento = $5
          RETURNING id, sesion_capacitacion_id, usuario_documento, estado, origen, solicitud_capacitacion_id, fecha_inscripcion`,
        [estadoInscripcion, origen, solicitudId, sesionId, doc]
      );
    } else {
      saved = await client.query(
        `INSERT INTO inscripcion_sesion_capacitacion (
          sesion_capacitacion_id,
          usuario_documento,
          usuario_id,
          usuario_nombre,
          estado,
          origen,
          solicitud_capacitacion_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, sesion_capacitacion_id, usuario_documento, estado, origen, solicitud_capacitacion_id, fecha_inscripcion`,
        [sesionId, doc, uid, nombre, estadoInscripcion, origen, solicitudId]
      );
    }

    if (solicitudId) {
      await client.query(
        `UPDATE solicitud_capacitacion SET estado = 'atendido', fecha_modificacion = CURRENT_TIMESTAMP, observaciones_laboratorista = COALESCE(observaciones_laboratorista,'') || '; inscrito a sesion ' || $1
          WHERE id = $2 AND solicitante_documento = $3 AND estado <> 'cancelado'`,
        [sesionId, solicitudId, doc]
      );
    }

    await client.query('COMMIT');
    const cupoDisp = Math.max(
      0,
      Number(sesion.cupo_maximo || 0) - (ocupado + (estadoInscripcion === 'inscrito' ? 1 : 0))
    );
    return okJson(
      res,
      {
        inscripcion: saved.rows[0],
        cupo_disponible: cupoDisp,
        cupo_maximo: sesion.cupo_maximo,
        message:
          estadoInscripcion === 'cupo_excedido'
            ? 'Tu inscripción se registró pero el cupo se ha excedido. El laboratorista te contactará si se libera un lugar o se agenda una nueva sesión.'
            : '¡Inscripción exitosa! Recibirás recordatorio antes de la sesión. El día del evento presenta tu documento para registrar asistencia.',
      },
      201
    );
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore */
      }
    }
    return serverError(res, err, 'Ocurrió un error al procesar la inscripción.');
  } finally {
    if (client) client.release();
  }
});

router.get('/mis-inscripciones', requireEstudianteODocente, async function (req, res) {
  try {
    const doc = getSessionDocument(req);
    if (!doc) return badRequest(res, 'Usuario sin documento en sesión.');
    const estadoRaw = String(req.query?.estado || '')
      .trim()
      .toLowerCase();
    const estadoValido = estadoRaw && INSCRIPCION_ESTADOS.has(estadoRaw) ? estadoRaw : null;
    const params = [doc];
    const clauses = ['i.usuario_documento = $1'];
    if (estadoValido) {
      params.push(estadoValido);
      clauses.push('i.estado = $' + params.length);
    }
    const sql = `
      SELECT i.id, i.sesion_capacitacion_id, i.estado, i.origen, i.solicitud_capacitacion_id,
             i.fecha_inscripcion, i.fecha_modificacion,
             s.codigo_curso, s.nombre_curso_snapshot, s.fecha_inicio, s.fecha_fin, s.lugar, s.estado AS sesion_estado, s.cupo_maximo,
             f.nombre AS facultad_nombre, u.nombre AS ual_nombre,
             (SELECT COALESCE(bool_or(a.asistio), FALSE) FROM asistencia_capacitacion a
               WHERE a.sesion_capacitacion_id = i.sesion_capacitacion_id
                 AND a.usuario_documento = i.usuario_documento) AS asistio,
             (SELECT a.fecha_registro FROM asistencia_capacitacion a
               WHERE a.sesion_capacitacion_id = i.sesion_capacitacion_id
                 AND a.usuario_documento = i.usuario_documento LIMIT 1) AS asistencia_fecha,
             (SELECT c.id FROM certificacion_usuario c
               WHERE c.codigo_curso = s.codigo_curso
                 AND c.usuario_documento = i.usuario_documento
                 AND c.activo = TRUE
                 AND c.fecha_vencimiento > CURRENT_TIMESTAMP LIMIT 1) AS certificacion_activa_id
        FROM inscripcion_sesion_capacitacion i
        JOIN sesion_capacitacion s ON s.id = i.sesion_capacitacion_id
        LEFT JOIN facultad f ON f.facultad_id = s.facultad_id
        LEFT JOIN ual u ON u.ual_id = s.ual_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY s.fecha_inicio DESC, i.id DESC
       LIMIT 300
    `;
    const rs = await pool.query(sql, params);
    return okJson(res, { inscripciones: rs.rows, filas: rs.rows.length });
  } catch (err) {
    return serverError(res, err, 'No fue posible listar sus inscripciones.');
  }
});

router.get('/mis-certificaciones', requireEstudianteODocente, async function (req, res) {
  try {
    const doc = getSessionDocument(req);
    if (!doc) return badRequest(res, 'Usuario sin documento en sesión.');
    const vigenteRaw = String(req.query?.vigente || '')
      .trim()
      .toLowerCase();
    const sql = `
      SELECT c.id,
             c.codigo_curso,
             COALESCE(NULLIF(c.nombre_curso_snapshot, ''), cur.nombre_curso) AS nombre_curso,
             c.modalidad,
             c.fecha_emision,
             c.fecha_vencimiento,
             c.vigencia_meses,
             c.activo,
             CASE WHEN c.activo = TRUE AND c.fecha_vencimiento > CURRENT_TIMESTAMP THEN TRUE ELSE FALSE END AS vigente,
             (CURRENT_DATE - c.fecha_vencimiento::date) AS dias_desde_vencimiento,
             c.sesion_capacitacion_id,
             s.fecha_inicio AS sesion_fecha_inicio,
             s.lugar AS sesion_lugar,
             c.solicitud_prestamo_id,
             c.ual_id,
             u.nombre AS ual_nombre,
             c.facultad_id,
             f.nombre AS facultad_nombre,
             c.certificado_por_laboratorista_doc,
             c.certificado_por_laboratorista_nombre,
             c.notas
        FROM certificacion_usuario c
        LEFT JOIN sesion_capacitacion s ON s.id = c.sesion_capacitacion_id
        LEFT JOIN ual u ON u.ual_id = c.ual_id
        LEFT JOIN facultad f ON f.facultad_id = c.facultad_id
        LEFT JOIN cursos cur ON cur.codigo_curso = c.codigo_curso
       WHERE c.usuario_documento = $1
       ORDER BY CASE WHEN c.activo = TRUE AND c.fecha_vencimiento > CURRENT_TIMESTAMP THEN 0 ELSE 1 END,
                c.fecha_vencimiento DESC, c.id DESC
       LIMIT 500
    `;
    const rs = await pool.query(sql, [doc]);
    let rows = rs.rows;
    if (vigenteRaw === 'true')
      rows = rows.filter(function (r) {
        return !!r.vigente;
      });
    else if (vigenteRaw === 'false')
      rows = rows.filter(function (r) {
        return !r.vigente;
      });
    return okJson(res, { certificaciones: rows, filas: rows.length });
  } catch (err) {
    return serverError(res, err, 'No fue posible listar sus certificaciones.');
  }
});

/* ============================================================
   4. ASISTENCIA (QR DOCUMENTO SIMPLE / MANUAL)
   ============================================================ */

router.post(
  '/gestion/sesiones/:id/cambiar-estado',
  requireLaboratoristaOAdmin,
  async function (req, res) {
    try {
      const scope = await resolveLaboratoristaScope(req);
      const sesionId = parsePosInt(req.params.id, 'sesion_id');
      const estadoNuevo = String(req.body?.estado || req.body?.nuevo_estado || '')
        .trim()
        .toLowerCase();
      if (!SESION_ESTADOS.has(estadoNuevo)) {
        return badRequest(
          res,
          'Estado inválido. Opciones: programada | en_curso | realizada | cancelada.'
        );
      }
      const scopedUalIds = scopeUalIdList(scope);
      const scopedFacultyIds = scopeFacultyIdList(scope);
      const clauses = ['id = $1'];
      const params = [sesionId];
      if (!scope.isAdmin) {
        if (scopedUalIds.length > 0) {
          params.push(scopedUalIds);
          clauses.push('ual_id = ANY($' + params.length + '::int[])');
        } else if (scopedFacultyIds.length > 0) {
          params.push(scopedFacultyIds);
          clauses.push('(ual_id IS NULL OR facultad_id = ANY($' + params.length + '::int[]))');
        } else {
          return forbidden(res, 'No tiene UALes o facultades asignadas para gestionar sesiones.');
        }
      }
      params.push(estadoNuevo);
      const estadoPlaceholder = '$' + params.length;
      const upd = await pool.query(
        `UPDATE sesion_capacitacion SET estado = ` +
          estadoPlaceholder +
          `, fecha_modificacion = CURRENT_TIMESTAMP WHERE ${clauses.join(' AND ')} RETURNING id, estado, fecha_inicio, fecha_fin`,
        params
      );
      if (upd.rows.length === 0) {
        return notFound(res, 'Sesión no existe o no está en su scope de gestión.');
      }
      return okJson(res, { sesion: upd.rows[0], message: 'Estado de la sesión actualizado.' });
    } catch (err) {
      return serverError(res, err, 'No fue posible cambiar el estado de la sesión.');
    }
  }
);

router.post('/gestion/asistencia/marcar', requireLaboratoristaOAdmin, async function (req, res) {
  try {
    const scope = await resolveLaboratoristaScope(req);
    const sesionId = parsePosInt(req.body?.sesion_id, 'sesion_id');
    const documento = truncate(req.body?.usuario_documento || req.body?.documento || '', 30);
    if (!documento) return badRequest(res, 'El documento de usuario es obligatorio.');
    const asistio =
      req.body?.asistio == null ? true : req.body.asistio !== false && req.body.asistio !== 'false';
    let metodo = String(req.body?.metodo || 'qr_documento')
      .trim()
      .toLowerCase();
    if (!ASISTENCIA_METODOS.has(metodo)) metodo = 'qr_documento';

    const scopedUalIds = scopeUalIdList(scope);
    const scopedFacultyIds = scopeFacultyIdList(scope);
    const clauses = ['s.id = $1'];
    const params = [sesionId];
    if (!scope.isAdmin) {
      if (scopedUalIds.length > 0) {
        params.push(scopedUalIds);
        clauses.push('s.ual_id = ANY($' + params.length + '::int[])');
      } else if (scopedFacultyIds.length > 0) {
        params.push(scopedFacultyIds);
        clauses.push('(s.ual_id IS NULL OR s.facultad_id = ANY($' + params.length + '::int[]))');
      } else {
        return forbidden(res, 'No tiene permisos para marcar asistencia en esta sesión.');
      }
    }
    const exists = await pool.query(
      `SELECT s.id, s.codigo_curso, s.nombre_curso_snapshot, s.estado, s.ual_id, s.facultad_id, s.cupo_maximo
         FROM sesion_capacitacion s
       WHERE ${clauses.join(' AND ')} LIMIT 1`,
      params
    );
    if (exists.rows.length === 0) {
      return notFound(res, 'Sesión no existe o está fuera de su scope de gestión.');
    }
    const sesion = exists.rows[0];
    if (sesion.estado === 'cancelada') {
      return badRequest(res, 'No puedes marcar asistencia en una sesión cancelada.');
    }

    const inscripcion = await pool.query(
      `SELECT id, estado FROM inscripcion_sesion_capacitacion
        WHERE sesion_capacitacion_id = $1 AND usuario_documento = $2 LIMIT 1`,
      [sesionId, documento]
    );
    let inscripcionId = inscripcion.rows[0]?.id || null;
    if (inscripcion.rows.length === 0) {
      const userRs = await pool.query(`SELECT id, tipo FROM usuario WHERE documento = $1 LIMIT 1`, [
        documento,
      ]);
      const userId = userRs.rows[0]?.id || null;
      const userNombre = userRs.rows[0]?.tipo || truncate(req.body?.usuario_nombre, 255);
      const ins = await pool.query(
        `INSERT INTO inscripcion_sesion_capacitacion (sesion_capacitacion_id, usuario_documento, usuario_id, usuario_nombre, estado, origen)
         VALUES ($1, $2, $3, $4, 'inscrito', 'lista_asistencia')
         ON CONFLICT ON CONSTRAINT ux_inscripcion_sesion_usuario DO UPDATE SET estado = 'inscrito', fecha_modificacion = CURRENT_TIMESTAMP
         RETURNING id`,
        [sesionId, documento, userId, userNombre]
      );
      inscripcionId = ins.rows[0]?.id || inscripcionId;
    } else if (inscripcion.rows[0].estado === 'cancelado') {
      await pool.query(
        `UPDATE inscripcion_sesion_capacitacion SET estado = 'inscrito', fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $1`,
        [inscripcionId]
      );
    }
    const actorDoc = getSessionDocument(req);
    const actorNombre = getSessionUserNombre(req);
    const upsert = await pool.query(
      `
      INSERT INTO asistencia_capacitacion (
        sesion_capacitacion_id,
        inscripcion_sesion_capacitacion_id,
        usuario_documento,
        asistio,
        metodo,
        registrado_por_laboratorista_doc,
        registrado_por_laboratorista_nombre
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (sesion_capacitacion_id, usuario_documento) WHERE activo = TRUE
      DO UPDATE SET
        asistio = EXCLUDED.asistio,
        metodo = EXCLUDED.metodo,
        registrado_por_laboratorista_doc = EXCLUDED.registrado_por_laboratorista_doc,
        registrado_por_laboratorista_nombre = EXCLUDED.registrado_por_laboratorista_nombre,
        fecha_registro = CURRENT_TIMESTAMP
      RETURNING id, sesion_capacitacion_id, usuario_documento, asistio, metodo, fecha_registro
      `,
      [sesionId, inscripcionId, documento, Boolean(asistio), metodo, actorDoc || null, actorNombre]
    );
    return okJson(res, {
      asistencia: upsert.rows[0],
      sesion_codigo_curso: sesion.codigo_curso,
      sesion_nombre: sesion.nombre_curso_snapshot,
      message: asistio
        ? 'Asistencia registrada exitosamente. El usuario podrá obtener la certificación una vez que cierres y certifices la sesión.'
        : 'Se registró NO asistencia para el usuario en esta sesión.',
    });
  } catch (err) {
    return serverError(res, err, 'No fue posible registrar la asistencia.');
  }
});

router.get(
  '/gestion/sesiones/:id/asistencias',
  requireLaboratoristaOAdmin,
  async function (req, res) {
    try {
      const scope = await resolveLaboratoristaScope(req);
      const sesionId = parsePosInt(req.params.id, 'sesion_id');
      const scopedUalIds = scopeUalIdList(scope);
      const scopedFacultyIds = scopeFacultyIdList(scope);
      const clauses = ['s.id = $1'];
      const params = [sesionId];
      if (!scope.isAdmin) {
        if (scopedUalIds.length > 0) {
          params.push(scopedUalIds);
          clauses.push('s.ual_id = ANY($' + params.length + '::int[])');
        } else if (scopedFacultyIds.length > 0) {
          params.push(scopedFacultyIds);
          clauses.push('(s.ual_id IS NULL OR s.facultad_id = ANY($' + params.length + '::int[]))');
        } else {
          return forbidden(res, 'No tiene permisos para acceder a esta sesión.');
        }
      }
      const check = await pool.query(
        `SELECT s.id, s.codigo_curso, s.nombre_curso_snapshot, s.estado, s.cupo_maximo FROM sesion_capacitacion s WHERE ${clauses.join(' AND ')} LIMIT 1`,
        params
      );
      if (check.rows.length === 0) {
        return notFound(res, 'Sesión no existe o está fuera de su scope.');
      }
      const asistencias = await pool.query(
        `
      SELECT a.id, a.sesion_capacitacion_id, a.inscripcion_sesion_capacitacion_id, a.usuario_documento,
             a.asistio, a.metodo, a.fecha_registro, a.registrado_por_laboratorista_doc,
             i.usuario_nombre, i.estado AS inscripcion_estado, i.fecha_inscripcion,
             u.codigo AS usuario_codigo_estudiante,
             EXISTS (
               SELECT 1 FROM certificacion_usuario c
                WHERE c.codigo_curso = check_ses.codigo_curso
                  AND c.usuario_documento = a.usuario_documento
                  AND c.activo = TRUE
                  AND c.fecha_vencimiento > CURRENT_TIMESTAMP
             ) AS tiene_cert_vigente,
             (SELECT c.fecha_emision
                FROM certificacion_usuario c
               WHERE c.codigo_curso = check_ses.codigo_curso
                 AND c.usuario_documento = a.usuario_documento
                 AND c.activo = TRUE
               ORDER BY c.fecha_emision DESC LIMIT 1
             ) AS cert_fecha_ultima_emision,
             (SELECT c.id
                FROM certificacion_usuario c
               WHERE c.codigo_curso = check_ses.codigo_curso
                 AND c.usuario_documento = a.usuario_documento
                 AND c.activo = TRUE
               ORDER BY c.fecha_emision DESC LIMIT 1
             ) AS cert_ultimo_id
        FROM asistencia_capacitacion a
        JOIN inscripcion_sesion_capacitacion i ON i.id = a.inscripcion_sesion_capacitacion_id
        JOIN (SELECT codigo_curso FROM sesion_capacitacion WHERE id = $1) AS check_ses ON TRUE
        LEFT JOIN usuario u ON u.documento = a.usuario_documento
       WHERE a.sesion_capacitacion_id = $1
       ORDER BY a.fecha_registro ASC, i.usuario_nombre ASC
       LIMIT 2000
      `,
        [sesionId]
      );
      const inscritosSinAsistencia = await pool.query(
        `
      SELECT i.usuario_documento, i.usuario_nombre, i.estado, i.fecha_inscripcion
        FROM inscripcion_sesion_capacitacion i
       WHERE i.sesion_capacitacion_id = $1
         AND i.estado = 'inscrito'
         AND NOT EXISTS (
           SELECT 1 FROM asistencia_capacitacion a
            WHERE a.sesion_capacitacion_id = i.sesion_capacitacion_id
              AND a.usuario_documento = i.usuario_documento
         )
       ORDER BY i.fecha_inscripcion ASC
       LIMIT 2000
      `,
        [sesionId]
      );
      return okJson(res, {
        sesion: check.rows[0],
        asistencias: asistencias.rows,
        inscritos_sin_asistencia: inscritosSinAsistencia.rows,
        total_asistentes: asistencias.rows.filter((r) => r.asistio).length,
      });
    } catch (err) {
      return serverError(res, err, 'No fue posible listar las asistencias.');
    }
  }
);

/* ============================================================
   5. EVIDENCIA (Multer upload: JPG/PNG/PDF ≤10MB)
   ============================================================ */

function buildEvidenciaDirPath() {
  if (process.env.CAPACITACION_EVIDENCIA_DIR) {
    return process.env.CAPACITACION_EVIDENCIA_DIR;
  }
  const tmpBase = process.platform === 'win32' ? process.env.TEMP || 'C:\\temp' : '/tmp';
  return path.join(tmpBase, 'milab-capacitacion-evidencias');
}

const EVIDENCIA_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const EVIDENCIA_ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const EVIDENCIA_MAX_BYTES = 10 * 1024 * 1024;

const evidenciaDir = buildEvidenciaDirPath();
try {
  if (!fs.existsSync(evidenciaDir)) fs.mkdirSync(evidenciaDir, { recursive: true });
} catch {
  /* ignore mkdir errors; fallback si falla guardado */
}

const multerEvidenciaStorage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, evidenciaDir);
  },
  filename: function (req, file, cb) {
    const sesionId = Number(req.params?.id) || 0;
    const safeName =
      String(Date.now()) +
      '_s' +
      String(sesionId) +
      '_' +
      Math.random().toString(36).substring(2, 10);
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    cb(
      null,
      safeName + (EVIDENCIA_ALLOWED_EXT.has(ext) ? ext : path.extname(file.originalname) || '.bin')
    );
  },
});

const uploadEvidencia = multer({
  storage: multerEvidenciaStorage,
  limits: { fileSize: EVIDENCIA_MAX_BYTES, files: 1 },
  fileFilter: function (_req, file, cb) {
    const ext = (path.extname(file.originalname || '') || '').toLowerCase();
    if (EVIDENCIA_ALLOWED_MIME.has(file.mimetype) || EVIDENCIA_ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo inválido. Solo se aceptan JPG, PNG o PDF.'));
    }
  },
}).single('evidencia');

router.post('/gestion/sesiones/:id/evidencia', requireLaboratoristaOAdmin, function (req, res) {
  uploadEvidencia(req, res, async function (err) {
    try {
      if (err) {
        const msg =
          err && err.code === 'LIMIT_FILE_SIZE'
            ? 'El archivo es muy grande. Tamaño máximo permitido: 10MB.'
            : err && err.message
              ? err.message
              : 'No fue posible guardar el archivo de evidencia.';
        return badRequest(res, msg);
      }
      const scope = await resolveLaboratoristaScope(req);
      const sesionId = parsePosInt(req.params.id, 'sesion_id');
      const scopedUalIds = scopeUalIdList(scope);
      const scopedFacultyIds = scopeFacultyIdList(scope);
      const clauses = ['id = $1'];
      const params = [sesionId];
      if (!scope.isAdmin) {
        if (scopedUalIds.length > 0) {
          params.push(scopedUalIds);
          clauses.push('ual_id = ANY($' + params.length + '::int[])');
        } else if (scopedFacultyIds.length > 0) {
          params.push(scopedFacultyIds);
          clauses.push('(ual_id IS NULL OR facultad_id = ANY($' + params.length + '::int[]))');
        } else {
          return forbidden(res, 'No tiene permisos sobre esta sesión.');
        }
      }
      if (!req.file) {
        return badRequest(res, 'Debe incluir un archivo con el campo multipart "evidencia".');
      }
      const notas = truncate(req.body?.notas || req.body?.descripcion, 500);
      const filePath = req.file.path;
      const mime = req.file.mimetype || null;
      const size = Number(req.file.size) || 0;
      const originalName = truncate(req.file.originalname, 255);
      params.push(filePath);
      const pPath = '$' + params.length;
      params.push(mime);
      const pMime = '$' + params.length;
      params.push(size);
      const pSize = '$' + params.length;
      params.push(originalName);
      const pOrig = '$' + params.length;
      params.push(notas);
      const pNotas = '$' + params.length;
      const upd = await pool.query(
        `UPDATE sesion_capacitacion
            SET evidencia_path = ` +
          pPath +
          `,
                evidencia_mime = ` +
          pMime +
          `,
                evidencia_tamano_bytes = ` +
          pSize +
          `,
                evidencia_nombre_original = ` +
          pOrig +
          `,
                notas_evidencia = COALESCE(` +
          pNotas +
          `, notas_evidencia),
                fecha_modificacion = CURRENT_TIMESTAMP
          WHERE ${clauses.join(' AND ')}
          RETURNING id, evidencia_path, evidencia_mime, evidencia_tamano_bytes, evidencia_nombre_original, notas_evidencia`,
        params
      );
      if (upd.rows.length === 0) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          /* ignore */
        }
        return notFound(res, 'Sesión no existe o no está en su scope de gestión.');
      }
      return okJson(res, {
        evidencia: upd.rows[0],
        message:
          'Evidencia cargada exitosamente. Quedará almacenada y asociada a la sesión para trazabilidad y auditoría.',
      });
    } catch (uploadErr) {
      return serverError(res, uploadErr, 'No fue posible guardar la evidencia.');
    }
  });
});

/* ============================================================
   6. CERTIFICAR ASISTENTES (TRANSACCIÓN)
   ============================================================ */

router.post(
  '/gestion/sesiones/:id/certificar-asistentes',
  requireLaboratoristaOAdmin,
  async function (req, res) {
    let client = null;
    try {
      const scope = await resolveLaboratoristaScope(req);
      const sesionId = parsePosInt(req.params.id, 'sesion_id');
      const scopedUalIds = scopeUalIdList(scope);
      const scopedFacultyIds = scopeFacultyIdList(scope);
      const clauses = ['s.id = $1'];
      const params = [sesionId];
      if (!scope.isAdmin) {
        if (scopedUalIds.length > 0) {
          params.push(scopedUalIds);
          clauses.push('s.ual_id = ANY($' + params.length + '::int[])');
        } else if (scopedFacultyIds.length > 0) {
          params.push(scopedFacultyIds);
          clauses.push('(s.ual_id IS NULL OR s.facultad_id = ANY($' + params.length + '::int[]))');
        } else {
          return forbidden(res, 'No tiene permisos para certificar en esta sesión.');
        }
      }
      const vigenciaMesesRaw = req.body?.vigencia_meses || req.body?.vigenciaMeses;
      const vigenciaMeses =
        vigenciaMesesRaw == null || vigenciaMesesRaw === ''
          ? 12
          : (function () {
              const n = Number(vigenciaMesesRaw);
              if (!Number.isInteger(n) || n < 1 || n > 60) {
                throw new Error(
                  'vigencia_meses debe ser entero entre 1 y 60 (default 12 meses = 1 año).'
                );
              }
              return n;
            })();
      const notas = truncate(req.body?.notas || req.body?.observaciones, 500);
      const documentoFilterRaw = req.body?.solo_documentos || req.body?.documentos;
      const documentosFilter = Array.isArray(documentoFilterRaw)
        ? documentoFilterRaw.map((d) => String(d).trim()).filter(Boolean)
        : [];

      client = await pool.connect();
      await client.query('BEGIN');

      const sesionRs = await client.query(
        `SELECT s.id, s.codigo_curso, s.nombre_curso_snapshot, s.facultad_id, s.ual_id, s.estado, s.fecha_fin
         FROM sesion_capacitacion s
        WHERE ${clauses.join(' AND ')} LIMIT 1`,
        params
      );
      if (sesionRs.rows.length === 0) {
        await client.query('ROLLBACK');
        return notFound(res, 'Sesión no existe o está fuera de su scope.');
      }
      const sesion = sesionRs.rows[0];
      if (sesion.estado === 'cancelada') {
        await client.query('ROLLBACK');
        return badRequest(res, 'No se puede certificar una sesión cancelada.');
      }

      const asistenciaWhere = ['a.sesion_capacitacion_id = $1', 'a.asistio = TRUE'];
      const asistenciaParams = [sesionId];
      if (documentosFilter.length > 0) {
        asistenciaParams.push(documentosFilter);
        asistenciaWhere.push('a.usuario_documento = ANY($' + asistenciaParams.length + '::text[])');
      }
      const asistentes = await client.query(
        `
      SELECT a.usuario_documento,
             a.usuario_documento AS doc,
             i.usuario_nombre,
             MAX(a.fecha_registro) AS ultima_asistencia
        FROM asistencia_capacitacion a
        JOIN inscripcion_sesion_capacitacion i
          ON i.id = a.inscripcion_sesion_capacitacion_id
       WHERE ${asistenciaWhere.join(' AND ')}
       GROUP BY a.usuario_documento, i.usuario_nombre
       ORDER BY ultima_asistencia ASC
       LIMIT 5000
      `,
        asistenciaParams
      );

      if (asistentes.rows.length === 0) {
        await client.query('ROLLBACK');
        return badRequest(
          res,
          'No hay usuarios con asistencia = TRUE para certificar. Primero registra la asistencia o confirma el filtro de documentos.'
        );
      }

      const labDocRaw = getSessionDocument(req);
      const labDoc = labDocRaw ? String(labDocRaw).trim() : '';
      if (!labDoc) {
        await client.query('ROLLBACK');
        return badRequest(
          res,
          'No se pudo identificar el documento del laboratorista/admin en sesión. Cierre sesión y vuelva a ingresar para certificar.'
        );
      }
      const labNombre = getSessionUserNombre(req);
      let certificados = [];
      let rechazados = [];

      for (let i = 0; i < asistentes.rows.length; i++) {
        const row = asistentes.rows[i];
        const doc = String(row.usuario_documento || '').trim();
        if (!doc) continue;

        const spName = 'sp_cert_u_' + i;
        try {
          await client.query('SAVEPOINT ' + spName);
        } catch {
          /* ignore */
        }

        try {
          const userInfo = await client.query(
            `SELECT id, documento, tipo FROM usuario WHERE documento = $1 LIMIT 1`,
            [doc]
          );
          const usuarioId = userInfo.rows[0]?.id || null;
          const usuarioNombre = truncate(row.usuario_nombre, 255) || userInfo.rows[0]?.tipo || null;

          const existenteVigente = await client.query(
            `SELECT id, fecha_emision, fecha_vencimiento, vigencia_meses
               FROM certificacion_usuario
              WHERE codigo_curso = $1
                AND usuario_documento = $2
                AND activo = TRUE
              ORDER BY fecha_emision DESC LIMIT 1`,
            [sesion.codigo_curso, doc]
          );
          if (existenteVigente.rows.length > 0) {
            rechazados.push({
              usuario_documento: doc,
              usuario_nombre: usuarioNombre,
              motivo: 'Ya tenía una certificación activa vigente para este curso (no se duplicó).',
              id_cert_existente: existenteVigente.rows[0].id,
              vencimiento_existente: existenteVigente.rows[0].fecha_vencimiento,
            });
            try {
              await client.query('RELEASE SAVEPOINT ' + spName);
            } catch {
              /* ignore */
            }
            continue;
          }

          const insertSql = `
            INSERT INTO certificacion_usuario (
              codigo_curso,
              nombre_curso_snapshot,
              facultad_id,
              usuario_documento,
              usuario_id,
              usuario_nombre,
              modalidad,
              fecha_emision,
              fecha_vencimiento,
              vigencia_meses,
              sesion_capacitacion_id,
              ual_id,
              certificado_por_laboratorista_doc,
              certificado_por_laboratorista_nombre,
              notas
            ) VALUES ($1, $2, $3, $4, $5, $6, 'programada',
              CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP + (INTERVAL '1 month' * $7),
              $7, $8, $9, $10, $11, $12)
            RETURNING id, codigo_curso, nombre_curso_snapshot, usuario_documento, fecha_emision, fecha_vencimiento, vigencia_meses
          `;
          const insertParams = [
            sesion.codigo_curso,
            sesion.nombre_curso_snapshot,
            sesion.facultad_id,
            doc,
            usuarioId,
            usuarioNombre,
            vigenciaMeses,
            sesionId,
            sesion.ual_id,
            labDoc,
            labNombre,
            notas,
          ];
          const inserted = await client.query(insertSql, insertParams);
          if (inserted.rows.length > 0) {
            certificados.push(inserted.rows[0]);
            await client.query(
              `UPDATE certificacion_usuario
                  SET activo = FALSE, fecha_modificacion = CURRENT_TIMESTAMP
                WHERE codigo_curso = $1
                  AND usuario_documento = $2
                  AND activo = TRUE
                  AND modalidad = 'programada'
                  AND id <> $3`,
              [sesion.codigo_curso, doc, inserted.rows[0].id]
            );
          } else {
            rechazados.push({
              usuario_documento: doc,
              usuario_nombre: usuarioNombre,
              motivo:
                'No se pudo emitir la certificación: INSERT no retornó filas (restricción de BD / FK).',
            });
          }
          try {
            await client.query('RELEASE SAVEPOINT ' + spName);
          } catch {
            /* ignore */
          }
        } catch (errUsuario) {
          try {
            await client.query('ROLLBACK TO SAVEPOINT ' + spName);
            await client.query('RELEASE SAVEPOINT ' + spName);
          } catch {
            /* ignore */
          }
          rechazados.push({
            usuario_documento: doc,
            usuario_nombre: row.usuario_nombre || null,
            motivo:
              'Error individual al certificar: ' +
              (errUsuario && errUsuario.message ? String(errUsuario.message) : String(errUsuario)),
          });
        }
      }

      const finalizarSesion =
        String(req.body?.finalizar_sesion || 'true').toLowerCase() !== 'false';
      if (finalizarSesion && sesion.estado !== 'realizada') {
        const spFin = 'sp_cert_fin_sesion';
        try {
          await client.query('SAVEPOINT ' + spFin);
          await client.query(
            `UPDATE sesion_capacitacion SET estado = 'realizada', fecha_modificacion = CURRENT_TIMESTAMP WHERE id = $1`,
            [sesionId]
          );
          try {
            await client.query('RELEASE SAVEPOINT ' + spFin);
          } catch {
            /* ignore */
          }
        } catch (errFin) {
          try {
            await client.query('ROLLBACK TO SAVEPOINT ' + spFin);
            await client.query('RELEASE SAVEPOINT ' + spFin);
          } catch {
            /* ignore */
          }
          rechazados.push({
            usuario_documento: '__sesion__',
            usuario_nombre: 'Marcar sesión Realizada',
            motivo:
              'No se pudo marcar la sesión como Realizada (los certificados SÍ fueron emitidos): ' +
              (errFin && errFin.message ? String(errFin.message) : String(errFin)),
          });
        }
      }

      await client.query('COMMIT');
      return okJson(res, {
        sesion_id: sesionId,
        total_procesados: asistentes.rows.length,
        total_certificados: certificados.length,
        total_ya_certificados: rechazados.length,
        vigencia_meses: vigenciaMeses,
        sesion_estado_resultante: finalizarSesion ? 'realizada' : sesion.estado,
        certificados: certificados,
        ya_certificados_omitidos: rechazados,
        message:
          certificados.length > 0
            ? certificados.length +
              ' usuario(s) certificado(s) exitosamente. Ahora cuentan con la certificación local vigente por ' +
              vigenciaMeses +
              ' meses y pueden reservar equipos que requieran este curso sin consultar EDX.'
            : 'Ningún usuario nuevo fue certificado. Todos los asistentes ya contaban con certificación vigente para este curso.',
      });
    } catch (err) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
      }
      return serverError(res, err, 'No fue posible certificar a los asistentes de la sesión.');
    } finally {
      if (client) client.release();
    }
  }
);

/* ============================================================
   7. REPORTE CAPACITACIONES (JSON + CSV) — Task 7
   ============================================================ */

async function buildReporteFiltrosYScope(req) {
  const scope = await resolveLaboratoristaScope(req);

  const estadoRaw =
    String(req.query?.estado || '')
      .trim()
      .toLowerCase() || null;
  const estadoValido = estadoRaw && SESION_ESTADOS.has(estadoRaw) ? estadoRaw : null;
  const codigoCurso = truncate(req.query?.codigo_curso || req.query?.curso || '', 80);
  const ualIdRaw = req.query?.ual_id || req.query?.lugar_id || req.query?.laboratorio_id;
  const ualId = ualIdRaw && String(ualIdRaw).trim() !== '' ? parsePosInt(ualIdRaw, 'ual_id') : null;
  const facultadIdRaw = req.query?.facultad_id;
  const facultadId =
    facultadIdRaw && String(facultadIdRaw).trim() !== ''
      ? parsePosInt(facultadIdRaw, 'facultad_id')
      : null;
  const desdeRaw = req.query?.desde || req.query?.fecha_desde;
  const hastaRaw = req.query?.hasta || req.query?.fecha_hasta;
  const desde = desdeRaw ? new Date(desdeRaw) : null;
  const hasta = hastaRaw ? new Date(hastaRaw) : null;
  if (desde && isNaN(desde.getTime())) {
    const e = new Error('Parametro desde/fecha_desde inválido. Use ISO 8601 (yyyy-mm-dd).');
    e.status = 400;
    throw e;
  }
  if (hasta && isNaN(hasta.getTime())) {
    const e = new Error('Parametro hasta/fecha_hasta inválido. Use ISO 8601 (yyyy-mm-dd).');
    e.status = 400;
    throw e;
  }

  const clauses = ['s.activo = TRUE'];
  const params = [];
  if (estadoValido) {
    params.push(estadoValido);
    clauses.push('s.estado = $' + params.length);
  }
  if (codigoCurso) {
    params.push(codigoCurso);
    clauses.push('s.codigo_curso = $' + params.length);
  }
  if (ualId) {
    params.push(ualId);
    clauses.push('s.ual_id = $' + params.length);
  }
  if (facultadId) {
    params.push(facultadId);
    clauses.push('s.facultad_id = $' + params.length);
  }
  if (desde) {
    params.push(desde);
    clauses.push('s.fecha_fin >= $' + params.length);
  }
  if (hasta) {
    params.push(hasta);
    clauses.push('s.fecha_inicio <= $' + params.length);
  }

  if (!scope.isAdmin) {
    if (scope.ualIds.length > 0 || scope.facultyIds.length > 0) {
      if (scope.ualIds.length > 0) {
        params.push(scope.ualIds);
        clauses.push('s.ual_id = ANY($' + params.length + '::int[])');
      }
      if (scope.facultyIds.length > 0) {
        params.push(scope.facultyIds);
        clauses.push('(s.ual_id IS NULL OR s.facultad_id = ANY($' + params.length + '::int[]))');
      }
    } else {
      clauses.push('FALSE');
    }
  }

  return {
    scope,
    clauses,
    params,
    filtrosAplicados: {
      estado: estadoValido,
      codigo_curso: codigoCurso || null,
      ual_id: ualId,
      facultad_id: facultadId,
      desde: desde ? desde.toISOString() : null,
      hasta: hasta ? hasta.toISOString() : null,
    },
  };
}

function buildReporteAggregateSql(clauses, params, extraLimit) {
  const where = clauses.length ? ' WHERE ' + clauses.join(' AND ') : '';
  const paging = extraLimit ? ' LIMIT ' + extraLimit : '';
  return `
    SELECT s.id AS sesion_id,
           s.codigo_curso,
           COALESCE(s.nombre_curso_snapshot, c.nombre_curso) AS nombre_curso,
           s.facultad_id,
           f.nombre AS facultad_nombre,
           s.ual_id,
           u.nombre AS ual_nombre,
           u.codigo_abreviacion AS ual_codigo,
           s.fecha_inicio,
           s.fecha_fin,
           s.cupo_maximo,
           s.lugar,
           s.estado,
           s.evidencia_path,
           s.evidencia_mime,
           s.evidencia_nombre_original,
           s.evidencia_fecha_subida,
           s.laboratorista_responsable_doc AS laboratorista_doc,
           s.laboratorista_responsable_nombre AS laboratorista_nombre,
           (SELECT COUNT(*)::int
              FROM inscripcion_sesion_capacitacion i
             WHERE i.sesion_capacitacion_id = s.id
               AND i.estado = 'inscrito'
               AND i.activo = TRUE) AS inscritos,
           (SELECT COUNT(*)::int
              FROM asistencia_capacitacion a
             WHERE a.sesion_capacitacion_id = s.id
               AND a.asistio = TRUE
               AND a.activo = TRUE) AS asistentes,
           (SELECT COUNT(*)::int
              FROM certificacion_usuario cert
             WHERE cert.sesion_capacitacion_id = s.id
               AND cert.activo = TRUE) AS certificados_emitidos,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM certificacion_usuario cert
                WHERE cert.sesion_capacitacion_id = s.id
                  AND cert.activo = TRUE
                  AND cert.modalidad = 'prestamo'
                LIMIT 1
             ) THEN 'prestamo'
             ELSE 'programada'
           END AS modalidad,
           s.fecha_creacion,
           s.fecha_modificacion
      FROM sesion_capacitacion s
      LEFT JOIN cursos c ON c.codigo_curso = s.codigo_curso
      LEFT JOIN ual u    ON u.ual_id = s.ual_id
      LEFT JOIN facultad f ON f.facultad_id = s.facultad_id
    ${where}
     ORDER BY s.fecha_inicio DESC, s.id DESC
    ${paging}
  `;
}

router.get('/gestion/reporte', requireLaboratoristaOAdmin, async function (req, res) {
  try {
    const { scope, clauses, params, filtrosAplicados } = await buildReporteFiltrosYScope(req);
    const sql = buildReporteAggregateSql(clauses, params, 10000);
    const rs = await pool.query(sql, params);
    return okJson(res, {
      filas: rs.rows.length,
      reporte: rs.rows,
      filtros_aplicados: filtrosAplicados,
      scope: {
        is_admin: scope.isAdmin,
        ual_ids: scope.ualIds,
        faculty_ids: scope.facultyIds,
        resolved_from: scope.resolvedFrom,
      },
    });
  } catch (err) {
    if (err && err.status === 400) return badRequest(res, err.message);
    return serverError(
      res,
      err,
      'No fue posible generar el reporte de capacitaciones.',
      (function () {
        try {
          const out = {};
          if (req?.query) out.query_params = req.query;
          return out;
        } catch {
          return {};
        }
      })()
    );
  }
});

router.get('/gestion/reporte.csv', requireLaboratoristaOAdmin, async function (req, res) {
  try {
    const { scope, clauses, params, filtrosAplicados } = await buildReporteFiltrosYScope(req);
    const sql = buildReporteAggregateSql(clauses, params, 100000);
    const rs = await pool.query(sql, params);

    const HEADER_CSV = [
      'Sesion ID',
      'Curso Código',
      'Curso Nombre',
      'Facultad',
      'UAL / Laboratorio Código',
      'UAL / Laboratorio Nombre',
      'Fecha Inicio',
      'Fecha Fin',
      'Cupo Máximo',
      'Inscritos',
      'Asistentes',
      'Certificados Emitidos',
      'Modalidad',
      'Estado',
      'Evidencia',
      'Laboratorista Responsable Documento',
      'Laboratorista Responsable Nombre',
    ];

    function esc(v) {
      if (v === null || v === undefined || v === '') return '';
      let s = String(v).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
      if (/[",;]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function fmtFechaLocal(v) {
      if (!v) return '';
      const d = v instanceof Date ? v : new Date(v);
      if (isNaN(d.getTime())) return esc(v);
      const pad = (n) => String(n).padStart(2, '0');
      return (
        d.getFullYear() +
        '-' +
        pad(d.getMonth() + 1) +
        '-' +
        pad(d.getDate()) +
        ' ' +
        pad(d.getHours()) +
        ':' +
        pad(d.getMinutes())
      );
    }

    const lines = [];
    lines.push(HEADER_CSV.map(esc).join(';'));
    for (const r of rs.rows) {
      lines.push(
        [
          r.sesion_id,
          r.codigo_curso,
          r.nombre_curso,
          r.facultad_nombre,
          r.ual_codigo,
          r.ual_nombre,
          fmtFechaLocal(r.fecha_inicio),
          fmtFechaLocal(r.fecha_fin),
          r.cupo_maximo,
          r.inscritos,
          r.asistentes,
          r.certificados_emitidos,
          r.modalidad === 'prestamo' ? 'Durante entrega préstamo' : 'Sesión programada',
          String(r.estado || '').toUpperCase(),
          r.evidencia_nombre_original || r.evidencia_path || '',
          r.laboratorista_doc,
          r.laboratorista_nombre,
        ]
          .map(esc)
          .join(';')
      );
    }

    const csvBody = '\uFEFF' + lines.join('\r\n');
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp =
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      '_' +
      pad(now.getHours()) +
      pad(now.getMinutes());
    const filename = `reporte_capacitaciones_${stamp}.csv`;
    setCacheDynamic(res);

    res
      .status(200)
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="' + filename + '"')
      .header('X-Reporte-Filas', String(rs.rows.length))
      .header('X-Scope-Is-Admin', scope.isAdmin ? '1' : '0')
      .header('X-Filtros-Aplicados', encodeURIComponent(JSON.stringify(filtrosAplicados || {})))
      .send(csvBody);
  } catch (err) {
    if (err && err.status === 400) {
      return res
        .status(400)
        .header('Content-Type', 'text/plain; charset=utf-8')
        .send('ERROR: ' + (err.message || 'Parámetros inválidos.'));
    }
    return serverError(
      res,
      err,
      'No fue posible generar el archivo CSV del reporte de capacitaciones.',
      (function () {
        try {
          return { query_params: req?.query || {} };
        } catch {
          return {};
        }
      })()
    );
  }
});

router.get('/gestion/reporte.json', requireLaboratoristaOAdmin, async function (req, res) {
  try {
    const { scope, clauses, params, filtrosAplicados } = await buildReporteFiltrosYScope(req);
    const sql = buildReporteAggregateSql(clauses, params, 100000);
    const rs = await pool.query(sql, params);

    const payload = {
      nombre_reporte: 'reporte_capacitaciones',
      generado_en: new Date().toISOString(),
      filas: rs.rows.length,
      filtros_aplicados: filtrosAplicados || null,
      scope: {
        is_admin: scope.isAdmin,
        ual_ids: scope.ualIds,
        faculty_ids: scope.facultyIds,
        resolved_from: scope.resolvedFrom,
      },
      reporte: rs.rows,
    };

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp =
      now.getFullYear() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      '_' +
      pad(now.getHours()) +
      pad(now.getMinutes());
    const filename = `reporte_capacitaciones_${stamp}.json`;
    const body = JSON.stringify(payload, null, 2);
    setCacheDynamic(res);

    res
      .status(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="' + filename + '"')
      .header('X-Reporte-Filas', String(rs.rows.length))
      .header('X-Scope-Is-Admin', scope.isAdmin ? '1' : '0')
      .send(body);
  } catch (err) {
    if (err && err.status === 400) {
      return res
        .status(400)
        .header('Content-Type', 'application/json; charset=utf-8')
        .send(
          JSON.stringify({ ok: false, error: err.message || 'Parámetros inválidos.' }, null, 2)
        );
    }
    return serverError(
      res,
      err,
      'No fue posible generar el archivo JSON del reporte de capacitaciones.',
      (function () {
        try {
          return { query_params: req?.query || {} };
        } catch {
          return {};
        }
      })()
    );
  }
});

module.exports = router;
