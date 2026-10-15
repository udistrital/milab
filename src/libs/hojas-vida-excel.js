/**
 * Parser de Excel SIGUD para Hojas de Vida de Equipos.
 *
 * El formato SIGUD (GDTH-PG-003-FR-027) es una tabla con filas de pares
 * etiqueta-valor, no una fila de encabezados tradicional. Por cada fila se
 * busca una celda con una etiqueta reconocida y se extrae el valor de la
 * siguiente celda no vacía de la misma fila.
 */

const ExcelJS = require('exceljs');

/**
 * Normaliza un texto para comparación: minúsculas, sin acentos, sin espacios
 * sobrantes.
 * @param {string} texto
 * @returns {string}
 */
function normalizarEtiqueta(texto) {
  if (texto == null) return '';
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapeo de etiquetas SIGUD normalizadas a columnas de la tabla `hoja_vida`.
 * Basado en el formato real GDTH-PG-003-FR-027.
 *
 * Las etiquetas que NO están aquí (ultimo mantenimiento, descripcion de
 * mantenimiento, fecha de creacion, fecha de actualizacion) se ignoran porque
 * pertenecen a la tabla `mantenimiento` o son columnas de auditoría.
 */
const SIGUD_FIELD_MAP = {
  'nombre del equipo': 'nombre_equipo',
  area: 'dependencia',
  modelo: 'referencia_modelo',
  'fecha de compra': 'fecha_adquisicion',
  anio: 'anio',
  ano: 'anio',
  marca: 'marca',
  cantidades: 'cantidad',
  responsable: 'responsable',
  supervisor: 'supervisor',
  'numero de inventario': 'codigo_inventario',
  funcion: 'funcion',
  uso: 'tipo_uso',
  'descripcion fisica': 'descripcion_fisica',
  'especificaciones tecnicas': 'especificaciones_tecnicas',
  'instrucciones de uso': 'instrucciones_uso',
  'condiciones de seguridad': 'condiciones_seguridad',
  'protocolo de limpieza': 'protocolo_limpieza',
  'foto del equipo': 'foto_descripcion',
};

/**
 * Convierte un valor crudo de celda a un tipo apropiado para la columna.
 * @param {string} columna
 * @param {*} valor
 * @returns {*}
 */
function convertirValor(columna, valor) {
  if (valor == null || String(valor).trim() === '') return null;
  const texto = String(valor).trim();

  if (columna === 'cantidad') {
    const num = Number(texto);
    return Number.isFinite(num) ? num : null;
  }

  if (columna === 'fecha_adquisicion') {
    const fecha = new Date(texto);
    if (!Number.isNaN(fecha.getTime())) {
      return fecha.toISOString().slice(0, 10);
    }
    return texto;
  }

  return texto;
}

/**
 * Parsea un buffer de Excel SIGUD y extrae los campos de la hoja de vida.
 *
 * @param {Buffer} buffer - Contenido del archivo Excel (.xlsx/.xls).
 * @returns {Promise<{campos_extraidos: Object, campos_reconocidos: string[], campos_no_reconocidos: string[]}>}
 * @throws {Error} Si el buffer no es un Excel válido o está corrupto.
 */
async function parseSigudExcel(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('El archivo Excel está vacío o no es válido.');
  }

  let workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
  } catch (err) {
    throw new Error(
      'El archivo Excel está dañado o no se puede leer. Verifica que sea un archivo .xlsx válido.',
      { cause: err }
    );
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('El archivo Excel no contiene hojas de cálculo.');
  }

  const campos_extraidos = {};
  const campos_reconocidos = [];
  const campos_no_reconocidos = [];

  worksheet.eachRow({ includeEmpty: false }, function (row) {
    const celdas = [];
    row.eachCell({ includeEmpty: false }, function (cell) {
      celdas.push({
        columna: cell.col,
        valor: cell.value,
      });
    });

    for (let i = 0; i < celdas.length; i++) {
      // En el formato SIGUD las etiquetas van en columnas impares (1, 3, 5...)
      // y los valores en columnas pares (2, 4, 6...). Solo las columnas
      // impares se consideran posibles etiquetas.
      if (celdas[i].columna % 2 === 0) continue;

      const etiqueta = normalizarEtiqueta(celdas[i].valor);
      if (!etiqueta) continue;

      const campo = SIGUD_FIELD_MAP[etiqueta];

      if (campo) {
        // El valor está en la siguiente celda no vacía de la misma fila
        let valor = null;
        for (let j = i + 1; j < celdas.length; j++) {
          if (celdas[j].valor != null && String(celdas[j].valor).trim() !== '') {
            valor = celdas[j].valor;
            break;
          }
        }
        const valorConvertido = convertirValor(campo, valor);
        if (valorConvertido != null) {
          campos_extraidos[campo] = valorConvertido;
        }
        if (!campos_reconocidos.includes(campo)) {
          campos_reconocidos.push(campo);
        }
      } else {
        // Ignorar etiquetas conocidas que no mapean (mantenimiento, auditoria)
        const ignoradas = [
          'ultimo mantenimiento',
          'descripcion de mantenimiento',
          'fecha de creacion',
          'fecha de actualizacion',
          'foto del equipo (descripcion)',
        ];
        if (!ignoradas.includes(etiqueta) && !campos_no_reconocidos.includes(etiqueta)) {
          campos_no_reconocidos.push(etiqueta);
        }
      }
    }
  });

  return {
    campos_extraidos,
    campos_reconocidos,
    campos_no_reconocidos,
  };
}

module.exports = {
  parseSigudExcel,
  SIGUD_FIELD_MAP,
  normalizarEtiqueta,
};
