const express = require('express');
const pool = require('../../libs/db');
const { getAcademicServicePath, requestOati } = require('../../libs/oati-client');
const { ensurePerfilEstudiante, resolveUsuarioIdForStudent } = require('../../libs/user-identity');
const { requireRoles } = require('../middlewares/auth');
const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

const requireVerificationAccess = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver esta página',
  limit: 'noSession',
});

const requireVerificationAction = requireRoles(['admin', 'laboratorista', 'coordinador'], {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para realizar esta acción',
  limit: 'noSession',
});

function normalizeAcademicStatus(value) {
  return (value || '').toString().trim().toUpperCase();
}

function isEgresadoStatus(value) {
  return normalizeAcademicStatus(value) === 'EGRESADO';
}

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

function extractStudentCodes(records) {
  if (!Array.isArray(records)) return [];
  return records
    .map((item) => String(item?.codigo || '').trim())
    .filter((value) => value && value !== '0');
}

async function fetchStudentRecordsByDocumento(documento) {
  if (!documento || documento === '0') return [];

  try {
    const response = await requestOati(
      getAcademicServicePath(`datos_basicos_activos_cedula/${documento}`)
    );
    return extractOasStudentRecords(response);
  } catch {
    return [];
  }
}

async function resolveStudentEmail(documento, codigo) {
  const codigoParam = codigo ? String(codigo) : null;

  const result = await pool.query(
    `
      SELECT correo
      FROM (
        SELECT u.correo, u.documento, 1 AS priority
        FROM usuario u
        WHERE ($1::text <> '0' AND u.documento = $1::text)
          OR ($2::text IS NOT NULL AND u.codigo::text = $2::text)
      ) candidates
      WHERE correo IS NOT NULL
        AND correo <> ''
        AND LOWER(correo) <> LOWER(documento::text || '@udistrital.edu.co')
        AND LOWER(correo) NOT LIKE 'no-email+%@placeholder.milab.local'
      ORDER BY priority
      LIMIT 1
    `,
    [documento, codigoParam]
  );

  return result.rows[0]?.correo || '';
}

router.get('/', requireVerificationAccess, (req, res) => {
  res.render('home/verificar_estudiante', { error: null });
});

