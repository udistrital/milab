const TIPOS_MANTENIMIENTO = [
  { codigo: 'PREVENTIVO', etiqueta: 'Preventivo' },
  { codigo: 'CORRECTIVO', etiqueta: 'Correctivo' },
  { codigo: 'PREDICTIVO', etiqueta: 'Predictivo' },
  { codigo: 'CALIBRACION', etiqueta: 'Calibración' },
  { codigo: 'LIMPIEZA', etiqueta: 'Limpieza' },
  { codigo: 'OTRO', etiqueta: 'Otro' },
];

const ESTADOS_MANTENIMIENTO = [
  { codigo: 'PENDIENTE', etiqueta: 'Pendiente', clase: 'secondary' },
  { codigo: 'EN_EJECUCION', etiqueta: 'En ejecución', clase: 'warning' },
  { codigo: 'CUMPLIDO', etiqueta: 'Cumplido', clase: 'success' },
  { codigo: 'CANCELADO', etiqueta: 'Cancelado', clase: 'dark' },
];

const CODIGOS_TIPO_MANTENIMIENTO = TIPOS_MANTENIMIENTO.map((tipo) => tipo.codigo);
const CODIGOS_ESTADO_MANTENIMIENTO = ESTADOS_MANTENIMIENTO.map((estado) => estado.codigo);

const ESTADO_MANTENIMIENTO_DEFAULT = 'PENDIENTE';

// Solo los mantenimientos en estos estados admiten edicion (CA01).
const ESTADOS_MANTENIMIENTO_EDITABLES = ['PENDIENTE', 'EN_EJECUCION'];
// Estados terminales: al llegar a ellos se registra el cierre y el mantenimiento
// deja de ser editable (CA02/CA03).
const ESTADOS_MANTENIMIENTO_CIERRE = ['CUMPLIDO', 'CANCELADO'];

function esTipoMantenimientoValido(codigo) {
  return CODIGOS_TIPO_MANTENIMIENTO.indexOf(codigo) !== -1;
}

function esEstadoMantenimientoValido(codigo) {
  return CODIGOS_ESTADO_MANTENIMIENTO.indexOf(codigo) !== -1;
}

function esEstadoMantenimientoEditable(codigo) {
  return ESTADOS_MANTENIMIENTO_EDITABLES.indexOf(codigo) !== -1;
}

function esEstadoMantenimientoCierre(codigo) {
  return ESTADOS_MANTENIMIENTO_CIERRE.indexOf(codigo) !== -1;
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

module.exports = {
  TIPOS_MANTENIMIENTO,
  ESTADOS_MANTENIMIENTO,
  CODIGOS_TIPO_MANTENIMIENTO,
  CODIGOS_ESTADO_MANTENIMIENTO,
  ESTADO_MANTENIMIENTO_DEFAULT,
  ESTADOS_MANTENIMIENTO_EDITABLES,
  ESTADOS_MANTENIMIENTO_CIERRE,
  esTipoMantenimientoValido,
  esEstadoMantenimientoValido,
  esEstadoMantenimientoEditable,
  esEstadoMantenimientoCierre,
  etiquetaTipoMantenimiento,
  etiquetaEstadoMantenimiento,
  claseEstadoMantenimiento,
};
