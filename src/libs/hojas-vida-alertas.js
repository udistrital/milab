const pool = require('./db');
const { buildAppUrl } = require('./app-url');
const { sendEmailNotification } = require('./email-notifications');
const { etiquetaTipoMantenimiento } = require('./hojas-vida-mantenimientos');

/**
 * Normaliza un correo electronico dejandolo en minusculas o null si viene vacio.
 */
function normalizarCorreo(valor) {
  const texto = String(valor || '')
    .trim()
    .toLowerCase();
  return texto === '' ? null : texto;
}

/**
 * Convierte filas con columna `correo` en una lista de destinatarios unica,
 * etiquetando cada uno con el perfil que recibira la alerta.
 */
function construirDestinatarios(rows, perfil) {
  const vistos = new Set();
  const destinatarios = [];
  (rows || []).forEach((fila) => {
    const correo = normalizarCorreo(fila?.correo);
    if (!correo || vistos.has(correo)) return;
    vistos.add(correo);
    destinatarios.push({ correo, perfil });
  });
  return destinatarios;
}

/**
 * Resuelve los coordinadores de la facultad y los laboratoristas asignados a la
 * UAL del equipo; son los responsables de atender la programacion de mantenimiento.
 */
async function obtenerResponsablesProgramacion(cliente, ualId) {
  const id = Number(ualId);
  if (!Number.isInteger(id) || id <= 0) {
    return [];
  }

  const [coordinadoresResult, laboratoristasResult] = await Promise.all([
    cliente.query(
      `
        SELECT DISTINCT COALESCE(NULLIF(TRIM(c.correo), ''), u.correo) AS correo
        FROM ual ua
        JOIN coordinador_facultad_alcance ca
          ON ca.facultad_id = ua.facultad_id
         AND ca.activo = TRUE
        JOIN coordinador c
          ON c.documento = ca.coordinador_documento_id
         AND c.activo = TRUE
        LEFT JOIN usuario u
          ON u.id = c.usuario_id
        WHERE ua.ual_id = $1
          AND ua.activo = TRUE
          AND COALESCE(NULLIF(TRIM(c.correo), ''), u.correo) IS NOT NULL
      `,
      [id]
    ),
    cliente.query(
      `
        SELECT DISTINCT COALESCE(NULLIF(TRIM(l.correo), ''), u.correo) AS correo
        FROM laboratorista_ual lu
        JOIN laboratorista l
          ON l.documento = lu.laboratorista_documento_id
         AND l.activo = TRUE
        LEFT JOIN usuario u
          ON u.id = l.usuario_id
        WHERE lu.ual_id = $1
          AND lu.activo = TRUE
          AND COALESCE(NULLIF(TRIM(l.correo), ''), u.correo) IS NOT NULL
      `,
      [id]
    ),
  ]);

  const coordinadores = construirDestinatarios(coordinadoresResult.rows, 'coordinador');
  const correosCoordinadores = new Set(coordinadores.map((item) => item.correo));
  const laboratoristas = construirDestinatarios(laboratoristasResult.rows, 'laboratorista').filter(
    (item) => !correosCoordinadores.has(item.correo)
  );

  return [...coordinadores, ...laboratoristas];
}

function formatearFechaProgramada(valor) {
  if (!valor) return 'Sin fecha definida';
  const texto = String(valor).slice(0, 10);
  const coincidencia = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const fecha = coincidencia
    ? new Date(
        Date.UTC(Number(coincidencia[1]), Number(coincidencia[2]) - 1, Number(coincidencia[3]))
      )
    : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return texto;
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'UTC',
    dateStyle: 'long',
  }).format(fecha);
}

/**
 * Envia la alerta de un mantenimiento programado a los coordinadores y
 * laboratoristas del equipo. Nunca propaga errores: la alerta es best-effort.
 */
async function notificarMantenimientoProgramado({ equipo, mantenimiento, usuario }) {
  try {
    const ualId = Number(equipo?.ual_id);
    const destinatarios = await obtenerResponsablesProgramacion(pool, ualId);
    if (destinatarios.length === 0) {
      return { enviados: 0 };
    }

    const nombreEquipo =
      equipo?.nombre_equipo || equipo?.codigo_interno || `Equipo ${equipo?.equipo_id}`;
    const variables = {
      equipoNombre: nombreEquipo,
      codigoInterno: equipo?.codigo_interno || '—',
      codigoInventario: equipo?.codigo_inventario || '—',
      laboratorio: equipo?.laboratorio || '—',
      facultad: equipo?.facultad || '—',
      tipoMantenimiento: etiquetaTipoMantenimiento(mantenimiento?.tipo_mantenimiento),
      item: mantenimiento?.item || '—',
      fechaProgramada: formatearFechaProgramada(mantenimiento?.fecha_realizacion),
      responsable: mantenimiento?.responsable || 'Sin asignar',
      registradoPor: usuario || 'Sistema',
      programacionUrl: buildAppUrl('/inventarios/hojas-vida/programacion'),
    };

    let enviados = 0;
    for (const destinatario of destinatarios) {
      try {
        await sendEmailNotification({
          sourceSystem: 'hojas-vida',
          templateName: 'hojas-vida/mantenimiento_programado',
          recipient: destinatario.correo,
          subject: `MILab: mantenimiento programado para ${nombreEquipo}`,
          variables: { ...variables, perfil: destinatario.perfil },
          correlationId: `hv-mantenimiento-programado-${mantenimiento?.id || 'nuevo'}-${destinatario.correo}`,
        });
        enviados += 1;
      } catch (error) {
        console.error(
          `[hojas-vida] No fue posible enviar la alerta de programacion a ${destinatario.correo}:`,
          error
        );
      }
    }

    return { enviados };
  } catch (error) {
    console.error(
      '[hojas-vida] Error resolviendo destinatarios de alerta de mantenimiento:',
      error
    );
    return { enviados: 0 };
  }
}

module.exports = {
  notificarMantenimientoProgramado,
  obtenerResponsablesProgramacion,
};
