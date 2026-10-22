const crypto = require('crypto');
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');

const pool = require('../../libs/db');
const { buildAppUrl } = require('../../libs/app-url');
const { sendEmailNotification } = require('../../libs/email-notifications');
const { logger } = require('../../libs/logger');
const { requireJsonRoles, requireRoles, requireUser } = require('../middlewares/auth');
const { enrichErrorPayloadForAdmin } = require('../middlewares/error-handler');
const {
  buildParticipantTemplateBuffer,
  generateCertificatePdf,
  hasFileSignature,
  isSafeXlsxArchive,
  normalizeDocument,
  previewParticipantWorkbook,
  validateEventInput,
  validatePdfTemplate,
  validateParticipant,
  validateTemplateConfig,
} = require('../../libs/encuentros');

const router = express.Router();
const STORAGE_ROOT = path.resolve(
  process.env.ENCUENTROS_STORAGE_DIR || path.join(process.cwd(), 'private', 'encuentros')
);
const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;
const MAX_SPREADSHEET_BYTES = 5 * 1024 * 1024;
const MAX_BANNER_BYTES = 3 * 1024 * 1024;

const MANAGER_ROLES = [
  'admin',
  'administrador',
  'administradora',
  'coordinador',
  'coordinador_facultad',
  'coordinador_general',
  'coordinador general',
  'laboratorista',
  'laboratorista_ud',
  'laboratorista_ual',
  'gestor_laboratorio',
];
const requireAuthenticatedJson = (req, res, next) => {
  if (!req.session?.user) {
    return res.status(401).json({ ok: false, message: 'Debes iniciar sesión para continuar.' });
  }
  return next();
};

const requireManager = requireJsonRoles(MANAGER_ROLES, {
  message: 'Solo el personal autorizado puede gestionar encuentros.',
});
const requireAttendanceCorrection = requireJsonRoles(['admin'], {
  message: 'Solo el personal administrador puede corregir asistencias.',
});
const requireEncounterManagerPage = requireRoles(MANAGER_ROLES, {
  message: 'Acceso denegado',
  message2: 'Solo el personal autorizado puede gestionar encuentros.',
  limit: 'loginOnly',
});
const requireEncounterUserPage = requireUser({
  message: 'Acceso denegado',
  message2: 'Debes iniciar sesión para consultar tus logros.',
  limit: 'loginOnly',
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_TEMPLATE_BYTES, files: 2 },
  fileFilter(_req, file, callback) {
    const acceptedTypes = new Map([
      ['plantilla_pdf', new Set(['application/pdf'])],
      ['banner', new Set(['image/png', 'image/jpeg'])],
      ['archivo', new Set(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])],
    ]);
    if (!acceptedTypes.get(file.fieldname)?.has(file.mimetype)) {
      return callback(new Error('Tipo de archivo no permitido.'));
    }
    return callback(null, true);
  },
});

function withUpload(middleware) {
  return (req, res, next) => {
    middleware(req, res, (error) => {
      if (!error) return next();
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({ ok: false, message: error.message || 'Archivo inválido.' });
    });
  };
}

function setNoCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

router.use((req, res, next) => {
  setNoCache(res);
  next();
});

function parsePositiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getSessionUserId(req) {
  return parsePositiveId(req.session?.user?.id);
}

function getSessionDocument(req) {
  return String(
    req.session?.user?.documento_real ||
      req.session?.user?.documento ||
      req.session?.user?.codigo ||
      ''
  ).trim();
}

function getSessionName(req) {
  return String(req.session?.user?.nombre || req.session?.user?.tipo || 'Usuario MiLab').trim();
}

function canAdministerCertificates(req) {
  const roleValues = req.session?.user?.roles || req.session?.user?.tipo || [];
  const roles = Array.isArray(roleValues)
    ? roleValues
    : String(roleValues)
        .split(',')
        .map((role) => role.trim());
  return roles.some((role) =>
    ['admin', 'administrador', 'administradora'].includes(String(role).trim().toLowerCase())
  );
}

function logFailure(req, error, action) {
  (req.log || logger).error({ err: error, action }, 'Error en submódulo Encuentros');
}

function handleServerError(req, res, error, message) {
  logFailure(req, error, 'encuentros_request');
  if (error?.code === '42P01' || error?.code === '42703') {
    return res.status(503).json(
      enrichErrorPayloadForAdmin(
        req,
        {
          ok: false,
          migration_faltante: true,
          message: 'Falta aplicar la migración del submódulo Encuentros.',
          script_requerido: 'sql-scripts/prod/db_structure_certificacion.sql',
        },
        error
      )
    );
  }
  return res.status(500).json(enrichErrorPayloadForAdmin(req, { ok: false, message }, error));
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function writeAudit(client, req, action, eventId) {
  const document = getSessionDocument(req);
  const numericDocument = /^\d{1,16}$/.test(document) ? document : null;
  await client.query(
    'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
    [
      getSessionName(req).slice(0, 500),
      numericDocument,
      `Encuentros: ${action}`.slice(0, 500),
      `Evento #${eventId}`.slice(0, 255),
    ]
  );
}

function resolveStoredPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error('La ruta almacenada del archivo no es válida.');
  }
  const absolutePath = path.resolve(STORAGE_ROOT, relativePath);
  if (!absolutePath.startsWith(`${STORAGE_ROOT}${path.sep}`)) {
    throw new Error('La ruta almacenada del archivo no es válida.');
  }
  return absolutePath;
}

async function saveUpload(file, subdirectory, extension) {
  const relativePath = path.join(subdirectory, `${crypto.randomUUID()}.${extension}`);
  const absolutePath = resolveStoredPath(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, file.buffer, { flag: 'wx', mode: 0o600 });
  return relativePath;
}

