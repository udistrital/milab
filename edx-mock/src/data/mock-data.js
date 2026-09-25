/**

 * - Usuarios con código que empieza por "1" → TIENEN certificados (completado: true)
 * - Usuarios con código que empieza por "2" → NO TIENEN certificados (completado: false)
 * - Usuarios con código que empieza por "3" → certificados PARCIALES (mezcla)
 * - Usuarios con código que empieza por "9" → USUARIO NO EXISTE (lista vacía)
 *
 * Cursos de prueba:
 *   MOCK-COURSE-001 → Curso de prueba 1
 *   MOCK-COURSE-002 → Curso de prueba 2
 *   MOCK-COURSE-003 → Curso de prueba 3
 *   MOCK-COURSE-004 → Curso de prueba 4
 */

const CATALOGO_CURSOS = [
  { codigo_curso: 'MOCK-COURSE-001', nombre_curso: 'Curso de prueba 1' },
  { codigo_curso: 'MOCK-COURSE-002', nombre_curso: 'Curso de prueba 2' },
  { codigo_curso: 'MOCK-COURSE-003', nombre_curso: 'Curso de prueba 3' },
  { codigo_curso: 'MOCK-COURSE-004', nombre_curso: 'Curso de prueba 4' },
];

/**
 * @param {string} codigoUsuario
 * @returns {'todos'|'ninguno'|'parcial'|'vacio'}
 */
function clasificarUsuario(codigoUsuario) {
  const cod = String(codigoUsuario || '');
  const primerDigito = cod.charAt(0);
  switch (primerDigito) {
    case '1':
      return 'todos';
    case '2':
      return 'ninguno';
    case '3':
      return 'parcial';
    case '9':
      return 'vacio';
    default:
      return 'parcial';
  }
}

/**
 
 * @param {string} codigoUsuario
 * @returns {Array<{codigo_curso:string, nombre_curso:string, completado:boolean}>}
 */
function obtenerCursosUsuario(codigoUsuario) {
  const escenario = clasificarUsuario(codigoUsuario);

  if (escenario === 'vacio') return [];

  return CATALOGO_CURSOS.map((curso, idx) => {
    let completado;
    switch (escenario) {
      case 'todos':
        completado = true;
        break;
      case 'ninguno':
        completado = false;
        break;
      case 'parcial':
      default:
        completado = idx % 2 === 0;
        break;
    }
    return {
      codigo_curso: curso.codigo_curso,
      nombre_curso: curso.nombre_curso,
      completado,
    };
  });
}

/**
 
 * @param {string} codigoUsuario
 * @param {string} codigoCurso
 * @returns {boolean}
 */
function estaCursoCompletado(codigoUsuario, codigoCurso) {
  const cursos = obtenerCursosUsuario(codigoUsuario);
  const match = cursos.find((c) => c.codigo_curso === codigoCurso);
  return match ? match.completado : false;
}

module.exports = {
  CATALOGO_CURSOS,
  clasificarUsuario,
  obtenerCursosUsuario,
  estaCursoCompletado,
};
