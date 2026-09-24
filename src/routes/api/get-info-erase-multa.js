const express = require('express');

const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilEstudiante } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');
const { resolveMultaConfigForMultaId } = require('../../libs/multa-config');

require('dotenv').config();

const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

function extractOasStudentRecords(payload) {
  if (!payload) return [];

  const nested = payload?.datosEstudianteCollection?.datosBasicosEstudiante;
  if (Array.isArray(nested)) return nested;
  if (nested) return [nested];

  const flat = payload?.datosBasicosEstudiante;
  if (Array.isArray(flat)) return flat;
  if (flat) return [flat];

  return [];
}

async function resolveStudentDocumentByCode(code) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return null;

  const result = await pool.query(
    `SELECT documento
     FROM perfil_estudiante
     WHERE codigo::text = $1
       AND documento IS NOT NULL
       AND TRIM(documento) <> ''
     ORDER BY usuario_id DESC
     LIMIT 1`,
    [normalizedCode]
  );

  return result.rows[0]?.documento || null;
}

// UALs asignadas al laboratorista en sesión, para permitirle retirar cualquier sanción de sus labs.
async function resolveLaboratoristaUalIds(sessionDocument) {
  const normalizedDocument = String(sessionDocument || '').trim();
  if (!normalizedDocument) return [];

  const laboratoristaResult = await pool.query(
    'SELECT documento FROM laboratorista WHERE documento = $1 OR n_usuario = $1 LIMIT 1',
    [normalizedDocument]
  );
  const laboratoristaDocument = laboratoristaResult.rows[0]?.documento;
  if (!laboratoristaDocument) return [];

  const ualResult = await pool.query(
    'SELECT ual_id FROM laboratorista_ual WHERE laboratorista_documento_id = $1',
    [laboratoristaDocument]
  );
  return ualResult.rows.map((row) => Number(row.ual_id)).filter((id) => Number.isFinite(id));
}

const requireLaboratoristaEraseAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Algo ha salido mal!',
  message2: 'Inténtalo nuevamente',
  limit: 'noSession',
});

router.post('/', requireLaboratoristaEraseAccess, async function (req, res) {
  res.set('Cache-Control', 'no-store');

  const requestBody = req.body || {};
  const { tipo_busqueda, valor_busqueda } = requestBody;

  let con_codigo, con_estado, con_documento, con_carrera, con_nombre;
  let multaInfo;

  try {
    // Consulta 1 - Datos básicos del estudiante
    let servicePath;
    if (tipo_busqueda === 'codigo') {
      servicePath = getAcademicServicePath(`datos_basicos_estudiante/${valor_busqueda}`);
    } else {
      servicePath = getAcademicServicePath(`datos_basicos_activos_cedula/${valor_busqueda}`);
    }

    const dato1 = await requestOati(servicePath);
    const studentRecords = extractOasStudentRecords(dato1);
    if (!studentRecords.length) {
      throw new Error('Estudiante no encontrado en OAS');
    }

    const studentRecord = studentRecords[studentRecords.length - 1];

    con_codigo = studentRecord.codigo;
    con_estado = studentRecord.estado;
    con_documento =
      studentRecord.documento || studentRecord.numero_documento_identificacion || null;
    if (
      (!con_documento || con_documento === 'undefined' || con_documento === 'null') &&
      tipo_busqueda === 'codigo'
    ) {
      con_documento = await resolveStudentDocumentByCode(con_codigo || valor_busqueda);
    }
    if (
      (!con_documento || con_documento === 'undefined' || con_documento === 'null') &&
      tipo_busqueda === 'documento'
    ) {
      con_documento = String(valor_busqueda || '').trim();
    }
    con_carrera = studentRecord.carrera;
    con_nombre = studentRecord.nombre;

    if (!con_documento || con_documento === 'undefined' || con_documento === 'null') {
      return res.render('home/error-consulta', {
        message: 'No se pudo resolver el documento del estudiante.',
      });
    }

    // Consulta 2 - Estado académico
    const estadoData = await requestOati(getAcademicServicePath(`estados_codigo/${con_estado}`));
    con_estado = estadoData.estado.nombre;

    // Consulta 3 - Carrera
    const carreraData = await requestOati(getAcademicServicePath(`carrera/${con_carrera}`));
    con_carrera = carreraData.carrerasCollection.carrera[0].nombre;

    const usuarioId = await ensurePerfilEstudiante({
      documento: con_documento,
      nombre: con_nombre,
      codigo: con_codigo,
      programa: con_carrera,
      estado: con_estado,
      correo: null,
    });

    if (!usuarioId) {
      return res.render('home/error-consulta', {
        message: 'No se pudo registrar el perfil del estudiante.',
      });
    }

    const query =
      "SELECT COUNT(*) AS multado FROM multa WHERE usuario_sancionado_id = $1 AND con_estado_multa = 'ACTIVA'";
    const values = [usuarioId];
    const result = await pool.query(query, values);

    if (result.rows[0].multado > 0) {
      const queryMultaInfo =
        "SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_sancionado_id LEFT JOIN ual u ON u.ual_id = m.ual_id LEFT JOIN laboratorista l ON l.documento = m.laboratorista_documento_id WHERE m.usuario_sancionado_id = $1 AND m.con_estado_multa = 'ACTIVA'";
      const valuesMultaInfo = [usuarioId];
      const resultMultaInfo = await pool.query(queryMultaInfo, valuesMultaInfo);
      multaInfo = resultMultaInfo.rows;
      if (multaInfo && multaInfo.length) {
        const configs = await Promise.all(multaInfo.map((m) => resolveMultaConfigForMultaId(m.id)));
        multaInfo = multaInfo.map((m, idx) => ({
          ...m,
          _permiteSaldarDirecta: Boolean(
            configs[idx] && configs[idx].permite_saldar_multas_directas
          ),
        }));
      }

      console.log(`Cantidad de multas activas encontradas para retiro: ${multaInfo.length}`);
      console.log(multaInfo);
      // ...existing code...
    } else {
      console.log('El estudiante no tiene multas activas.');
      return res.render('home/alerta-no-multado', {
        message: 'El estudiante no tiene multas activas.',
      });
    }

    // Verificar si es egresado
    if (con_estado === 'EGRESADO') {
      console.log('El estudiante es egresado. No se puede continuar.');
      return res.render('home/alerta-egresado', {
        message: 'El estudiante es egresado. No se puede continuar.',
      });
    }

    // Renderizar vista con datos
    const actorRole = String(req.session?.user?.tipo || '').toLowerCase();
    const laboratoristaUalIds =
      actorRole === 'laboratorista'
        ? await resolveLaboratoristaUalIds(
            req.session?.user?.documento_real || req.session?.user?.documento
          )
        : [];

    return res.render('home/reg_multa_erase', {
      con_codigo,
      con_estado,
      con_documento,
      con_carrera,
      con_nombre,
      multaInfo,
      laboratoristaUalIds,
    });
  } catch (error) {
    console.error('Error durante la consulta:', error);
    return res.render('home/error-consulta', {
      message: 'Se ha producido un error',
    });
  }
});

module.exports = router;