async function removeStoredFile(relativePath) {
  if (!relativePath) return;
  try {
    await fs.unlink(resolveStoredPath(relativePath));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function readTemplateConfig(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validateUploadedEventFiles(files) {
  const pdf = files?.plantilla_pdf?.[0];
  const banner = files?.banner?.[0];
  if (pdf && (pdf.size > MAX_TEMPLATE_BYTES || !hasFileSignature(pdf, 'pdf'))) {
    return 'La plantilla debe ser un archivo PDF válido de máximo 8 MB.';
  }
  if (
    banner &&
    (banner.size > MAX_BANNER_BYTES ||
      !(hasFileSignature(banner, 'png') || hasFileSignature(banner, 'jpeg')))
  ) {
    return 'El banner debe ser una imagen PNG o JPEG válida de máximo 3 MB.';
  }
  return null;
}

function formatDateForDisplay(value) {
  const date = String(value || '').slice(0, 10);
  const [year, month, day] = date.split('-');
  return year && month && day ? `${day}/${month}/${year}` : date;
}

function sanitizeDeliveryError(error) {
  return String(error?.message || 'El servicio de correo no confirmó el envío.')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[correo oculto]')
    .replace(/\b\d{6,}\b/g, '[identificador oculto]')
    .slice(0, 1000);
}

async function getRegisteredUserMatch(client, normalizedDocument) {
  const result = await client.query(
    `
      SELECT id
      FROM usuario
      WHERE COALESCE(activo, TRUE) = TRUE
        AND regexp_replace(
          translate(upper(btrim(documento)), 'ÁÉÍÓÚÜÑ', 'AEIOUUN'),
          '[^A-Z0-9]', '', 'g'
        ) = $1
      ORDER BY id
      LIMIT 2
    `,
    [normalizedDocument]
  );
  return result.rows.length === 1 ? result.rows[0].id : null;
}

async function createCertificate(eventId, participantId, req) {
  let createdFilePath;
  try {
    return await withTransaction(async (client) => {
      const participantResult = await client.query(
        `
          SELECT
            p.id AS participante_id,
            p.evento_id,
            p.nombre,
            p.documento,
            p.documento_normalizado,
            p.correo,
            p.rol,
            p.facultad,
            p.laboratorio,
            a.entrada_en,
            a.salida_en,
            e.nombre AS evento,
            e.fecha AS fecha_evento,
            e.lugar,
            e.organizador,
            e.plantilla_pdf_path,
            e.plantilla_config
          FROM encuentro_participante p
          JOIN encuentro_evento e ON e.id = p.evento_id
          JOIN encuentro_asistencia a
            ON a.participante_id = p.id
           AND a.evento_id = p.evento_id
          WHERE e.id = $1
            AND p.id = $2
            AND p.activo = TRUE
            AND a.entrada_en IS NOT NULL
            AND a.salida_en IS NOT NULL
          FOR UPDATE OF p, e
        `,
        [eventId, participantId]
      );
      const participant = participantResult.rows[0];
      if (!participant)
        throw new Error('No se cumplen las condiciones para generar el certificado.');

      const existing = await client.query(
        `SELECT id, estado, email_estado FROM encuentro_certificado
         WHERE evento_id = $1 AND participante_id = $2`,
        [eventId, participantId]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].estado !== 'valido') {
          throw new Error('El certificado de esta participación está anulado.');
        }
        return existing.rows[0];
      }

      const config = participant.plantilla_config;
      const configErrors = validateTemplateConfig(config);
      if (configErrors.length) throw new Error(configErrors.join(' '));

      const code = crypto.randomBytes(12).toString('hex').toUpperCase();
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const emittedAt = new Intl.DateTimeFormat('es-CO', {
        dateStyle: 'long',
        timeZone: 'America/Bogota',
      }).format(new Date());
      const values = {
        nombre: participant.nombre,
        documento: participant.documento,
        correo: participant.correo,
        rol: participant.rol,
        facultad: participant.facultad,
        laboratorio: participant.laboratorio,
        evento: participant.evento,
        fecha_evento: formatDateForDisplay(participant.fecha_evento),
        lugar: participant.lugar,
        organizador: participant.organizador,
        fecha_emision: emittedAt,
        codigo_certificado: code,
      };
      const certificateSnapshot = Object.fromEntries(
        Object.keys(config)
          .filter((key) => key !== 'qr_verificacion')
          .map((key) => [key, values[key] || ''])
      );
      const templateBuffer = await fs.readFile(resolveStoredPath(participant.plantilla_pdf_path));
      const pdfBuffer = await generateCertificatePdf({
        templateBuffer,
        templateConfig: config,
        values,
        verificationUrl: buildAppUrl(`/encuentros/verificar/${verificationToken}`),
      });
      createdFilePath = path.join('certificates', String(eventId), `${code}.pdf`);
      const absoluteCertificatePath = resolveStoredPath(createdFilePath);
      await fs.mkdir(path.dirname(absoluteCertificatePath), { recursive: true });
      await fs.writeFile(absoluteCertificatePath, pdfBuffer, { flag: 'wx', mode: 0o600 });

      const inserted = await client.query(
        `
          INSERT INTO encuentro_certificado (
            evento_id, participante_id, codigo, token_verificacion,
            archivo_actual, datos_snapshot, creado_por_usuario_id
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
          RETURNING id, estado, email_estado
        `,
        [
          eventId,
          participantId,
          code,
          verificationToken,
          createdFilePath,
          JSON.stringify(certificateSnapshot),
          getSessionUserId(req),
        ]
      );
      const certificate = inserted.rows[0];
      await client.query(
        `
          INSERT INTO encuentro_certificado_version (
            certificado_id, numero_version, archivo_path,
            plantilla_config_snapshot, datos_snapshot, generado_por_usuario_id
          )
          VALUES ($1, 1, $2, $3::jsonb, $4::jsonb, $5)
        `,
        [
          certificate.id,
          createdFilePath,
          JSON.stringify(config),
          JSON.stringify(certificateSnapshot),
          getSessionUserId(req),
        ]
      );
      await writeAudit(client, req, 'certificado generado', eventId);
      return certificate;
    });
  } catch (error) {
    if (createdFilePath) await removeStoredFile(createdFilePath);
    throw error;
  }
}

async function awardMedal(certificateId, req) {
  return withTransaction(async (client) => {
    const eligibleResult = await client.query(
      `
        SELECT
          c.id AS certificado_id,
          c.evento_id,
          c.participante_id,
          p.documento_normalizado,
          a.entrada_en,
          a.salida_en,
          c.estado AS certificado_estado,
          c.email_estado
        FROM encuentro_certificado c
        JOIN encuentro_participante p
          ON p.id = c.participante_id
         AND p.evento_id = c.evento_id
        JOIN encuentro_asistencia a
          ON a.participante_id = p.id
         AND a.evento_id = p.evento_id
        WHERE c.id = $1
        FOR UPDATE OF c
      `,
      [certificateId]
    );
    const row = eligibleResult.rows[0];
    if (
      !row ||
      !row.entrada_en ||
      !row.salida_en ||
      row.certificado_estado !== 'valido' ||
      row.email_estado !== 'enviado'
    ) {
      return { otorgada: false, motivo: 'no_cumple_condiciones' };
    }

    const userId = await getRegisteredUserMatch(client, row.documento_normalizado);
    if (!userId) return { otorgada: false, motivo: 'usuario_inexistente_o_ambiguo' };

    const participantIdentity = await client.query(
      `
        UPDATE encuentro_participante
        SET usuario_id = $2, fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $1 AND evento_id = $3 AND (usuario_id IS NULL OR usuario_id = $2)
        RETURNING usuario_id
      `,
      [row.participante_id, userId, row.evento_id]
    );
    if (!participantIdentity.rows[0]) {
      return { otorgada: false, motivo: 'identidad_participante_inconsistente' };
    }

    const result = await client.query(
      `
        INSERT INTO encuentro_logro (evento_id, participante_id, usuario_id, certificado_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT DO NOTHING
        RETURNING id
      `,
      [row.evento_id, row.participante_id, userId, row.certificado_id]
    );
    if (result.rows[0]) {
      await writeAudit(client, req, 'medalla asignada', row.evento_id);
      return { otorgada: true };
    }
    return { otorgada: false, motivo: 'ya_otorgada' };
  });
}

async function deliverCertificate(certificateId, req) {
  const claim = await withTransaction(async (client) => {
    const currentResult = await client.query(
      `
        SELECT
          c.id,
          c.evento_id,
          c.estado AS certificado_estado,
          c.email_estado,
          c.intentos_email,
          c.archivo_actual,
          p.nombre AS participante_nombre,
          p.correo,
          e.nombre AS evento
        FROM encuentro_certificado c
        JOIN encuentro_participante p
          ON p.id = c.participante_id
         AND p.evento_id = c.evento_id
        JOIN encuentro_evento e ON e.id = c.evento_id
        WHERE c.id = $1
        FOR UPDATE OF c
      `,
      [certificateId]
    );
    const current = currentResult.rows[0];
    if (!current) return { status: 'not_found' };
    if (current.certificado_estado !== 'valido') return { status: 'annulled' };
    if (current.email_estado === 'enviado') return { status: 'sent', current };

    const claimed = await client.query(
      `
        UPDATE encuentro_certificado
        SET email_estado = 'enviando',
            intentos_email = intentos_email + 1,
            email_lease_hasta = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
            email_error = NULL,
            fecha_modificacion = CURRENT_TIMESTAMP
        WHERE id = $1
          AND (
            email_estado <> 'enviando'
            OR email_lease_hasta < CURRENT_TIMESTAMP
          )
        RETURNING intentos_email
      `,
      [certificateId]
    );
    if (!claimed.rows[0]) return { status: 'sending' };

    await client.query(
      `
        INSERT INTO encuentro_envio_certificado (
          certificado_id, intento, estado, iniciado_por_usuario_id
        )
        VALUES ($1, $2, 'enviando', $3)
      `,
      [certificateId, claimed.rows[0].intentos_email, getSessionUserId(req)]
    );
    await writeAudit(client, req, 'intento de envío de certificado', current.evento_id);
    return {
      status: 'claimed',
      current,
      attempt: claimed.rows[0].intentos_email,
    };
  });

  if (claim.status === 'not_found' || claim.status === 'annulled' || claim.status === 'sending') {
    return claim;
  }
  if (claim.status === 'sent') {
    const medal = await awardMedal(certificateId, req);
    return { status: 'sent', medal };
  }

  try {
    const notification = await sendEmailNotification({
      sourceSystem: 'encuentros',
      templateName: 'encuentros/certificado-participacion',
      recipient: claim.current.correo,
      subject: `Tu certificado de participación: ${claim.current.evento}`,
      variables: {
        participanteNombre: claim.current.participante_nombre,
        eventoNombre: claim.current.evento,
      },
      correlationId: String(certificateId),
      attachments: [
        {
          filename: `certificado-${certificateId}.pdf`,
          path: resolveStoredPath(claim.current.archivo_actual),
          contentType: 'application/pdf',
        },
      ],
    });
    if (notification.status !== 'SENT') {
      throw new Error(notification.error || 'El servicio de correo no confirmó el envío.');
    }

    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE encuentro_certificado
          SET email_estado = 'enviado',
              email_enviado_en = CURRENT_TIMESTAMP,
              email_lease_hasta = NULL,
              email_error = NULL,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [certificateId]
      );
      await client.query(
        `
          UPDATE encuentro_envio_certificado
          SET estado = 'enviado'
          WHERE certificado_id = $1 AND intento = $2
        `,
        [certificateId, claim.attempt]
      );
      const eventResult = await client.query(
        'SELECT evento_id FROM encuentro_certificado WHERE id = $1',
        [certificateId]
      );
      await writeAudit(client, req, 'certificado enviado', eventResult.rows[0].evento_id);
    });
    const medal = await awardMedal(certificateId, req);
    return { status: 'sent', medal };
  } catch (error) {
    const errorMessage = sanitizeDeliveryError(error);
    await withTransaction(async (client) => {
      await client.query(
        `
          UPDATE encuentro_certificado
          SET email_estado = 'error',
              email_lease_hasta = NULL,
              email_error = $2,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1 AND email_estado = 'enviando'
        `,
        [certificateId, errorMessage]
      );
      await client.query(
        `
          UPDATE encuentro_envio_certificado
          SET estado = 'error', error = $3
          WHERE certificado_id = $1 AND intento = $2
        `,
        [certificateId, claim.attempt, errorMessage]
      );
      const eventResult = await client.query(
        'SELECT evento_id FROM encuentro_certificado WHERE id = $1',
        [certificateId]
      );
      if (eventResult.rows[0]) {
        await writeAudit(
          client,
          req,
          'error en envío de certificado',
          eventResult.rows[0].evento_id
        );
      }
    });
    logFailure(req, new Error(errorMessage), 'certificate_email');
    return { status: 'error' };
  }
}

async function fetchEventDetail(eventId) {
  const eventResult = await pool.query(
    `
      SELECT
        e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
        e.lugar, e.organizador, e.banner_path, e.plantilla_config, e.estado, e.fecha_creacion,
        COUNT(DISTINCT p.id)::int AS total_participantes,
        COUNT(DISTINCT p.id) FILTER (WHERE a.entrada_en IS NOT NULL)::int AS entradas,
        COUNT(DISTINCT p.id) FILTER (WHERE a.salida_en IS NOT NULL)::int AS salidas,
        COUNT(DISTINCT p.id) FILTER (
          WHERE p.id IS NOT NULL AND a.entrada_en IS NULL
        )::int AS sin_entrada,
        COUNT(DISTINCT p.id) FILTER (
          WHERE a.entrada_en IS NOT NULL AND a.salida_en IS NULL
        )::int AS dentro_sin_salida,
        COUNT(DISTINCT c.id)::int AS certificados_generados,
        COUNT(DISTINCT c.id) FILTER (WHERE c.email_estado = 'enviado')::int AS certificados_enviados,
        COUNT(DISTINCT c.id) FILTER (
          WHERE c.email_estado IN ('pendiente', 'enviando')
        )::int AS certificados_pendientes,
        COUNT(DISTINCT c.id) FILTER (WHERE c.email_estado = 'error')::int AS certificados_con_error
      FROM encuentro_evento e
      LEFT JOIN encuentro_participante p ON p.evento_id = e.id AND p.activo = TRUE
      LEFT JOIN encuentro_asistencia a
        ON a.participante_id = p.id AND a.evento_id = e.id AND a.activo = TRUE
      LEFT JOIN encuentro_certificado c
        ON c.participante_id = p.id AND c.evento_id = e.id AND c.activo = TRUE
      WHERE e.id = $1 AND e.activo = TRUE
      GROUP BY e.id
    `,
    [eventId]
  );
  const event = eventResult.rows[0];
  if (!event) return null;

  const participantsResult = await pool.query(
    `
      SELECT
        p.id, p.nombre, p.documento, p.correo, p.rol, p.facultad, p.laboratorio,
        a.entrada_en, a.salida_en,
        CASE
          WHEN a.salida_en IS NOT NULL THEN 'completada'
          WHEN a.entrada_en IS NOT NULL THEN 'en_curso'
          ELSE 'sin_entrada'
        END AS estado_asistencia,
        c.id AS certificado_id,
        c.codigo AS codigo_certificado,
        c.email_estado AS estado_certificado,
        c.estado AS validez_certificado
      FROM encuentro_participante p
      LEFT JOIN encuentro_asistencia a
        ON a.participante_id = p.id AND a.evento_id = p.evento_id AND a.activo = TRUE
      LEFT JOIN encuentro_certificado c
        ON c.participante_id = p.id AND c.evento_id = p.evento_id AND c.activo = TRUE
      WHERE p.evento_id = $1 AND p.activo = TRUE
      ORDER BY p.nombre, p.id
    `,
    [eventId]
  );

  const total = Number(event.total_participantes) || 0;
  const entries = Number(event.entradas) || 0;
  const exits = Number(event.salidas) || 0;
  return {
    evento: event,
    participantes: participantsResult.rows,
    estadisticas: {
      ...event,
      porcentaje_asistencia: total ? Number(((entries / total) * 100).toFixed(2)) : 0,
      porcentaje_completado: total ? Number(((exits / total) * 100).toFixed(2)) : 0,
    },
  };
}

