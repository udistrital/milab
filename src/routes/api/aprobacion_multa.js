const express = require('express');
const pool = require('../../libs/db');
const { resolveCoordinatorScope } = require('../../libs/faculty-scope');
const { requireRoles } = require('../middlewares/auth');
const {
  SANCTION_TYPES,
  normalizeSanctionType,
  isValidSanctionType,
  fetchMultaConfigsForFacultyIds,
  upsertConfigForFacultyId,
  logConfigChangeToAuditoria,
} = require('../../libs/multa-config');
const {
  resolveStudentContactByUsuarioId,
  sendSanctionActivationEmail,
} = require('../../libs/sanction-email');

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const requireCoordinadorApprovalAccess = requireRoles('coordinador', {
  message: '¡Algo ha salido mal!',
  message2: 'No tienes permisos para acceder a esta vista.',
  limit: 'noSession',
});

const requireCoordinadorApprovalAction = requireRoles('coordinador', {
  message: 'No autorizado',
  message2: 'Tu sesión no tiene permisos suficientes.',
  limit: 'noSession',
});

// GET: Vista de aprobación de multas
router.get('/', requireCoordinadorApprovalAccess, async function (req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const scope = await resolveCoordinatorScope(pool, req.session.user.documento);

    if (!scope.coordinatorDocument) {
      return res.render('home/message_error', {
        message: 'No se encontró información del coordinador.',
        message2: 'Verifique su cuenta',
        limit: null,
      });
    }

    if (scope.facultyIds.length === 0) {
      return res.render('home/message_error', {
        message: 'No hay facultades asociadas al coordinador.',
        message2: 'Contacte al administrador',
        limit: null,
      });
    }

    const result = await pool.query(
      `SELECT 
        m.id,
        COALESCE(pe.documento, pd.documento, us.documento) AS documento_sancionado,
        m.usuario_sancionado_id,
        CASE WHEN pd.usuario_id IS NOT NULL THEN 'docente' ELSE 'estudiante' END AS tipo_sancionado,
        us.codigo AS codigo_sancionado,
        l.nombre AS nombre_laboratorista,
        m.cat_multa,
        u.nombre AS ual, 
        m.fecha_multa, 
        m.con_estado_multa, 
        m.obs_multa,
        m.tipo_sancion
      FROM multa m
      INNER JOIN ual u ON u.ual_id = m.ual_id
      LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id
        LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id
        LEFT JOIN perfil_estudiante pe ON pe.usuario_id = m.usuario_sancionado_id
        LEFT JOIN perfil_docente pd ON pd.usuario_id = m.usuario_sancionado_id
      WHERE m.con_estado_multa IN ('Pendiente', 'POR SALDAR')
        AND u.facultad_id = ANY($1::int[])`,
      [scope.facultyIds]
    );

    const multasPendientes = result.rows;

    const facultadesResult = await pool.query(
      'SELECT facultad_id, nombre FROM facultad WHERE facultad_id = ANY($1::int[]) ORDER BY nombre ASC',
      [scope.facultyIds]
    );
    const configMap = await fetchMultaConfigsForFacultyIds(scope.facultyIds);
    const facultadesParaAutorizar = facultadesResult.rows.map((row) => {
      const cfg = configMap.get(Number(row.facultad_id)) || {};
      return {
        facultad_id: Number(row.facultad_id),
        nombre: row.nombre,
        permite_crear_multas_activas_directas: Boolean(cfg.permite_crear_multas_activas_directas),
        permite_saldar_multas_directas: Boolean(cfg.permite_saldar_multas_directas),
        fecha_ultima_modificacion: cfg.fecha_ultima_modificacion || null,
        documento_ultimo_autorizador: cfg.documento_ultimo_autorizador || null,
        accion_ultima: cfg.accion_ultima || 'inicial',
      };
    });

    res.set('Cache-Control', 'no-store');
    return res.render('home/aprobacion_multa', {
      multas: multasPendientes,
      nombreCoordinador: req.session.user.nombre,
      SANCTION_TYPES,
      facultadesParaAutorizar,
    });
  } catch (error) {
    console.error('Error en /aprobacion_multa:', error);
    return res.render('home/message_error', {
      message: 'Error al cargar sanciones.',
      message2: 'Por favor, intenta más tarde.',
      limit: null,
    });
  }
});

