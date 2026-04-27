const express = require('express');
const pool = require('../../libs/db');
const axios = require('axios');
const { requireRoles } = require('../middlewares/auth');
const router = express.Router();

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
        SELECT d.correo, 1 AS priority
        FROM docente d
        WHERE d.cc::text = $1

        UNION ALL

        SELECT a.correo, 2 AS priority
        FROM auth a
        WHERE a.documento = $1
      ) candidates
      WHERE correo IS NOT NULL
        AND correo <> ''
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
  const { documento } = req.body;

  if (!documento) {
    return res.render('home/verificar_docente', {
      error: 'Por favor ingrese un número de documento',
    });
  }

  try {
    // 1. Consultar OAS para obtener datos del docente
    const oasUrl =
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/servicios_academicos_produccion/consultar_estado_docente/' +
      documento;
    const oasResponse = await axios.get(oasUrl);
    const datosDocente = oasResponse.data;

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

    // 2. Consultar Multas en BD local
    const queryMultas = "SELECT * FROM multas WHERE cod_multado = $1 AND con_estado_multa='ACTIVA'";
    const resultMultas = await pool.query(queryMultas, [con_documento]);

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