async function fetchEventReportData(eventId) {
  const eventResult = await pool.query(
    `
      SELECT
        e.id, e.nombre, e.fecha, e.hora_inicio, e.hora_fin,
        e.lugar, e.organizador, e.estado,
        COUNT(DISTINCT p.id)::int AS total_participantes,
        COUNT(DISTINCT p.id) FILTER (WHERE a.entrada_en IS NOT NULL)::int AS entradas,
        COUNT(DISTINCT p.id) FILTER (WHERE a.salida_en IS NOT NULL)::int AS salidas,
        COUNT(DISTINCT p.id) FILTER (
          WHERE p.id IS NOT NULL AND a.entrada_en IS NULL
        )::int AS sin_entrada,
        COUNT(DISTINCT p.id) FILTER (
          WHERE a.entrada_en IS NOT NULL AND a.salida_en IS NULL
        )::int AS dentro_sin_salida,
        COUNT(DISTINCT c.id)::int AS certificados_generados,
        COUNT(DISTINCT c.id) FILTER (WHERE c.email_estado = 'enviado')::int AS certificados_enviados,
        COUNT(DISTINCT c.id) FILTER (
          WHERE c.email_estado IN ('pendiente', 'enviando')
        )::int AS certificados_pendientes,
        COUNT(DISTINCT c.id) FILTER (WHERE c.email_estado = 'error')::int AS certificados_con_error
      FROM encuentro_evento e
      LEFT JOIN encuentro_participante p ON p.evento_id = e.id AND p.activo = TRUE
      LEFT JOIN encuentro_asistencia a
        ON a.participante_id = p.id AND a.evento_id = e.id AND a.activo = TRUE
      LEFT JOIN encuentro_certificado c
        ON c.participante_id = p.id AND c.evento_id = e.id AND c.activo = TRUE
      WHERE e.id = $1 AND e.activo = TRUE
      GROUP BY e.id
    `,
    [eventId]
  );
  const event = eventResult.rows[0];
  if (!event) return null;
  if (event.estado !== 'finalizado') return { event, faculties: [] };

  const facultiesResult = await pool.query(
    `
      SELECT
        COALESCE(NULLIF(BTRIM(p.facultad), ''), 'Facultad no especificada') AS facultad,
        COUNT(DISTINCT p.id)::int AS registrados,
        COUNT(DISTINCT p.id) FILTER (WHERE a.entrada_en IS NOT NULL)::int AS con_entrada,
        COUNT(DISTINCT p.id) FILTER (WHERE a.salida_en IS NOT NULL)::int AS completaron
      FROM encuentro_participante p
      LEFT JOIN encuentro_asistencia a
        ON a.participante_id = p.id AND a.evento_id = p.evento_id AND a.activo = TRUE
      WHERE p.evento_id = $1 AND p.activo = TRUE
      GROUP BY COALESCE(NULLIF(BTRIM(p.facultad), ''), 'Facultad no especificada')
      ORDER BY registrados ASC, facultad ASC
    `,
    [eventId]
  );

  return { event, faculties: facultiesResult.rows || [] };
}

function formatReportNumber(value) {
  return new Intl.NumberFormat('es-CO').format(Number(value) || 0);
}

function formatReportPercent(value, total) {
  const percentage = total ? (Number(value) / Number(total)) * 100 : 0;
  return `${new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(percentage)} %`;
}

function formatReportDate(value) {
  const date =
    value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : date || 'No disponible';
}

function renderEventReportPdf({ event, faculties }) {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 42,
      info: { Title: `Informe de encuentro - ${event.nombre}`, Author: 'MiLab' },
    });
    const chunks = [];
    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const contentWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
    const bottomLimit = () => pdf.page.height - pdf.page.margins.bottom;
    const ensureSpace = (height) => {
      if (pdf.y + height > bottomLimit()) pdf.addPage();
    };
    const total = Number(event.total_participantes) || 0;
    const metrics = [
      { label: 'Registrados activos', value: formatReportNumber(total) },
      {
        label: 'Con entrada registrada',
        value: formatReportNumber(event.entradas),
        detail: `${formatReportPercent(event.entradas, total)} de los registrados`,
      },
      {
        label: 'Participación completada',
        value: formatReportNumber(event.salidas),
        detail: `${formatReportPercent(event.salidas, total)} de los registrados`,
      },
      { label: 'Sin entrada', value: formatReportNumber(event.sin_entrada) },
      { label: 'Dentro sin salida', value: formatReportNumber(event.dentro_sin_salida) },
      {
        label: 'Certificados enviados',
        value: `${formatReportNumber(event.certificados_enviados)} / ${formatReportNumber(event.certificados_generados)}`,
      },
      {
        label: 'Certificados pendientes',
        value: formatReportNumber(event.certificados_pendientes),
      },
      { label: 'Certificados con error', value: formatReportNumber(event.certificados_con_error) },
    ];

    pdf.font('Helvetica-Bold').fontSize(21).fillColor('#173B5E').text('Informe del encuentro');
    pdf.moveDown(0.25);
    pdf.font('Helvetica-Bold').fontSize(15).fillColor('#243447').text(event.nombre);
    pdf.moveDown(0.6);

    const startTime = String(event.hora_inicio || '').slice(0, 5);
    const endTime = String(event.hora_fin || '').slice(0, 5);
    const generatedAt = new Intl.DateTimeFormat('es-CO', {
      dateStyle: 'long',
      timeStyle: 'short',
      timeZone: 'America/Bogota',
    }).format(new Date());
    pdf
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#334155')
      .text(`Fecha: ${formatReportDate(event.fecha)}    Horario: ${startTime} - ${endTime}`)
      .text(`Lugar: ${event.lugar || 'No especificado'}`)
      .text(`Organizador: ${event.organizador || 'No especificado'}`)
      .text(`Estado: Finalizado    Informe generado: ${generatedAt}`);
    pdf.moveDown(0.8);

    pdf.font('Helvetica-Bold').fontSize(12).fillColor('#173B5E').text('Resumen del encuentro');
    pdf.moveDown(0.4);
    const cardGap = 10;
    const cardWidth = (contentWidth - cardGap) / 2;
    const cardHeight = 48;
    for (let index = 0; index < metrics.length; index += 2) {
      ensureSpace(cardHeight + 10);
      const rowY = pdf.y;
      [metrics[index], metrics[index + 1]].forEach((metric, columnIndex) => {
        if (!metric) return;
        const x = pdf.page.margins.left + columnIndex * (cardWidth + cardGap);
        pdf.save().fillColor('#F2F6FA').rect(x, rowY, cardWidth, cardHeight).fill().restore();
        pdf
          .save()
          .strokeColor('#D7E0E9')
          .lineWidth(0.7)
          .rect(x, rowY, cardWidth, cardHeight)
          .stroke()
          .restore();
        pdf
          .font('Helvetica')
          .fontSize(8)
          .fillColor('#526273')
          .text(metric.label, x + 9, rowY + 6, { width: cardWidth - 18 });
        pdf
          .font('Helvetica-Bold')
          .fontSize(14)
          .fillColor('#173B5E')
          .text(metric.value, x + 9, rowY + 18, { width: cardWidth - 18 });
        if (metric.detail) {
          pdf
            .font('Helvetica')
            .fontSize(7)
            .fillColor('#526273')
            .text(metric.detail, x + 9, rowY + 35, { width: cardWidth - 18 });
        }
      });
      pdf.y = rowY + cardHeight + 10;
    }

    ensureSpace(60);
    pdf.font('Helvetica-Bold').fontSize(12).fillColor('#173B5E').text('Participación por facultad');
    pdf
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#526273')
      .text(
        'Ordenada de menor a mayor por número de inscritos activos. Los porcentajes se calculan sobre los registros de cada facultad.'
      );
    pdf.moveDown(0.5);

    const columns = [
      { label: 'Facultad', width: 165, align: 'left' },
      { label: 'Inscritos', width: 60, align: 'right' },
      { label: 'Con entrada', width: 72, align: 'right' },
      { label: 'Completaron', width: 72, align: 'right' },
      { label: '% entrada', width: 70, align: 'right' },
      { label: '% completa', width: 72, align: 'right' },
    ];
    const tableX = pdf.page.margins.left;
    const headerHeight = 24;
    const drawTableHeader = () => {
      const y = pdf.y;
      pdf.save().fillColor('#173B5E').rect(tableX, y, contentWidth, headerHeight).fill().restore();
      let x = tableX;
      columns.forEach((column) => {
        pdf
          .font('Helvetica-Bold')
          .fontSize(7.5)
          .fillColor('#FFFFFF')
          .text(column.label, x + 4, y + 7, {
            width: column.width - 8,
            align: column.align,
            lineBreak: false,
          });
        x += column.width;
      });
      pdf.y = y + headerHeight;
    };
    drawTableHeader();

    if (!faculties.length) {
      pdf
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#526273')
        .text('No hay participantes registrados activos.');
    } else {
      faculties.forEach((faculty, index) => {
        const facultyName = faculty.facultad || 'Facultad no especificada';
        pdf.font('Helvetica').fontSize(8);
        const rowHeight = Math.max(
          22,
          pdf.heightOfString(facultyName, { width: columns[0].width - 10 }) + 8
        );
        if (pdf.y + rowHeight > bottomLimit()) {
          pdf.addPage();
          drawTableHeader();
        }
        const rowY = pdf.y;
        if (index % 2 === 1) {
          pdf
            .save()
            .fillColor('#F6F8FA')
            .rect(tableX, rowY, contentWidth, rowHeight)
            .fill()
            .restore();
        }
        const values = [
          facultyName,
          formatReportNumber(faculty.registrados),
          formatReportNumber(faculty.con_entrada),
          formatReportNumber(faculty.completaron),
          formatReportPercent(faculty.con_entrada, faculty.registrados),
          formatReportPercent(faculty.completaron, faculty.registrados),
        ];
        let x = tableX;
        columns.forEach((column, columnIndex) => {
          pdf
            .font('Helvetica')
            .fontSize(8)
            .fillColor('#263445')
            .text(values[columnIndex], x + 4, rowY + 5, {
              width: column.width - 8,
              height: rowHeight - 8,
              align: column.align,
            });
          x += column.width;
        });
        pdf
          .moveTo(tableX, rowY + rowHeight)
          .lineTo(tableX + contentWidth, rowY + rowHeight)
          .strokeColor('#D7E0E9')
          .lineWidth(0.5)
          .stroke();
        pdf.y = rowY + rowHeight;
      });
    }

    ensureSpace(42);
    pdf.moveDown(0.7);
    pdf
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#526273')
      .text(
        'Este informe contiene cifras agregadas de participantes activos; no incluye datos personales.'
      );
    pdf.end();
  });
}

router.get('/gestion', requireEncounterManagerPage, (req, res) => {
  return res.render('home/encuentros-gestion', {
    canAnnulCertificates: canAdministerCertificates(req),
  });
});

router.get('/mis-logros', requireEncounterUserPage, (req, res) => {
  return res.render('home/encuentros-logros');
});

router.get('/verificar/:token', async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(200).render('home/encuentros-verificacion', { certificado: null });
  }

  try {
    const result = await pool.query(
      `
        SELECT
          c.codigo,
          c.estado,
          c.fecha_emision,
          e.nombre AS evento,
          e.fecha AS fecha_evento,
          p.nombre AS participante
        FROM encuentro_certificado c
        JOIN encuentro_evento e ON e.id = c.evento_id
        JOIN encuentro_participante p ON p.id = c.participante_id
        WHERE c.token_verificacion = $1
        LIMIT 1
      `,
      [token]
    );
    return res.status(200).render('home/encuentros-verificacion', {
      certificado: result.rows[0] || null,
    });
  } catch (error) {
    logFailure(req, error, 'public_certificate_verification');
    return res.status(503).render('home/encuentros-verificacion', {
      certificado: null,
      verificationError: true,
    });
  }
});

