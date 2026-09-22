/**
 * Cliente para consultar el servicio de certificación EDX.
 *
 * Puede consumir tanto el MOCK como la API real. El switch se hace
 * por variables de entorno (EDX_CERT_USE_MOCK y EDX_CERT_API_URL).
 *
 * Contrato de SALIDA (siempre igual, mock o real):
 *   consultarCurso(usuario, curso)  → Promise<{ completado: boolean }>
 *   consultarCursosUsuario(usuario) → Promise<{ cursos: Array<{codigo_curso, nombre_curso, completado}> }>
 */

const axios = require('axios');

const BASE_URL = process.env.EDX_CERT_API_URL || 'http://localhost:4000';
const TIMEOUT_MS = Number(process.env.EDX_CERT_TIMEOUT_MS || 5000);
const USE_MOCK = process.env.EDX_CERT_USE_MOCK !== 'false';

/**
 * Instancia HTTP preconfigurada. Si en el futuro la API real requiere
 * headers de autenticación (token, API key, etc.), se agregan aquí.
 */
const httpClient = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    'X-Client': 'milab-edx-cert',
    'X-Use-Mock': String(USE_MOCK),
  },
});

/**
 * Endpoint 1 — Consulta si un usuario completó un curso específico.
 *
 * @param {string} codigoUsuario  - código identificador del usuario
 * @param {string} codigoCurso    - código del curso (ej. MOCK-COURSE-001)
 * @returns {Promise<{completado: boolean}>}
 * @throws {Error} Si falla la comunicación con el servicio
 */
async function consultarCurso(codigoUsuario, codigoCurso) {
  try {
    const resp = await httpClient.post('/api/certificacion/curso', {
      codigo_usuario: codigoUsuario,
      codigo_curso: codigoCurso,
    });
    return resp.data;
  } catch (err) {
    const msg = `[EDX-CERT] Error consultando curso ${codigoCurso} para usuario ${codigoUsuario}: ${err.message}`;
    console.error(msg);
    throw new Error(msg, { cause: err });
  }
}

/**
 * Endpoint 2 — Consulta TODOS los cursos (y su estado) de un usuario.
 *
 * @param {string} codigoUsuario - código identificador del usuario
 * @returns {Promise<{cursos: Array<{codigo_curso:string, nombre_curso:string, completado:boolean}>}>}
 * @throws {Error} Si falla la comunicación con el servicio
 */
async function consultarCursosUsuario(codigoUsuario) {
  try {
    const resp = await httpClient.post('/api/certificacion/usuario', {
      codigo_usuario: codigoUsuario,
    });
    return resp.data;
  } catch (err) {
    const msg = `[EDX-CERT] Error consultando cursos del usuario ${codigoUsuario}: ${err.message}`;
    console.error(msg);
    throw new Error(msg, { cause: err });
  }
}

/**
 * Función auxiliar: Health check del servicio. Útil para rutas de
 * diagnóstico o tests de integración.
 *
 * @returns {Promise<boolean>} true = servicio disponible
 */
async function healthCheck() {
  try {
    const resp = await httpClient.get('/health');
    return resp.status === 200 && resp.data?.status === 'ok';
  } catch {
    return false;
  }
}

module.exports = {
  consultarCurso,
  consultarCursosUsuario,
  healthCheck,
  USE_MOCK,
  BASE_URL,
};