// POST: Activar sanción (de Pendiente a ACTIVA)
router.post('/activar', requireCoordinadorApprovalAction, async function (req, res) {
  const body = req.body || {};
  const { multa_id } = body;
  const tipo_sancion = normalizeSanctionType(body.tipo_sancion);

  if (!isValidSanctionType(tipo_sancion)) {
    return res.render('home/message_error', {
      message: 'Tipo de sanción inválido',
      message2: 'Selecciona una opción válida antes de activar la sanción.',
      limit: null,
    });
  }

  try {
    const scope = await resolveCoordinatorScope(pool, req.session.user.documento);

    if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: 'La cuenta no tiene facultades asociadas.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multa AS m
      SET con_estado_multa = 'ACTIVA',
          tipo_sancion = $2
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'Pendiente'
        AND u.ual_id = m.ual_id
        AND u.facultad_id = ANY($3::int[])
    `,
      [multa_id, tipo_sancion, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo activar la sanción.',
        message2: "Verifica que esté en estado 'Pendiente'.",
        limit: null,
      });
    }

    const multaInfo = await pool.query(
      'SELECT m.usuario_sancionado_id, m.fecha_multa, u.nombre AS ual, m.obs_multa FROM multa m LEFT JOIN ual u ON u.ual_id = m.ual_id WHERE m.id = $1',
      [multa_id]
    );
    const usuarioId = multaInfo.rows[0]?.usuario_sancionado_id;
    const studentInfo = await resolveStudentContactByUsuarioId(usuarioId);
    const referencia = studentInfo?.codigo || studentInfo?.documento || '';
    await pool.query(
      `
        INSERT INTO log (nombre, documento, accion, persona)
        VALUES ($1, $2, $3, $4)
      `,
      [
        req.session.user.tipo,
        scope.coordinatorDocument,
        'Cambiar estado de multa a ACTIVA',
        referencia || String(multa_id),
      ]
    );
    if (studentInfo?.correo) {
      const emailResult = await sendSanctionActivationEmail({
        correo: studentInfo.correo,
        nombre: studentInfo.nombre,
        codigo: referencia,
        tipoSancion: tipo_sancion,
        observaciones: multaInfo.rows[0]?.obs_multa,
        laboratorio: multaInfo.rows[0]?.ual,
        fecha: multaInfo.rows[0]?.fecha_multa,
      });

      if (!emailResult || emailResult.ok !== true) {
        throw new Error('No fue posible enviar el correo de sanción activada.');
      }
    }

    res.redirect('./');
  } catch (error) {
    console.error('Error al activar sanción:', error);
    res.render('home/message_error', {
      message: 'Error al activar la sanción.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

// POST: Marcar sanción como SALDADA (de POR SALDAR a SALDADA)
router.post('/saldar', requireCoordinadorApprovalAction, async function (req, res) {
  const body = req.body || {};
  const { multa_id } = body;

  try {
    const scope = await resolveCoordinatorScope(pool, req.session.user.documento);

    if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
      return res.render('home/message_error', {
        message: 'No autorizado',
        message2: 'La cuenta no tiene facultades asociadas.',
        limit: null,
      });
    }

    const result = await pool.query(
      `
      UPDATE multa AS m
      SET con_estado_multa = 'SALDADA'
      FROM ual u
      WHERE m.id = $1
        AND m.con_estado_multa = 'POR SALDAR'
        AND u.ual_id = m.ual_id
        AND u.facultad_id = ANY($2::int[])
    `,
      [multa_id, scope.facultyIds]
    );

    if (result.rowCount === 0) {
      return res.render('home/message_error', {
        message: 'No se pudo marcar como saldada.',
        message2: "Verifica que esté en estado 'POR SALDAR'.",
        limit: null,
      });
    }

    const sancionadoResult = await pool.query(
      'SELECT u.documento FROM multa m LEFT JOIN usuario u ON u.id = m.usuario_sancionado_id WHERE m.id = $1',
      [multa_id]
    );
    const documentoSancionado = sancionadoResult.rows[0]?.documento || String(multa_id);

    await pool.query(
      `
      INSERT INTO log (nombre, documento, accion, persona)
      VALUES ($1, $2, $3, $4)
    `,
      [
        req.session.user.tipo,
        scope.coordinatorDocument,
        'Cambiar estado de multa a SALDADA',
        documentoSancionado,
      ]
    );

    res.redirect('./');
  } catch (error) {
    console.error('Error al marcar sanción como saldada:', error);
    res.render('home/message_error', {
      message: 'Error al marcar como saldada.',
      message2: 'Por favor, intenta nuevamente.',
      limit: null,
    });
  }
});

function buildToggleConfigHandler(flag, accionHabilitar, accionDeshabilitar, descripcionBase) {
  return async function (req, res) {
    try {
      const scope = await resolveCoordinatorScope(pool, req.session.user.documento);
      if (!scope.coordinatorDocument || scope.facultyIds.length === 0) {
        return res.render('home/message_error', {
          message: 'No autorizado',
          message2: 'La cuenta no tiene facultades asociadas.',
          limit: null,
        });
      }
      const facultadIdParam = Number(req.params.facultad_id);
      if (!Number.isFinite(facultadIdParam)) {
        return res.render('home/message_error', {
          message: 'Facultad inválida',
          message2: 'No se pudo interpretar el identificador de la facultad.',
          limit: null,
        });
      }
      if (!scope.facultyIds.includes(facultadIdParam)) {
        return res.render('home/message_error', {
          message: 'No autorizado',
          message2: 'No puedes gestionar la configuración de esta facultad.',
          limit: null,
        });
      }
      const currentCfg =
        scope.facultyIds && scope.facultyIds.length
          ? (await fetchMultaConfigsForFacultyIds([facultadIdParam])).get(facultadIdParam)
          : null;
      const currentValue = Boolean(currentCfg && currentCfg[flag]);
      const nextValue = !currentValue;
      const accionAudit = nextValue ? accionHabilitar : accionDeshabilitar;
      const descripcion = nextValue
        ? `${descripcionBase} habilitada para facultad ${facultadIdParam}`
        : `${descripcionBase} deshabilitada para facultad ${facultadIdParam}`;
      await upsertConfigForFacultyId(
        facultadIdParam,
        { [flag]: nextValue },
        scope.coordinatorDocument,
        accionAudit
      );
      await logConfigChangeToAuditoria(pool, scope.coordinatorDocument, accionAudit, descripcion, {
        facultad_id: facultadIdParam,
        flag,
        nuevo_valor: nextValue,
      });
      await pool.query(
        `INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)`,
        [req.session.user.tipo, scope.coordinatorDocument, accionAudit, String(facultadIdParam)]
      );
      return res.redirect('/milab/aprobacion_multa');
    } catch (error) {
      console.error('Error al cambiar configuración de facultad:', error);
      return res.render('home/message_error', {
        message: 'Error al actualizar configuración.',
        message2: 'Por favor, intenta nuevamente.',
        limit: null,
      });
    }
  };
}

router.post(
  '/configuracion/:facultad_id/toggle-crear-directa',
  requireCoordinadorApprovalAction,
  buildToggleConfigHandler(
    'permite_crear_multas_activas_directas',
    'CONFIG_MULTAS_HABILITAR_CREACION_DIRECTA',
    'CONFIG_MULTAS_DESHABILITAR_CREACION_DIRECTA',
    'Autorización de creación de sanciones activas directas'
  )
);

router.post(
  '/configuracion/:facultad_id/toggle-saldar-directa',
  requireCoordinadorApprovalAction,
  buildToggleConfigHandler(
    'permite_saldar_multas_directas',
    'CONFIG_MULTAS_HABILITAR_SALDO_DIRECTO',
    'CONFIG_MULTAS_DESHABILITAR_SALDO_DIRECTO',
    'Autorización de saldo directo de sanciones'
  )
);

module.exports = router;