router.post(
  '/api/plantillas/previsualizar',
  requireManager,
  withUpload(upload.single('plantilla_pdf')),
  async (req, res) => {
    const file = req.file;
    const config = readTemplateConfig(req.body?.plantilla_config);
    if (!file || file.size > MAX_TEMPLATE_BYTES || !hasFileSignature(file, 'pdf')) {
      return res
        .status(400)
        .json({ ok: false, message: 'Carga una plantilla PDF válida de máximo 8 MB.' });
    }
    const configErrors = validateTemplateConfig(config);
    if (configErrors.length)
      return res.status(400).json({ ok: false, message: configErrors.join(' ') });
    try {
      await validatePdfTemplate(file.buffer);
      const sampleValues = {
        nombre: 'Nombre de prueba',
        documento: '00000000',
        correo: 'participante@example.edu',
        rol: 'Cargo de prueba',
        facultad: 'Facultad de prueba',
        laboratorio: 'Laboratorio de prueba',
        evento: 'Encuentro de prueba',
        fecha_evento: new Intl.DateTimeFormat('es-CO', {
          dateStyle: 'short',
          timeZone: 'America/Bogota',
        }).format(new Date()),
        lugar: 'Sede de prueba',
        organizador: 'MiLab',
        fecha_emision: new Intl.DateTimeFormat('es-CO', {
          dateStyle: 'long',
          timeZone: 'America/Bogota',
        }).format(new Date()),
        codigo_certificado: 'VISTA-PREVIA',
      };
      const buffer = await generateCertificatePdf({
        templateBuffer: file.buffer,
        templateConfig: config,
        values: sampleValues,
        verificationUrl: buildAppUrl(
          `/encuentros/verificar/${crypto.randomBytes(32).toString('hex')}`
        ),
      });
      res.type('application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="vista-previa-certificado.pdf"');
      return res.send(buffer);
    } catch (error) {
      logFailure(req, error, 'certificate_template_preview');
      return res.status(400).json({
        ok: false,
        message:
          'No fue posible generar la vista previa. Verifica que el PDF y las coordenadas sean válidos.',
      });
    }
  }
);

const QR_TIPOS = ['ingreso', 'salida'];

// Varios asistentes pueden compartir la misma IP (red del auditorio), por eso el límite es amplio.
const registroQrLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas solicitudes. Inténtalo nuevamente en un momento.' },
});

function buildRegistrationLinks(eventId) {
  return Object.fromEntries(
    QR_TIPOS.map((tipo) => [
      tipo,
      {
        registro_url: buildAppUrl(`/encuentros/registro/${tipo}/${eventId}`),
        proyeccion_url: buildAppUrl(`/encuentros/proyeccion/${tipo}/${eventId}`),
      },
    ])
  );
}

async function writePublicAudit(client, action, eventId, documento) {
  const numericDocument = /^\d{1,16}$/.test(documento) ? documento : null;
  await client.query(
    'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
    [
      'Registro público QR',
      numericDocument,
      `Encuentros: ${action}`.slice(0, 500),
      `Evento #${eventId}`.slice(0, 255),
    ]
  );
}

async function registerPublicAttendance(eventId, tipo, documento) {
  return withTransaction(async (client) => {
    const participantResult = await client.query(
      `
        SELECT p.id, p.nombre, e.estado AS estado_evento
        FROM encuentro_participante p
        JOIN encuentro_evento e ON e.id = p.evento_id
        WHERE p.evento_id = $1
          AND p.documento_normalizado = $2
          AND p.activo = TRUE
          AND e.activo = TRUE
        FOR UPDATE OF p, e
      `,
      [eventId, documento]
    );
    const participant = participantResult.rows[0];
    if (!participant) return { status: 'not_enrolled' };
    if (participant.estado_evento !== 'en_curso') return { status: 'event_not_open' };
    const nombre = String(participant.nombre || '').toLocaleUpperCase('es-CO');

    if (tipo === 'ingreso') {
      const inserted = await client.query(
        `
          INSERT INTO encuentro_asistencia (evento_id, participante_id, entrada_en, entrada_metodo)
          VALUES ($1, $2, CURRENT_TIMESTAMP, 'manual')
          ON CONFLICT (participante_id) DO NOTHING
          RETURNING entrada_en
        `,
        [eventId, participant.id]
      );
      if (!inserted.rows[0]) return { status: 'already_registered', nombre };
      await writePublicAudit(client, 'entrada registrada por QR', eventId, documento);
      return { status: 'registered', nombre };
    }

    const attendance = await client.query(
      `
        SELECT entrada_en, salida_en
        FROM encuentro_asistencia
        WHERE evento_id = $1 AND participante_id = $2 AND activo = TRUE
        FOR UPDATE
      `,
      [eventId, participant.id]
    );
    const current = attendance.rows[0];
    if (!current?.entrada_en) return { status: 'no_entry', nombre };
    if (current.salida_en) return { status: 'already_out', nombre };
    await client.query(
      `
        UPDATE encuentro_asistencia
        SET salida_en = CURRENT_TIMESTAMP, fecha_modificacion = CURRENT_TIMESTAMP
        WHERE evento_id = $1 AND participante_id = $2 AND activo = TRUE
      `,
      [eventId, participant.id]
    );
    await writePublicAudit(client, 'salida registrada por QR', eventId, documento);
    return { status: 'registered', nombre };
  });
}

const PUBLIC_REGISTRO_MESSAGES = {
  registered: {
    ingreso: (nombre) => `${nombre}, su registro de ingreso fue exitoso.`,
    salida: (nombre) => `${nombre}, su registro de salida fue exitoso.`,
  },
  already_registered: (nombre) => `${nombre}, su registro de ingreso ya estaba registrado.`,
  already_out: (nombre) => `${nombre}, su registro de salida ya estaba registrado.`,
  no_entry: (nombre) =>
    `${nombre}, no tiene registro de ingreso en este evento. Por favor acérquese con los organizadores.`,
  not_enrolled: (documento) =>
    `Su documento ${documento} no fue encontrado en la base de registro del evento. Por favor acérquese con los organizadores.`,
  event_not_open: 'El registro no está disponible porque el evento no se encuentra en curso.',
};

function buildPublicRegistroMessage(result, tipo, documento) {
  if (result.status === 'registered')
    return PUBLIC_REGISTRO_MESSAGES.registered[tipo](result.nombre);
  if (result.status === 'not_enrolled') return PUBLIC_REGISTRO_MESSAGES.not_enrolled(documento);
  if (result.status === 'event_not_open') return PUBLIC_REGISTRO_MESSAGES.event_not_open;
  return PUBLIC_REGISTRO_MESSAGES[result.status](result.nombre);
}

function renderInvalidQrLink(res) {
  return res.status(404).render('home/message_error', {
    status: 404,
    message: 'Enlace no válido',
    message2: 'El enlace de registro no existe. Verifica la dirección con los organizadores.',
    limit: null,
  });
}

async function fetchPublicEvent(eventId) {
  const result = await pool.query(
    'SELECT id, nombre, fecha, lugar, estado FROM encuentro_evento WHERE id = $1 AND activo = TRUE',
    [eventId]
  );
  return result.rows[0] || null;
}

router.get('/registro/:tipo/:eventId', registroQrLimiter, async (req, res) => {
  const { tipo } = req.params;
  const eventId = parsePositiveId(req.params.eventId);
  if (!QR_TIPOS.includes(tipo) || !eventId) return renderInvalidQrLink(res);
  try {
    const evento = await fetchPublicEvent(eventId);
    if (!evento) return renderInvalidQrLink(res);
    return res.render('home/encuentros-registro', {
      tipo,
      evento,
      disponible: evento.estado === 'en_curso',
    });
  } catch (error) {
    logFailure(req, error, 'public_qr_registration_page');
    return res.status(503).render('home/message_error', {
      status: 503,
      message: 'Registro no disponible',
      message2: 'No fue posible cargar el registro. Intenta nuevamente más tarde.',
      limit: null,
    });
  }
});

router.post('/registro/:tipo/:eventId', registroQrLimiter, async (req, res) => {
  const { tipo } = req.params;
  const eventId = parsePositiveId(req.params.eventId);
  if (!QR_TIPOS.includes(tipo) || !eventId) {
    return res.status(404).json({ ok: false, message: 'Enlace de registro no válido.' });
  }
  const documento = normalizeDocument(req.body?.documento);
  if (!documento || documento.length > 16) {
    return res.status(400).json({ ok: false, message: 'Ingresa un número de documento válido.' });
  }
  try {
    const result = await registerPublicAttendance(eventId, tipo, documento);
    const ok =
      result.status === 'registered' ||
      result.status === 'already_registered' ||
      result.status === 'already_out';
    return res.json({
      ok,
      status: result.status,
      nombre: result.nombre || null,
      message: buildPublicRegistroMessage(result, tipo, documento),
    });
  } catch (error) {
    logFailure(req, error, 'public_qr_registration');
    return res.status(500).json({
      ok: false,
      message: 'No fue posible registrar la asistencia. Intenta nuevamente.',
    });
  }
});

router.get('/proyeccion/:tipo/:eventId', registroQrLimiter, async (req, res) => {
  const { tipo } = req.params;
  const eventId = parsePositiveId(req.params.eventId);
  if (!QR_TIPOS.includes(tipo) || !eventId) return renderInvalidQrLink(res);
  try {
    const evento = await fetchPublicEvent(eventId);
    if (!evento) return renderInvalidQrLink(res);
    const registroUrl = buildAppUrl(`/encuentros/registro/${tipo}/${eventId}`);
    const qrDataUrl = await QRCode.toDataURL(registroUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 900,
    });
    return res.render('home/encuentros-proyeccion', {
      tipo,
      evento,
      disponible: evento.estado === 'en_curso',
      qrDataUrl,
      registroUrl,
    });
  } catch (error) {
    logFailure(req, error, 'public_qr_projection');
    return res.status(503).render('home/message_error', {
      status: 503,
      message: 'Proyección no disponible',
      message2: 'No fue posible generar el código QR. Intenta nuevamente más tarde.',
      limit: null,
    });
  }
});

router.get('/api/eventos/:eventId/certificados/pendientes', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  if (!eventId)
    return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });
  try {
    const result = await pool.query(
      `
        SELECT p.id AS participante_id, p.nombre, p.correo, c.id AS certificado_id, c.email_estado
        FROM encuentro_participante p
        JOIN encuentro_evento e ON e.id = p.evento_id AND e.activo = TRUE
        JOIN encuentro_asistencia a
          ON a.participante_id = p.id AND a.evento_id = p.evento_id
        LEFT JOIN encuentro_certificado c
          ON c.participante_id = p.id AND c.evento_id = p.evento_id
        WHERE p.evento_id = $1
          AND p.activo = TRUE
          AND a.entrada_en IS NOT NULL
          AND a.salida_en IS NOT NULL
          AND (c.id IS NULL OR (c.estado = 'valido' AND c.email_estado <> 'enviado'))
        ORDER BY p.nombre
      `,
      [eventId]
    );
    return res.json({ ok: true, total: result.rows.length, participantes: result.rows });
  } catch (error) {
    return handleServerError(
      req,
      res,
      error,
      'No fue posible consultar los certificados pendientes.'
    );
  }
});

