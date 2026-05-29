const { requestOati, getAcademicServicePath } = require('./oati-client');

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
    getAcademicServicePath(`datos_basicos_activos_cedula/${value}`),
    getAcademicServicePath(`datos_basicos_estudiante/${value}`),
  ];

  for (const pathname of endpoints) {
    try {
      const data = await requestOati(pathname);
      const records = extractOasStudentRecords(data);
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
    const data = await requestOati(getAcademicServicePath(`consultar_estado_docente/${value}`));
    const docente = data?.docentesCollection?.docente?.[0];
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
