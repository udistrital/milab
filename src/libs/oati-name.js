const axios = require('axios');

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

async function fetchOatiStudentName(identifier) {
  const value = String(identifier || '').trim();

  if (!value || value === '0') {
    return '';
  }

  const endpoints = [
    'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
      'servicios_academicos_produccion/datos_basicos_activos_cedula/' +
      value,
    'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
      'servicios_academicos_produccion/datos_basicos_estudiante/' +
      value,
  ];

  for (const url of endpoints) {
    try {
      const response = await axios.get(url, { timeout: 6000 });
      const records = extractOasStudentRecords(response.data);
      const record = records[records.length - 1];
      const name = record?.nombre ? String(record.nombre).trim() : '';

      if (name) {
        return name;
      }
    } catch {
      // ignore and try next endpoint
    }
  }

  return '';
}

async function fetchOatiTeacherName(documento) {
  const value = String(documento || '').trim();

  if (!value || value === '0') {
    return '';
  }

  try {
    const url =
      'https://autenticacion.portaloas.udistrital.edu.co/wso2eiserver/services/' +
      'servicios_academicos_produccion/consultar_estado_docente/' +
      value;
    const response = await axios.get(url, { timeout: 6000 });
    const docente = response.data?.docentesCollection?.docente?.[0];
    return docente?.nombre ? String(docente.nombre).trim() : '';
  } catch {
    return '';
  }
}

async function resolveOatiName(identifier) {
  const studentName = await fetchOatiStudentName(identifier);
  if (studentName) return studentName;

  return fetchOatiTeacherName(identifier);
}

module.exports = { resolveOatiName };