router.get('/api/eventos', requireManager, async (req, res) => {
  try {
    const page = Math.max(1, Math.min(Number.parseInt(req.query.page, 10) || 1, 100000));
    const pageSize = Math.max(1, Math.min(Number.parseInt(req.query.pageSize, 10) || 20, 100));
    const values = [];
    const filters = ['e.activo = TRUE'];
    const search = String(req.query.q || '')
      .trim()
      .slice(0, 255);
    const state = String(req.query.estado || '').trim();
    const date = String(req.query.fecha || '').trim();
    const organizer = String(req.query.organizador || '')
      .trim()
      .slice(0, 255);

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(e.nombre ILIKE $${values.length} OR e.organizador ILIKE $${values.length})`);
    }
    if (state && ['programado', 'en_curso', 'finalizado', 'cancelado'].includes(state)) {
      values.push(state);
      filters.push(`e.estado = $${values.length}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      values.push(date);
      filters.push(`e.fecha = $${values.length}::date`);
    }
    if (organizer) {
      values.push(`%${organizer}%`);
      filters.push(`e.organizador ILIKE $${values.length}`);
    }
    const where = filters.join(' AND ');
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM encuentro_evento e WHERE ${where}`,
      values
    );
    const total = countResult.rows[0]?.total || 0;
    const orderColumn = req.query.sort === 'nombre' ? 'e.nombre' : 'e.fecha';
    const direction = String(req.query.direction || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const limitPosition = values.length + 1;
    const offsetPosition = values.length + 2;
    const listResult = await pool.query(
      `
        SELECT
          e.id, e.nombre, e.fecha, e.hora_inicio, e.hora_fin,
          e.lugar, e.organizador, e.estado, e.banner_path,
          COUNT(p.id)::int AS participantes
        FROM encuentro_evento e
        LEFT JOIN encuentro_participante p
          ON p.evento_id = e.id AND p.activo = TRUE
        WHERE ${where}
        GROUP BY e.id
        ORDER BY ${orderColumn} ${direction}, e.id DESC
        LIMIT $${limitPosition} OFFSET $${offsetPosition}
      `,
      [...values, pageSize, (page - 1) * pageSize]
    );
    return res.json({
      ok: true,
      eventos: listResult.rows,
      paginacion: { pagina: page, tamano: pageSize, total, paginas: Math.ceil(total / pageSize) },
    });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible consultar los eventos.');
  }
});

router.post(
  '/api/eventos',
  requireManager,
  withUpload(
    upload.fields([
      { name: 'plantilla_pdf', maxCount: 1 },
      { name: 'banner', maxCount: 1 },
    ])
  ),
  async (req, res) => {
    const files = req.files || {};
    const fileError = validateUploadedEventFiles(files);
    if (fileError) return res.status(400).json({ ok: false, message: fileError });
    const pdf = files.plantilla_pdf?.[0];
    const banner = files.banner?.[0];
    if (!pdf)
      return res.status(400).json({ ok: false, message: 'La plantilla PDF es obligatoria.' });

    const eventValidation = validateEventInput(req.body);
    const config = readTemplateConfig(req.body.plantilla_config);
    const configErrors = validateTemplateConfig(config);
    if (eventValidation.errores.length || configErrors.length) {
      return res.status(400).json({
        ok: false,
        message: 'Revisa los datos del evento y la configuración de la plantilla.',
        errores: [...eventValidation.errores, ...configErrors],
      });
    }
    try {
      await validatePdfTemplate(pdf.buffer);
    } catch {
      return res
        .status(400)
        .json({ ok: false, message: 'La plantilla no es un PDF válido o está protegida.' });
    }

    let pdfPath;
    let bannerPath;
    try {
      pdfPath = await saveUpload(pdf, 'templates', 'pdf');
      if (banner)
        bannerPath = await saveUpload(
          banner,
          'banners',
          hasFileSignature(banner, 'png') ? 'png' : 'jpg'
        );
      const event = eventValidation.evento;
      const result = await withTransaction(async (client) => {
        const inserted = await client.query(
          `
            INSERT INTO encuentro_evento (
              nombre, descripcion, fecha, hora_inicio, hora_fin, lugar, organizador,
              banner_path, plantilla_pdf_path, plantilla_pdf_nombre, plantilla_config,
              creado_por_usuario_id, modificado_por_usuario_id
            )
            VALUES ($1, NULLIF($2, ''), $3::date, $4::time, $5::time, $6, $7,
                    $8, $9, $10, $11::jsonb, $12, $12)
            RETURNING id
          `,
          [
            event.nombre,
            event.descripcion,
            event.fecha,
            event.hora_inicio,
            event.hora_fin,
            event.lugar,
            event.organizador,
            bannerPath || null,
            pdfPath,
            path.basename(pdf.originalname).slice(0, 255),
            JSON.stringify(config),
            getSessionUserId(req),
          ]
        );
        await writeAudit(client, req, 'evento creado', inserted.rows[0].id);
        return inserted.rows[0];
      });
      return res.status(201).json({ ok: true, evento_id: result.id, message: 'Evento creado.' });
    } catch (error) {
      if (pdfPath) await removeStoredFile(pdfPath);
      if (bannerPath) await removeStoredFile(bannerPath);
      return handleServerError(req, res, error, 'No fue posible crear el evento.');
    }
  }
);

router.put(
  '/api/eventos/:eventId',
  requireManager,
  withUpload(
    upload.fields([
      { name: 'plantilla_pdf', maxCount: 1 },
      { name: 'banner', maxCount: 1 },
    ])
  ),
  async (req, res) => {
    const eventId = parsePositiveId(req.params.eventId);
    if (!eventId)
      return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });
    const files = req.files || {};
    const fileError = validateUploadedEventFiles(files);
    if (fileError) return res.status(400).json({ ok: false, message: fileError });
    let newPdfPath;
    let newBannerPath;

    try {
      const existingResult = await pool.query(
        `SELECT * FROM encuentro_evento WHERE id = $1 AND activo = TRUE`,
        [eventId]
      );
      const existing = existingResult.rows[0];
      if (!existing) return res.status(404).json({ ok: false, message: 'El evento no existe.' });
      if (existing.estado !== 'programado') {
        return res
          .status(409)
          .json({ ok: false, message: 'Solo se pueden editar eventos programados.' });
      }

      const eventValidation = validateEventInput({
        nombre: req.body.nombre ?? existing.nombre,
        descripcion: req.body.descripcion ?? existing.descripcion,
        fecha: req.body.fecha ?? String(existing.fecha).slice(0, 10),
        hora_inicio: req.body.hora_inicio ?? String(existing.hora_inicio).slice(0, 5),
        hora_fin: req.body.hora_fin ?? String(existing.hora_fin).slice(0, 5),
        lugar: req.body.lugar ?? existing.lugar,
        organizador: req.body.organizador ?? existing.organizador,
      });
      const config = req.body.plantilla_config
        ? readTemplateConfig(req.body.plantilla_config)
        : existing.plantilla_config;
      const configErrors = validateTemplateConfig(config);
      if (eventValidation.errores.length || configErrors.length) {
        return res.status(400).json({
          ok: false,
          message: 'Revisa los datos del evento y la configuración de la plantilla.',
          errores: [...eventValidation.errores, ...configErrors],
        });
      }

      const pdf = files.plantilla_pdf?.[0];
      const banner = files.banner?.[0];
      if (pdf) {
        try {
          await validatePdfTemplate(pdf.buffer);
        } catch {
          return res
            .status(400)
            .json({ ok: false, message: 'La plantilla no es un PDF válido o está protegida.' });
        }
        newPdfPath = await saveUpload(pdf, 'templates', 'pdf');
      }
      if (banner)
        newBannerPath = await saveUpload(
          banner,
          'banners',
          hasFileSignature(banner, 'png') ? 'png' : 'jpg'
        );
      const event = eventValidation.evento;
      await withTransaction(async (client) => {
        await client.query(
          `
            UPDATE encuentro_evento
            SET nombre = $2,
                descripcion = NULLIF($3, ''),
                fecha = $4::date,
                hora_inicio = $5::time,
                hora_fin = $6::time,
                lugar = $7,
                organizador = $8,
                banner_path = COALESCE($9, banner_path),
                plantilla_pdf_path = COALESCE($10, plantilla_pdf_path),
                plantilla_pdf_nombre = COALESCE($11, plantilla_pdf_nombre),
                plantilla_config = $12::jsonb,
                modificado_por_usuario_id = $13,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1 AND estado = 'programado' AND activo = TRUE
          `,
          [
            eventId,
            event.nombre,
            event.descripcion,
            event.fecha,
            event.hora_inicio,
            event.hora_fin,
            event.lugar,
            event.organizador,
            newBannerPath || null,
            newPdfPath || null,
            pdf ? path.basename(pdf.originalname).slice(0, 255) : null,
            JSON.stringify(config),
            getSessionUserId(req),
          ]
        );
        await writeAudit(client, req, 'evento modificado', eventId);
      });
      return res.json({ ok: true, message: 'Evento actualizado.' });
    } catch (error) {
      if (newPdfPath) await removeStoredFile(newPdfPath);
      if (newBannerPath) await removeStoredFile(newBannerPath);
      return handleServerError(req, res, error, 'No fue posible editar el evento.');
    }
  }
);

router.patch('/api/eventos/:eventId/estado', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  const nextState = String(req.body?.estado || '');
  if (!eventId || !['en_curso', 'finalizado', 'cancelado'].includes(nextState)) {
    return res.status(400).json({ ok: false, message: 'Evento o transición inválida.' });
  }

  try {
    const transition = await withTransaction(async (client) => {
      const result = await client.query(
        'SELECT id, estado FROM encuentro_evento WHERE id = $1 AND activo = TRUE FOR UPDATE',
        [eventId]
      );
      const event = result.rows[0];
      if (!event) return { error: 'not_found' };

      const allowed =
        (event.estado === 'programado' && ['en_curso', 'cancelado'].includes(nextState)) ||
        (event.estado === 'en_curso' && ['finalizado', 'cancelado'].includes(nextState));
      if (!allowed) return { error: 'invalid_transition' };

      if (nextState === 'en_curso') {
        const start = await client.query(
          `
            SELECT
              (NOW() AT TIME ZONE 'America/Bogota')::date >= fecha
              AND (
                (NOW() AT TIME ZONE 'America/Bogota')::date > fecha
                OR (NOW() AT TIME ZONE 'America/Bogota')::time >= hora_inicio
              ) AS habilitado
            FROM encuentro_evento
            WHERE id = $1
          `,
          [eventId]
        );
        if (!start.rows[0]?.habilitado) return { error: 'too_early' };
      }
      if (nextState === 'cancelado' && event.estado === 'en_curso') {
        const attendance = await client.query(
          `SELECT 1 FROM encuentro_asistencia WHERE evento_id = $1 AND entrada_en IS NOT NULL LIMIT 1`,
          [eventId]
        );
        if (attendance.rows.length) return { error: 'has_attendance' };
      }

      await client.query(
        `
          UPDATE encuentro_evento
          SET estado = $2, modificado_por_usuario_id = $3, fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [eventId, nextState, getSessionUserId(req)]
      );
      await writeAudit(client, req, `evento ${nextState}`, eventId);
      return { estado: nextState };
    });
    if (transition.error === 'not_found')
      return res.status(404).json({ ok: false, message: 'El evento no existe.' });
    if (transition.error === 'invalid_transition') {
      return res
        .status(409)
        .json({ ok: false, message: 'La transición de estado no está permitida.' });
    }
    if (transition.error === 'too_early') {
      return res.status(409).json({
        ok: false,
        message:
          'El evento solo puede iniciarse en la fecha programada y desde la hora de inicio (America/Bogota).',
      });
    }
    if (transition.error === 'has_attendance') {
      return res.status(409).json({
        ok: false,
        message: 'No se puede cancelar un evento con asistencias registradas.',
      });
    }
    return res.json({ ok: true, estado: transition.estado });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible cambiar el estado del evento.');
  }
});

