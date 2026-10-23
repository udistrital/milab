const TIPOS_MANTENIMIENTO = [
  { codigo: 'PREVENTIVO', etiqueta: 'Preventivo' },
  { codigo: 'CORRECTIVO', etiqueta: 'Correctivo' },
  { codigo: 'PREDICTIVO', etiqueta: 'Predictivo' },
  { codigo: 'CALIBRACION', etiqueta: 'Calibración' },
  { codigo: 'LIMPIEZA', etiqueta: 'Limpieza' },
  { codigo: 'OTRO', etiqueta: 'Otro' },
];

// El codigo historico se mantiene como PENDIENTE, pero en la interfaz se muestra
// como "Programado" para alinearse con el lenguaje del formato SIGUD.
const ESTADOS_MANTENIMIENTO = [
  { codigo: 'PENDIENTE', etiqueta: 'Programado', clase: 'secondary' },
  { codigo: 'EN_EJECUCION', etiqueta: 'En ejecución', clase: 'primary' },
  { codigo: 'CUMPLIDO', etiqueta: 'Cumplido', clase: 'success' },
  { codigo: 'VENCIDO', etiqueta: 'Vencido', clase: 'danger' },
  { codigo: 'CANCELADO', etiqueta: 'Cancelado', clase: 'dark' },
];

// Situaciones derivadas para las alertas de mantenimiento.
const SITUACIONES_MANTENIMIENTO = [
  { codigo: 'VIGENTE', etiqueta: 'Mantenimiento vigente', clase: 'success' },
  { codigo: 'PROXIMO_VENCER', etiqueta: 'Mantenimiento próximo', clase: 'warning' },
  { codigo: 'VENCIDO', etiqueta: 'Mantenimiento vencido', clase: 'danger' },
  { codigo: 'EN_EJECUCION', etiqueta: 'Mantenimiento en ejecución', clase: 'primary' },
  { codigo: 'CUMPLIDO', etiqueta: 'Mantenimiento cumplido', clase: 'success' },
  { codigo: 'CANCELADO', etiqueta: 'Mantenimiento cancelado', clase: 'dark' },
];

const CODIGOS_TIPO_MANTENIMIENTO = TIPOS_MANTENIMIENTO.map((tipo) => tipo.codigo);
const CODIGOS_ESTADO_MANTENIMIENTO = ESTADOS_MANTENIMIENTO.map((estado) => estado.codigo);

const ESTADO_MANTENIMIENTO_DEFAULT = 'PENDIENTE';

// Estados que permiten edicion ordinaria y cierre.
const ESTADOS_MANTENIMIENTO_EDITABLES = ['PENDIENTE', 'EN_EJECUCION'];

const DIAS_ALERTA_VENCIMIENTO_DEFAULT = 30;

function esTipoMantenimientoValido(codigo) {
  return CODIGOS_TIPO_MANTENIMIENTO.indexOf(codigo) !== -1;
}

function esEstadoMantenimientoValido(codigo) {
  return CODIGOS_ESTADO_MANTENIMIENTO.indexOf(codigo) !== -1;
}

function esEstadoEditableMantenimiento(codigo) {
  return ESTADOS_MANTENIMIENTO_EDITABLES.indexOf(codigo) !== -1;
}

function etiquetaTipoMantenimiento(codigo) {
  const tipo = TIPOS_MANTENIMIENTO.find((item) => item.codigo === codigo);
  return tipo ? tipo.etiqueta : codigo;
}

function etiquetaEstadoMantenimiento(codigo) {
  const estado = ESTADOS_MANTENIMIENTO.find((item) => item.codigo === codigo);
  return estado ? estado.etiqueta : codigo;
}

function claseEstadoMantenimiento(codigo) {
  const estado = ESTADOS_MANTENIMIENTO.find((item) => item.codigo === codigo);
  return estado ? estado.clase : 'secondary';
}

/**
 * Normaliza una fecha (Date o 'YYYY-MM-DD') a un entero de dia en horario local.
 * Devuelve null cuando no es una fecha valida.
 */
function normalizarDia(valor) {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return Date.UTC(valor.getUTCFullYear(), valor.getUTCMonth(), valor.getUTCDate());
  }
  const texto = String(valor).trim();
  const coincidencia = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (coincidencia) {
    return Date.UTC(Number(coincidencia[1]), Number(coincidencia[2]) - 1, Number(coincidencia[3]));
  }
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return null;
  return Date.UTC(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
}

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Dias restantes hasta la fecha programada/realizada del mantenimiento.
 * Negativo cuando ya vencio; null cuando no hay fecha.
 */
function diasRestantesMantenimiento(mantenimiento, hoy) {
  const programada = normalizarDia(mantenimiento ? mantenimiento.fecha_realizacion : null);
  if (programada == null) return null;
  const referencia = normalizarDia(hoy || new Date());
  return Math.round((programada - referencia) / MILISEGUNDOS_POR_DIA);
}

/**
 * Determina la situacion (alerta) de un mantenimiento segun su estado y fecha.
 */
function situacionMantenimiento(mantenimiento, diasAlerta) {
  const alerta = Number.isFinite(Number(diasAlerta))
    ? Number(diasAlerta)
    : DIAS_ALERTA_VENCIMIENTO_DEFAULT;
  const estado = mantenimiento ? String(mantenimiento.estado || '').toUpperCase() : '';

  const porEstado = {
    EN_EJECUCION: 'EN_EJECUCION',
    CUMPLIDO: 'CUMPLIDO',
    CANCELADO: 'CANCELADO',
    VENCIDO: 'VENCIDO',
  };
  if (porEstado[estado]) {
    return obtenerSituacion(porEstado[estado]);
  }

  const dias = diasRestantesMantenimiento(mantenimiento);
  if (dias == null) {
    return obtenerSituacion('VIGENTE');
  }
  if (dias < 0) {
    return obtenerSituacion('VENCIDO');
  }
  if (dias <= alerta) {
    return obtenerSituacion('PROXIMO_VENCER');
  }
  return obtenerSituacion('VIGENTE');
}

function obtenerSituacion(codigo) {
  const situacion = SITUACIONES_MANTENIMIENTO.find((item) => item.codigo === codigo);
  return situacion || SITUACIONES_MANTENIMIENTO[0];
}

module.exports = {
  TIPOS_MANTENIMIENTO,
  ESTADOS_MANTENIMIENTO,
  SITUACIONES_MANTENIMIENTO,
  CODIGOS_TIPO_MANTENIMIENTO,
  CODIGOS_ESTADO_MANTENIMIENTO,
  ESTADO_MANTENIMIENTO_DEFAULT,
  ESTADOS_MANTENIMIENTO_EDITABLES,
  DIAS_ALERTA_VENCIMIENTO_DEFAULT,
  esTipoMantenimientoValido,
  esEstadoMantenimientoValido,
  esEstadoEditableMantenimiento,
  etiquetaTipoMantenimiento,
  etiquetaEstadoMantenimiento,
  claseEstadoMantenimiento,
  diasRestantesMantenimiento,
  situacionMantenimiento,
};