router.post('/', requireVerificationAction, async (req, res) => {
  const requestBody = req.body || {};
  const { tipo_busqueda, valor_busqueda } = requestBody;

  if (!valor_busqueda) {
    return res.render('home/verificar_estudiante', {
      error: 'Por favor ingrese un número de documento o código',
    });
  }

  try {
    // 1. Consultar OAS para obtener datos del estudiante
    let servicePath;
    if (tipo_busqueda === 'codigo') {
      servicePath = getAcademicServicePath(`datos_basicos_estudiante/${valor_busqueda}`);
    } else {
      servicePath = getAcademicServicePath(`datos_basicos_activos_cedula/${valor_busqueda}`);
    }

    const datosEstudiante = await requestOati(servicePath);

    const studentRecords = extractOasStudentRecords(datosEstudiante);

    if (!studentRecords.length) {
      return res.render('home/verificar_estudiante', {
        error: 'Estudiante no encontrado en el sistema académico (OAS) o no activo.',
      });
    }

    const ultimoEstudiante = studentRecords[studentRecords.length - 1];

    const con_codigo = ultimoEstudiante.codigo;
    const con_nombre = ultimoEstudiante.nombre;
    const con_carrera_code = ultimoEstudiante.carrera;
    const con_estado_code = ultimoEstudiante.estado;
    // Si buscamos por código, el documento viene en la respuesta. Si es por documento, es el valor de búsqueda (o el de la respuesta).
    // Si el documento es null, undefined o 'N/A', y la búsqueda fue por código, asignamos '0'.
    let documento =
      ultimoEstudiante.documento || (tipo_busqueda === 'documento' ? valor_busqueda : '0');
    if (!documento || documento === 'undefined' || documento === 'null') {
      documento = '0';
    }

    // Obtener nombre de la carrera y estado
    let con_carrera_nombre = con_carrera_code;
    let con_estado_nombre = con_estado_code;

    try {
      const carreraResponse = await requestOati(
        getAcademicServicePath(`carrera/${con_carrera_code}`)
      );
      if (
        carreraResponse &&
        carreraResponse.carrerasCollection &&
        carreraResponse.carrerasCollection.carrera
      ) {
        con_carrera_nombre = carreraResponse.carrerasCollection.carrera[0].nombre;
      }

      const estadoResponse = await requestOati(
        getAcademicServicePath(`estados_codigo/${con_estado_code}`)
      );
      if (estadoResponse && estadoResponse.estado && estadoResponse.estado.nombre) {
        con_estado_nombre = estadoResponse.estado.nombre;
      }
    } catch (apiError) {
      console.error('Error consultando detalles de carrera/estado:', apiError);
      // Continuamos con los códigos si fallan los nombres
    }

    if (isEgresadoStatus(con_estado_nombre)) {
      return res.render('home/message_error', {
        message: 'Estudiante egresado',
        message2: 'No es posible generar el certificado para estudiantes egresados.',
        limit: null,
      });
    }

    let codigoList = extractStudentCodes(studentRecords);

    if (tipo_busqueda === 'codigo' && documento !== '0') {
      const recordsByDocumento = await fetchStudentRecordsByDocumento(documento);
      const documentCodes = extractStudentCodes(recordsByDocumento);
      if (documentCodes.length) {
        codigoList = documentCodes;
      }
    }

    if (!codigoList.length && con_codigo) {
      codigoList = [String(con_codigo)];
    }

    let usuarioId = null;
    if (documento && documento !== '0') {
      usuarioId = await ensurePerfilEstudiante({
        documento,
        nombre: con_nombre,
        codigo: con_codigo,
        programa: con_carrera_nombre,
        estado: con_estado_nombre,
        correo: null,
      });
    } else {
      usuarioId = await resolveUsuarioIdForStudent({ documento: null, codigo: con_codigo });
    }

    if (!usuarioId) {
      return res.render('home/verificar_estudiante', {
        error: 'No fue posible resolver el perfil del estudiante.',
      });
    }

    // 2. Consultar Multas en BD local
    const queryMultas =
      "SELECT m.*, us.documento AS documento_sancionado, u.nombre AS ual, l.nombre AS nombre_laboratorista, l.documento AS cc_laboratorista FROM multa m LEFT JOIN usuario us ON us.id = m.usuario_id_sancionado LEFT JOIN ual u ON u.id_ual = m.id_ual LEFT JOIN laboratorista l ON l.documento = m.documento_laboratorista WHERE m.usuario_id_sancionado = $1 AND m.con_estado_multa IN ('ACTIVA','Pendiente','POR SALDAR')";
    const resultMultas = await pool.query(queryMultas, [usuarioId]);

    if (resultMultas.rows.length > 0) {
      // Tiene multas activas
      return res.render('home/alerta-multado', {
        multaInfo: resultMultas.rows,
      });
    } else {
      const correo = await resolveStudentEmail(documento, con_codigo);

      // No tiene multas - Mostrar formulario para generar certificado (get-info2)
      // Pasamos los datos necesarios para que get-info2 los muestre y get-data los procese
      return res.render('home/get-info2', {
        nombre: con_nombre,
        documento: documento,
        carrera: con_carrera_nombre,
        estado: con_estado_nombre,
        codigo: con_codigo,
        correo,
        correoAutoDetectado: Boolean(correo),
        tipo: req.session.user.tipo, // Para mantener la sesión válida en la vista
      });
    }
  } catch (error) {
    console.error('Error en verificar_estudiante:', error);
    return res.render('home/verificar_estudiante', {
      error: 'Ocurrió un error al verificar el estudiante. Por favor intente nuevamente.',
    });
  }
});

module.exports = router;