router.get('/api/eventos/:eventId', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  if (!eventId)
    return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });
  try {
    const detail = await fetchEventDetail(eventId);
    if (!detail) return res.status(404).json({ ok: false, message: 'El evento no existe.' });
    return res.json({ ok: true, ...detail, enlaces_registro: buildRegistrationLinks(eventId) });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible consultar el detalle del evento.');
  }
});

router.get('/api/eventos/:eventId/informe.pdf', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  if (!eventId)
    return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });

  try {
    const report = await fetchEventReportData(eventId);
    if (!report) return res.status(404).json({ ok: false, message: 'El evento no existe.' });
    if (report.event.estado !== 'finalizado') {
      return res.status(409).json({
        ok: false,
        message: 'El informe solo está disponible cuando el encuentro haya finalizado.',
      });
    }

    const pdf = await renderEventReportPdf(report);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="informe-encuentro-${eventId}.pdf"`);
    res.setHeader('Content-Length', String(pdf.length));
    return res.send(pdf);
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible generar el informe del encuentro.');
  }
});

router.get('/api/eventos/:eventId/banner', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  if (!eventId)
    return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });
  try {
    const result = await pool.query(
      'SELECT banner_path FROM encuentro_evento WHERE id = $1 AND activo = TRUE',
      [eventId]
    );
    if (!result.rows[0]?.banner_path)
      return res.status(404).json({ ok: false, message: 'El banner no existe.' });
    const filePath = resolveStoredPath(result.rows[0].banner_path);
    await fs.access(filePath);
    res.type(path.extname(filePath) === '.png' ? 'png' : 'jpeg');
    return res.sendFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT')
      return res.status(404).json({ ok: false, message: 'El banner no está disponible.' });
    return handleServerError(req, res, error, 'No fue posible consultar el banner.');
  }
});

router.get('/api/eventos/:eventId/plantilla-pdf', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  if (!eventId)
    return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });
  try {
    const result = await pool.query(
      'SELECT plantilla_pdf_path, plantilla_pdf_nombre FROM encuentro_evento WHERE id = $1 AND activo = TRUE',
      [eventId]
    );
    if (!result.rows[0])
      return res.status(404).json({ ok: false, message: 'El evento no existe.' });
    const filePath = resolveStoredPath(result.rows[0].plantilla_pdf_path);
    await fs.access(filePath);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="plantilla-evento-${eventId}.pdf"`);
    return res.sendFile(filePath);
  } catch (error) {
    if (error.code === 'ENOENT')
      return res.status(404).json({ ok: false, message: 'La plantilla PDF no está disponible.' });
    return handleServerError(req, res, error, 'No fue posible consultar la plantilla PDF.');
  }
});

router.patch(
  '/api/eventos/:eventId/plantilla',
  requireManager,
  withUpload(upload.fields([{ name: 'plantilla_pdf', maxCount: 1 }])),
  async (req, res) => {
    const eventId = parsePositiveId(req.params.eventId);
    if (!eventId)
      return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });

    const files = req.files || {};
    const fileError = validateUploadedEventFiles(files);
    if (fileError) return res.status(400).json({ ok: false, message: fileError });

    const config = readTemplateConfig(req.body?.plantilla_config);
    const configErrors = validateTemplateConfig(config);
    if (configErrors.length) {
      return res.status(400).json({
        ok: false,
        message: 'Revisa la configuración de la plantilla.',
        errores: configErrors,
      });
    }

    const pdf = files.plantilla_pdf?.[0];
    if (pdf) {
      try {
        await validatePdfTemplate(pdf.buffer);
      } catch {
        return res
          .status(400)
          .json({ ok: false, message: 'La plantilla no es un PDF válido o está protegida.' });
      }
    }

    let newPdfPath;
    try {
      if (pdf) newPdfPath = await saveUpload(pdf, 'templates', 'pdf');
      const result = await withTransaction(async (client) => {
        const existing = await client.query(
          'SELECT id, estado FROM encuentro_evento WHERE id = $1 AND activo = TRUE FOR UPDATE',
          [eventId]
        );
        if (!existing.rows[0]) return { error: 'not_found' };
        if (!['en_curso', 'finalizado'].includes(existing.rows[0].estado)) {
          return { error: 'not_started' };
        }

        await client.query(
          `
            UPDATE encuentro_evento
            SET plantilla_pdf_path = COALESCE($2, plantilla_pdf_path),
                plantilla_pdf_nombre = COALESCE($3, plantilla_pdf_nombre),
                plantilla_config = $4::jsonb,
                modificado_por_usuario_id = $5,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1 AND activo = TRUE
          `,
          [
            eventId,
            newPdfPath || null,
            pdf ? path.basename(pdf.originalname).slice(0, 255) : null,
            JSON.stringify(config),
            getSessionUserId(req),
          ]
        );
        await writeAudit(client, req, 'plantilla de certificado modificada', eventId);
        return { updated: true };
      });
      if (result.error === 'not_found') {
        if (newPdfPath) await removeStoredFile(newPdfPath);
        return res.status(404).json({ ok: false, message: 'El evento no existe.' });
      }
      if (result.error === 'not_started') {
        if (newPdfPath) await removeStoredFile(newPdfPath);
        return res.status(409).json({
          ok: false,
          message: 'La plantilla solo puede modificarse después de iniciar el evento.',
        });
      }
      return res.json({
        ok: true,
        message: 'La plantilla de certificados se actualizó. Los certificados emitidos no cambian.',
      });
    } catch (error) {
      if (newPdfPath) await removeStoredFile(newPdfPath);
      return handleServerError(req, res, error, 'No fue posible actualizar la plantilla.');
    }
  }
);

router.post(
  '/api/eventos/:eventId/participantes/previsualizar',
  requireManager,
  withUpload(upload.single('archivo')),
  async (req, res) => {
    const eventId = parsePositiveId(req.params.eventId);
    const file = req.file;
    if (!eventId)
      return res.status(400).json({ ok: false, message: 'Identificador de evento inválido.' });
    if (
      !file ||
      file.size > MAX_SPREADSHEET_BYTES ||
      !hasFileSignature(file, 'xlsx') ||
      !isSafeXlsxArchive(file.buffer)
    ) {
      return res
        .status(400)
        .json({ ok: false, message: 'Carga un archivo XLSX válido de máximo 5 MB.' });
    }
    try {
      const eventResult = await pool.query(
        'SELECT estado FROM encuentro_evento WHERE id = $1 AND activo = TRUE',
        [eventId]
      );
      if (!eventResult.rows[0])
        return res.status(404).json({ ok: false, message: 'El evento no existe.' });
      if (eventResult.rows[0].estado !== 'programado') {
        return res.status(409).json({
          ok: false,
          message: 'La importación Excel solo está habilitada para eventos programados.',
        });
      }
      let preview;
      try {
        preview = await previewParticipantWorkbook(file.buffer);
      } catch {
        return res.status(400).json({
          ok: false,
          message:
            'No fue posible leer el Excel. Verifica que no esté dañado ni protegido con contraseña.',
        });
      }
      if (preview.errores_estructura.length) {
        return res.status(400).json({
          ok: false,
          message: 'La estructura del Excel no es válida.',
          errores: preview.errores_estructura,
        });
      }
      const normalizedDocuments = preview.filas
        .filter((row) => row.errores.length === 0)
        .map((row) => row.participante.documento_normalizado);
      if (normalizedDocuments.length) {
        const existing = await pool.query(
          `
            SELECT documento_normalizado
            FROM encuentro_participante
            WHERE evento_id = $1
              AND documento_normalizado = ANY($2::text[])
              AND activo = TRUE
          `,
          [eventId, normalizedDocuments]
        );
        const existingDocuments = new Set(existing.rows.map((row) => row.documento_normalizado));
        preview.filas.forEach((row) => {
          if (existingDocuments.has(row.participante.documento_normalizado)) {
            row.errores.push('Este documento ya está inscrito en el evento.');
          }
        });
      }
      const validCount = preview.filas.filter((row) => row.errores.length === 0).length;
      return res.json({
        ok: true,
        filas: preview.filas,
        resumen: {
          total: preview.filas.length,
          validos: validCount,
          rechazados: preview.filas.length - validCount,
        },
      });
    } catch (error) {
      return handleServerError(req, res, error, 'No fue posible validar el archivo Excel.');
    }
  }
);

router.post('/api/eventos/:eventId/participantes/importar', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  const rows = req.body?.filas;
  if (!eventId || !Array.isArray(rows) || rows.length > 2000) {
    return res
      .status(400)
      .json({ ok: false, message: 'Evento o lista de participantes inválida.' });
  }
  const validRows = [];
  const rejectedRows = [];
  rows.forEach((row, index) => {
    const validation = validateParticipant(row?.participante || row);
    if (validation.errores.length) {
      rejectedRows.push({ fila: row?.fila || index + 1, errores: validation.errores });
    } else {
      validRows.push({ fila: row?.fila || index + 1, participante: validation.participante });
    }
  });

  try {
    const result = await withTransaction(async (client) => {
      const eventResult = await client.query(
        'SELECT estado FROM encuentro_evento WHERE id = $1 AND activo = TRUE FOR UPDATE',
        [eventId]
      );
      if (!eventResult.rows[0]) return { error: 'not_found' };
      if (eventResult.rows[0].estado !== 'programado') return { error: 'invalid_state' };

      let imported = 0;
      let omitted = 0;
      for (const row of validRows) {
        const userId = await getRegisteredUserMatch(client, row.participante.documento_normalizado);
        const inserted = await client.query(
          `
            INSERT INTO encuentro_participante (
              evento_id, nombre, documento, documento_normalizado, correo, rol,
              facultad, laboratorio, usuario_id, creado_por_usuario_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (evento_id, documento_normalizado) DO NOTHING
            RETURNING id
          `,
          [
            eventId,
            row.participante.nombre,
            row.participante.documento,
            row.participante.documento_normalizado,
            row.participante.correo,
            row.participante.rol,
            row.participante.facultad,
            row.participante.laboratorio,
            userId,
            getSessionUserId(req),
          ]
        );
        if (inserted.rows.length) imported += 1;
        else {
          omitted += 1;
          rejectedRows.push({
            fila: row.fila,
            errores: ['El documento ya se encuentra asociado a este evento.'],
          });
        }
      }
      await writeAudit(client, req, `participantes importados (${imported})`, eventId);
      return { imported, omitted };
    });
    if (result.error === 'not_found')
      return res.status(404).json({ ok: false, message: 'El evento no existe.' });
    if (result.error === 'invalid_state') {
      return res.status(409).json({
        ok: false,
        message: 'Solo se pueden importar participantes en eventos programados.',
      });
    }
    return res.json({
      ok: true,
      resumen: {
        procesados: rows.length,
        importados: result.imported,
        omitidos: result.omitted,
        rechazados: rejectedRows.length,
      },
      errores: rejectedRows,
    });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible completar la importación.');
  }
});

