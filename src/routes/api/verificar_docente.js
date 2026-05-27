const express = require('express');
const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilDocente } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');
const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireTeacherVerificationAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver esta página',
  limit: 'noSession',
});

const requireTeacherVerificationAction = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para realizar esta acción',
  limit: 'noSession',
});

async function resolveTeacherEmail(documento) {
  const result = await pool.query(
    `
      SELECT correo
      FROM (
        SELECT u.correo, u.documento, 1 AS priority
        FROM usuario u
        WHERE u.documento = $1::text
      ) candidates
      WHERE correo IS NOT NULL
        AND correo <> ''
        AND LOWER(correo) <> LOWER(documento::text || '@udistrital.edu.co')
        AND LOWER(correo) NOT LIKE 'no-email+%@placeholder.milab.local'
      ORDER BY priority
      LIMIT 1
    `,
    [documento]
  );

  return result.rows[0]?.correo || '';
}

router.get('/', requireTeacherVerificationAccess, (req, res) => {
  res.render('home/verificar_docente', { error: null });
});

router.post('/', requireTeacherVerificationAction, async (req, res) => {
  const requestBody = req.body || {};
  const { documento } = requestBody;

  if (!documento) {
    return res.render('home/verificar_docente', {
      error: 'Por favor ingrese un número de documento',
    });
  }

  try {
    // 1. Consultar OAS para obtener datos del docente
    const datosDocente = await requestOati(
      getAcademicServicePath(`consultar_estado_docente/${documento}`)
    );

    if (
      !datosDocente ||
      !datosDocente.docentesCollection ||
      !datosDocente.docentesCollection.docente
    ) {
      return res.render('home/verificar_docente', {
        error: 'Docente no encontrado en el sistema académico (OAS) o no activo.',
      });
    }

    const docente = datosDocente.docentesCollection.docente[0];

    const con_nombre = docente.nombre;
    const con_estado = docente.estado_docente;
    const con_documento = documento;

    const usuarioId = await ensurePerfilDocente({
      documento: con_documento,
      nombre: con_nombre,
      estado: con_estado,
      correo: null,
    });

    if (!usuarioId) {
      return res.render('home/verificar_docente', {
        error: 'No fue posible registrar el perfil del docente.',
      });
    }

    // 2. Consultar Multas en BD local
    const queryMultas =
      "SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_id_sancionado LEFT JOIN ual u ON u.id_ual = m.id_ual LEFT JOIN laboratorista l ON l.documento = m.documento_laboratorista WHERE m.usuario_id_sancionado = $1 AND m.con_estado_multa='ACTIVA'";
    const resultMultas = await pool.query(queryMultas, [usuarioId]);

    if (resultMultas.rows.length > 0) {
      // Tiene multas activas
      return res.render('home/alerta-multado', {
        multaInfo: resultMultas.rows,
      });
    } else {
      const correo = await resolveTeacherEmail(con_documento);

      // No tiene multas - Mostrar formulario para generar certificado (get-info-docente)
      return res.render('home/get-info-docente', {
        nombre: con_nombre,
        documento: con_documento,
        estado: con_estado,
        correo,
        correoAutoDetectado: Boolean(correo),
        tipo: req.session.user.tipo, // Para mantener la sesión válida en la vista
      });
    }
  } catch (error) {
    console.error('Error en verificar_docente:', error);
    return res.render('home/verificar_docente', {
      error: 'Ocurrió un error al verificar el docente. Por favor intente nuevamente.',
    });
  }
});

module.exports = router;