router.post('/api/eventos/:eventId/participantes', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  const validation = validateParticipant(req.body);
  if (!eventId || validation.errores.length) {
    return res.status(400).json({
      ok: false,
      message: 'Revisa los datos del participante.',
      errores: validation.errores,
    });
  }
  try {
    const participant = await withTransaction(async (client) => {
      const eventResult = await client.query(
        'SELECT estado FROM encuentro_evento WHERE id = $1 AND activo = TRUE FOR UPDATE',
        [eventId]
      );
      if (!eventResult.rows[0]) return { error: 'not_found' };
      if (!['programado', 'en_curso'].includes(eventResult.rows[0].estado)) {
        return { error: 'invalid_state' };
      }
      const userId = await getRegisteredUserMatch(
        client,
        validation.participante.documento_normalizado
      );
      const inserted = await client.query(
        `
          INSERT INTO encuentro_participante (
            evento_id, nombre, documento, documento_normalizado, correo, rol,
            facultad, laboratorio, usuario_id, creado_por_usuario_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (evento_id, documento_normalizado) DO NOTHING
          RETURNING id
        `,
        [
          eventId,
          validation.participante.nombre,
          validation.participante.documento,
          validation.participante.documento_normalizado,
          validation.participante.correo,
          validation.participante.rol,
          validation.participante.facultad,
          validation.participante.laboratorio,
          userId,
          getSessionUserId(req),
        ]
      );
      if (!inserted.rows[0]) return { error: 'duplicate' };
      await writeAudit(client, req, 'participante incorporado', eventId);
      return { id: inserted.rows[0].id };
    });
    if (participant.error === 'not_found')
      return res.status(404).json({ ok: false, message: 'El evento no existe.' });
    if (participant.error === 'invalid_state') {
      return res.status(409).json({
        ok: false,
        message: 'No se pueden incorporar participantes en este estado del evento.',
      });
    }
    if (participant.error === 'duplicate')
      return res
        .status(409)
        .json({ ok: false, message: 'El documento ya está inscrito en este evento.' });
    return res.status(201).json({ ok: true, participante_id: participant.id });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible incorporar al participante.');
  }
});

router.post('/api/eventos/:eventId/asistencia/entrada', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  const normalizedDocument = normalizeDocument(req.body?.documento);
  if (!eventId || !normalizedDocument) {
    return res
      .status(400)
      .json({ ok: false, message: 'Evento y documento válido son obligatorios.' });
  }
  try {
    const result = await withTransaction(async (client) => {
      const participantResult = await client.query(
        `
          SELECT p.id, e.estado AS estado_evento
          FROM encuentro_participante p
          JOIN encuentro_evento e ON e.id = p.evento_id
          WHERE p.evento_id = $1
            AND p.documento_normalizado = $2
            AND p.activo = TRUE
            AND e.activo = TRUE
          FOR UPDATE OF p, e
        `,
        [eventId, normalizedDocument]
      );
      const participant = participantResult.rows[0];
      if (!participant) return { error: 'not_enrolled' };
      if (participant.estado_evento !== 'en_curso') return { error: 'event_not_open' };

      const attendance = await client.query(
        `
          INSERT INTO encuentro_asistencia (
            evento_id, participante_id, entrada_en, entrada_por_usuario_id
          )
          VALUES ($1, $2, CURRENT_TIMESTAMP, $3)
          ON CONFLICT (participante_id) DO NOTHING
          RETURNING entrada_en
        `,
        [eventId, participant.id, getSessionUserId(req)]
      );
      if (!attendance.rows[0]) return { error: 'duplicate_entry' };
      await writeAudit(client, req, 'entrada registrada', eventId);
      return { entrada_en: attendance.rows[0].entrada_en };
    });
    if (result.error === 'not_enrolled')
      return res
        .status(404)
        .json({ ok: false, message: 'El participante no está inscrito en este evento.' });
    if (result.error === 'event_not_open')
      return res
        .status(409)
        .json({ ok: false, message: 'El evento no está habilitado para registrar entradas.' });
    if (result.error === 'duplicate_entry')
      return res.status(409).json({ ok: false, message: 'La entrada ya fue registrada.' });
    return res.json({ ok: true, entrada_en: result.entrada_en });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible registrar la entrada.');
  }
});

router.post('/api/eventos/:eventId/asistencia/salida', requireManager, async (req, res) => {
  const eventId = parsePositiveId(req.params.eventId);
  const normalizedDocument = normalizeDocument(req.body?.documento);
  if (!eventId || !normalizedDocument) {
    return res
      .status(400)
      .json({ ok: false, message: 'Evento y documento válido son obligatorios.' });
  }
  try {
    const attendance = await withTransaction(async (client) => {
      const participantResult = await client.query(
        `
          SELECT p.id, e.estado AS estado_evento
          FROM encuentro_participante p
          JOIN encuentro_evento e ON e.id = p.evento_id
          WHERE p.evento_id = $1
            AND p.documento_normalizado = $2
            AND p.activo = TRUE
            AND e.activo = TRUE
          FOR UPDATE OF p
        `,
        [eventId, normalizedDocument]
      );
      const participant = participantResult.rows[0];
      if (!participant) return { error: 'not_enrolled' };
      if (participant.estado_evento !== 'en_curso') return { error: 'event_not_open' };

      const updated = await client.query(
        `
          UPDATE encuentro_asistencia
          SET salida_en = CURRENT_TIMESTAMP,
              salida_por_usuario_id = $3,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE evento_id = $1
            AND participante_id = $2
            AND activo = TRUE
            AND entrada_en IS NOT NULL
            AND salida_en IS NULL
            AND CURRENT_TIMESTAMP >= entrada_en
          RETURNING participante_id, salida_en
        `,
        [eventId, participant.id, getSessionUserId(req)]
      );
      if (!updated.rows[0]) {
        const existing = await client.query(
          'SELECT entrada_en, salida_en FROM encuentro_asistencia WHERE evento_id = $1 AND participante_id = $2',
          [eventId, participant.id]
        );
        if (!existing.rows[0] || !existing.rows[0].entrada_en) return { error: 'no_entry' };
        if (existing.rows[0].salida_en) return { error: 'duplicate_exit' };
        return { error: 'invalid_exit_time' };
      }
      await writeAudit(client, req, 'salida registrada', eventId);
      return {
        participante_id: updated.rows[0].participante_id,
        salida_en: updated.rows[0].salida_en,
      };
    });
    if (attendance.error === 'not_enrolled')
      return res
        .status(404)
        .json({ ok: false, message: 'El participante no está inscrito en este evento.' });
    if (attendance.error === 'event_not_open')
      return res
        .status(409)
        .json({ ok: false, message: 'El evento no está habilitado para registrar salidas.' });
    if (attendance.error === 'no_entry')
      return res
        .status(409)
        .json({ ok: false, message: 'No existe una entrada previa para esta persona.' });
    if (attendance.error === 'duplicate_exit')
      return res.status(409).json({ ok: false, message: 'La salida ya fue registrada.' });
    if (attendance.error === 'invalid_exit_time')
      return res
        .status(409)
        .json({ ok: false, message: 'La salida no puede ser anterior a la entrada.' });

    let certificate;
    try {
      certificate = await createCertificate(eventId, attendance.participante_id, req);
    } catch (error) {
      logFailure(req, error, 'certificate_generation');
      return res.status(500).json({
        ok: false,
        salida_registrada: true,
        message:
          'La salida se registró, pero no fue posible generar el certificado. Revisa la plantilla y vuelve a intentar.',
      });
    }
    const email = await deliverCertificate(certificate.id, req);
    if (email.status === 'error') {
      return res.status(200).json({
        ok: true,
        salida_registrada: true,
        certificado_generado: true,
        estado_envio: 'error',
        message:
          'La salida y el certificado se registraron. El correo no se envió; puedes reintentar el envío.',
      });
    }
    return res.json({
      ok: true,
      salida_registrada: true,
      certificado_generado: true,
      estado_envio: email.status,
      medalla_otorgada: Boolean(email.medal?.otorgada),
      message:
        email.status === 'sent'
          ? 'Salida registrada y certificado enviado.'
          : 'Salida registrada; el certificado ya está en proceso de envío.',
    });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible registrar la salida.');
  }
});

router.post(
  '/api/eventos/:eventId/participantes/:participantId/certificado/generar',
  requireManager,
  async (req, res) => {
    const eventId = parsePositiveId(req.params.eventId);
    const participantId = parsePositiveId(req.params.participantId);
    if (!eventId || !participantId) {
      return res
        .status(400)
        .json({ ok: false, message: 'Identificadores de evento o participante inválidos.' });
    }
    try {
      const eligible = await pool.query(
        `
          SELECT 1
          FROM encuentro_participante p
          JOIN encuentro_asistencia a
            ON a.participante_id = p.id AND a.evento_id = p.evento_id
          WHERE p.id = $1 AND p.evento_id = $2
            AND p.activo = TRUE
            AND a.entrada_en IS NOT NULL
            AND a.salida_en IS NOT NULL
        `,
        [participantId, eventId]
      );
      if (!eligible.rows.length) {
        return res
          .status(409)
          .json({ ok: false, message: 'El participante no tiene una participación completada.' });
      }
      const certificate = await createCertificate(eventId, participantId, req);
      const delivery = await deliverCertificate(certificate.id, req);
      if (delivery.status === 'error') {
        return res.status(502).json({
          ok: false,
          certificado_generado: true,
          message: 'El certificado está generado, pero no se pudo enviar. Reintenta el correo.',
        });
      }
      return res.json({
        ok: true,
        certificado_id: certificate.id,
        estado_envio: delivery.status,
        medalla_otorgada: Boolean(delivery.medal?.otorgada),
      });
    } catch (error) {
      return handleServerError(req, res, error, 'No fue posible generar el certificado.');
    }
  }
);

router.patch(
  '/api/eventos/:eventId/asistencia/:documento/corregir',
  requireAttendanceCorrection,
  async (req, res) => {
    const eventId = parsePositiveId(req.params.eventId);
    const normalizedDocument = normalizeDocument(req.params.documento);
    const reason = String(req.body?.motivo || '').trim();
    const hasEntry = Object.hasOwn(req.body || {}, 'entrada_en');
    const hasExit = Object.hasOwn(req.body || {}, 'salida_en');
    const parseTimestamp = (value) => {
      if (value === null) return null;
      if (
        typeof value !== 'string' ||
        !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
        Number.isNaN(Date.parse(value))
      ) {
        return undefined;
      }
      return new Date(value).toISOString();
    };
    const correctedEntry = parseTimestamp(req.body?.entrada_en);
    const correctedExit = parseTimestamp(req.body?.salida_en);
    if (
      !eventId ||
      !normalizedDocument ||
      !reason ||
      reason.length > 1000 ||
      !hasEntry ||
      !hasExit ||
      correctedEntry === undefined ||
      correctedExit === undefined
    ) {
      return res.status(400).json({
        ok: false,
        message:
          'Indica un motivo y las fechas de entrada y salida en ISO 8601 con zona horaria; utiliza null para borrar una marca.',
      });
    }
    if (
      correctedExit &&
      (!correctedEntry || Date.parse(correctedExit) < Date.parse(correctedEntry))
    ) {
      return res
        .status(400)
        .json({ ok: false, message: 'La salida no puede ser anterior a la entrada.' });
    }

    try {
      const result = await withTransaction(async (client) => {
        const participantResult = await client.query(
          `
            SELECT p.id, e.estado
            FROM encuentro_participante p
            JOIN encuentro_evento e ON e.id = p.evento_id
            WHERE p.evento_id = $1
              AND p.documento_normalizado = $2
              AND p.activo = TRUE
            FOR UPDATE OF p
          `,
          [eventId, normalizedDocument]
        );
        const participant = participantResult.rows[0];
        if (!participant) return { error: 'not_found' };
        if (!['en_curso', 'finalizado'].includes(participant.estado)) {
          return { error: 'invalid_state' };
        }
        const certificate = await client.query(
          'SELECT 1 FROM encuentro_certificado WHERE evento_id = $1 AND participante_id = $2 LIMIT 1',
          [eventId, participant.id]
        );
        if (certificate.rows.length) return { error: 'certificate_exists' };
        const attendanceResult = await client.query(
          `
            SELECT id, entrada_en, salida_en
            FROM encuentro_asistencia
            WHERE evento_id = $1 AND participante_id = $2 AND activo = TRUE
            FOR UPDATE
          `,
          [eventId, participant.id]
        );
        const attendance = attendanceResult.rows[0];
        if (!attendance) return { error: 'no_attendance' };

        await client.query(
          `
            INSERT INTO encuentro_asistencia_correccion (
              evento_id, asistencia_id, entrada_anterior, salida_anterior,
              entrada_nueva, salida_nueva, motivo, corregido_por_usuario_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            eventId,
            attendance.id,
            attendance.entrada_en,
            attendance.salida_en,
            correctedEntry,
            correctedExit,
            reason,
            getSessionUserId(req),
          ]
        );
        await client.query(
          `
            UPDATE encuentro_asistencia
            SET entrada_en = $2::timestamptz,
                entrada_por_usuario_id = CASE
                  WHEN entrada_en IS DISTINCT FROM $2::timestamptz THEN $4
                  ELSE entrada_por_usuario_id
                END,
                salida_en = $3::timestamptz,
                salida_por_usuario_id = CASE
                  WHEN salida_en IS DISTINCT FROM $3::timestamptz THEN $4
                  ELSE salida_por_usuario_id
                END,
                fecha_modificacion = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [attendance.id, correctedEntry, correctedExit, getSessionUserId(req)]
        );
        await writeAudit(client, req, 'asistencia corregida', eventId);
        return {
          participante_id: participant.id,
          completada: Boolean(correctedEntry && correctedExit),
        };
      });
      if (result.error === 'not_found')
        return res
          .status(404)
          .json({ ok: false, message: 'Participante no inscrito o no encontrado.' });
      if (result.error === 'invalid_state')
        return res.status(409).json({
          ok: false,
          message: 'La asistencia solo puede corregirse en eventos en curso o finalizados.',
        });
      if (result.error === 'certificate_exists')
        return res.status(409).json({
          ok: false,
          message: 'No se puede alterar una asistencia que ya tiene un certificado emitido.',
        });
      if (result.error === 'no_attendance')
        return res.status(409).json({
          ok: false,
          message: 'No existe un registro de asistencia que se pueda corregir.',
        });

      let emailState = null;
      if (result.completada) {
        const certificate = await createCertificate(eventId, result.participante_id, req);
        const delivery = await deliverCertificate(certificate.id, req);
        emailState = delivery.status;
      }
      return res.json({
        ok: true,
        message: result.completada
          ? emailState === 'error'
            ? 'Asistencia corregida y certificado generado, pero el correo no se envió. Puedes reintentar el envío desde el detalle.'
            : 'Asistencia corregida; se generó el certificado de participación.'
          : 'Asistencia corregida y registrada en el historial de auditoría.',
        estado_envio: emailState,
      });
    } catch (error) {
      return handleServerError(req, res, error, 'No fue posible corregir la asistencia.');
    }
  }
);

router.post(
  '/api/certificados/:certificateId/reintentar-envio',
  requireManager,
  async (req, res) => {
    const certificateId = parsePositiveId(req.params.certificateId);
    if (!certificateId)
      return res.status(400).json({ ok: false, message: 'Identificador de certificado inválido.' });
    try {
      const result = await deliverCertificate(certificateId, req);
      if (result.status === 'not_found')
        return res.status(404).json({ ok: false, message: 'El certificado no existe.' });
      if (result.status === 'annulled')
        return res
          .status(409)
          .json({ ok: false, message: 'No se puede enviar un certificado anulado.' });
      if (result.status === 'sending')
        return res
          .status(409)
          .json({ ok: false, message: 'Ya hay un envío en curso. Intenta de nuevo más tarde.' });
      if (result.status === 'error')
        return res.status(502).json({
          ok: false,
          message: 'Falló el envío. El certificado se conserva y puedes reintentar.',
        });
      return res.json({
        ok: true,
        estado_envio: 'enviado',
        medalla_otorgada: Boolean(result.medal?.otorgada),
      });
    } catch (error) {
      return handleServerError(req, res, error, 'No fue posible reintentar el envío.');
    }
  }
);

router.patch(
  '/api/certificados/:certificateId/anular',
  requireAttendanceCorrection,
  async (req, res) => {
    const certificateId = parsePositiveId(req.params.certificateId);
    const reason = String(req.body?.motivo || '').trim();
    if (!certificateId || !reason || reason.length > 1000) {
      return res.status(400).json({
        ok: false,
        message: 'Indica un motivo válido de anulación (máximo 1000 caracteres).',
      });
    }
    try {
      const result = await withTransaction(async (client) => {
        const certificateResult = await client.query(
          'SELECT id, evento_id, estado, email_estado FROM encuentro_certificado WHERE id = $1 FOR UPDATE',
          [certificateId]
        );
        const certificate = certificateResult.rows[0];
        if (!certificate) return { error: 'not_found' };
        if (certificate.estado !== 'valido') return { error: 'already_annulled' };
        if (certificate.email_estado === 'enviando') return { error: 'sending' };
        await client.query(
          `
          UPDATE encuentro_certificado
          SET estado = 'anulado',
              anulado_por_usuario_id = $2,
              anulado_en = CURRENT_TIMESTAMP,
              motivo_anulacion = $3,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
          [certificateId, getSessionUserId(req), reason]
        );
        await writeAudit(client, req, 'certificado anulado', certificate.evento_id);
        return { annulled: true };
      });
      if (result.error === 'not_found')
        return res.status(404).json({ ok: false, message: 'El certificado no existe.' });
      if (result.error === 'already_annulled')
        return res.status(409).json({ ok: false, message: 'El certificado ya está anulado.' });
      if (result.error === 'sending')
        return res.status(409).json({
          ok: false,
          message: 'Espera a que termine el envío antes de anular el certificado.',
        });
      return res.json({ ok: true, message: 'Certificado anulado.' });
    } catch (error) {
      return handleServerError(req, res, error, 'No fue posible anular el certificado.');
    }
  }
);

router.get(
  '/api/certificados/:certificateId/descargar',
  requireAuthenticatedJson,
  async (req, res) => {
    const certificateId = parsePositiveId(req.params.certificateId);
    if (!certificateId)
      return res.status(400).json({ ok: false, message: 'Identificador de certificado inválido.' });
    try {
      const roles = Array.isArray(req.session?.user?.roles)
        ? req.session.user.roles.map((role) => String(role).toLowerCase())
        : [String(req.session?.user?.tipo || '').toLowerCase()];
      const isManager = roles.some((role) => MANAGER_ROLES.includes(role));
      const userId = getSessionUserId(req);
      const result = await pool.query(
        `
        SELECT c.archivo_actual, c.codigo
        FROM encuentro_certificado c
        JOIN encuentro_participante p
          ON p.id = c.participante_id AND p.evento_id = c.evento_id
        WHERE c.id = $1
          AND c.estado = 'valido'
          AND ($2::boolean = TRUE OR p.usuario_id = $3)
      `,
        [certificateId, isManager, userId]
      );
      if (!result.rows[0])
        return res
          .status(404)
          .json({ ok: false, message: 'El certificado no existe o no tienes acceso.' });
      const filePath = resolveStoredPath(result.rows[0].archivo_actual);
      await fs.access(filePath);
      return res.download(filePath, `certificado-${result.rows[0].codigo}.pdf`);
    } catch (error) {
      if (error.code === 'ENOENT')
        return res
          .status(404)
          .json({ ok: false, message: 'El archivo del certificado no está disponible.' });
      return handleServerError(req, res, error, 'No fue posible descargar el certificado.');
    }
  }
);

router.get('/api/mis-logros', requireAuthenticatedJson, async (req, res) => {
  const userId = getSessionUserId(req);
  if (!userId)
    return res
      .status(401)
      .json({ ok: false, message: 'La sesión no identifica un usuario MiLab válido.' });
  try {
    const result = await pool.query(
      `
        SELECT
          l.id,
          e.nombre AS evento,
          e.fecha AS fecha_evento,
          l.fecha_obtencion,
          c.id AS certificado_id,
          c.codigo AS codigo_certificado
        FROM encuentro_logro l
        JOIN encuentro_evento e ON e.id = l.evento_id
        JOIN encuentro_certificado c ON c.id = l.certificado_id AND c.estado = 'valido'
        WHERE l.usuario_id = $1
        ORDER BY l.fecha_obtencion DESC, l.id DESC
      `,
      [userId]
    );
    return res.json({ ok: true, logros: result.rows });
  } catch (error) {
    return handleServerError(req, res, error, 'No fue posible consultar tus logros.');
  }
});

router.get('/api/eventos/:eventId/plantilla-participantes', requireManager, async (_req, res) => {
  try {
    const buffer = await buildParticipantTemplateBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla-encuentros.xlsx"');
    return res.send(buffer);
  } catch (error) {
    return handleServerError(_req, res, error, 'No fue posible generar la plantilla Excel.');
  }
});

module.exports = router;
