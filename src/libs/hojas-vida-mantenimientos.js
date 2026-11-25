const TIPOS_MANTENIMIENTO = [
  { codigo: 'PREVENTIVO', etiqueta: 'Preventivo' },
  { codigo: 'CORRECTIVO', etiqueta: 'Correctivo' },
  { codigo: 'PREDICTIVO', etiqueta: 'Predictivo' },
  { codigo: 'CALIBRACION', etiqueta: 'Calibración' },
  { codigo: 'LIMPIEZA', etiqueta: 'Limpieza' },
  { codigo: 'OTRO', etiqueta: 'Otro' },
];

// Lista parametrizable de formatos SIGUD de mantenimiento.
// Si un formato cambia (código, título institucional, tipo sugerido, PDF o bloque
// de campos) basta con editar esta entrada; los consumidores leen estos atributos.
// - codigo: identificador guardado en mantenimiento.formato_registro
// - etiqueta: texto visible en los desplegables
// - codigoInstitucional: código impreso en el encabezado del PDF
// - tipoSugerido: tipo de mantenimiento que se autocompleta al elegirlo
// - impresion: clave con la que la ruta de impresión elige el PDF a generar
// - bloqueCampos: identificador del bloque de campos adicionales a mostrar
// - orden: orden de aparición en el desplegable
// - activo: permite retirar un formato sin borrarlo de la lista
const FORMATOS_REGISTRO_MANTENIMIENTO = [
  {
    codigo: 'FR-026',
    etiqueta: 'FR-026 Correctivo',
    codigoInstitucional: 'GDTH-PG-003-FR-026',
    tipoSugerido: 'CORRECTIVO',
    impresion: 'MANTENIMIENTO_CORRECTIVO',
    bloqueCampos: 'FR-026',
    orden: 1,
    activo: true,
  },
  {
    codigo: 'FR-028',
    etiqueta: 'FR-028 Cronograma',
    codigoInstitucional: 'GDTH-PG-003-FR-028',
    tipoSugerido: 'PREVENTIVO',
    impresion: 'CRONOGRAMA_MANTENIMIENTO',
    bloqueCampos: 'FR-028',
    orden: 2,
    activo: true,
  },
  {
    codigo: 'FR-029',
    etiqueta: 'FR-029 Preventivo',
    codigoInstitucional: 'GDTH-PG-003-FR-029',
    tipoSugerido: 'PREVENTIVO',
    impresion: 'MANTENIMIENTO_PREVENTIVO',
    bloqueCampos: 'FR-029',
    orden: 3,
    activo: true,
  },
];

const CAMPOS_FORMATO_MANTENIMIENTO = {
  'FR-026': [
    { nombre: 'descripcion_falla', etiqueta: 'Descripción de la falla', tipo: 'textarea' },
    {
      nombre: 'responsable_verificar',
      etiqueta: 'Responsable de verificar',
      tipo: 'text',
    },
    {
      nombre: 'firma_responsable_verificar',
      etiqueta: 'Firma responsable de verificar',
      tipo: 'text',
    },
    { nombre: 'firma_proveedor', etiqueta: 'Firma proveedor', tipo: 'text' },
  ],
  'FR-028': [
    {
      nombre: 'encargado_elaboracion',
      etiqueta: 'Encargado de su elaboración',
      tipo: 'text',
    },
    { nombre: 'descripcion_actividad', etiqueta: 'Descripción de la actividad', tipo: 'textarea' },
    { nombre: 'meses_programados', etiqueta: 'Meses programados', tipo: 'json' },
    { nombre: 'verificado_por', etiqueta: 'Verificado por', tipo: 'text' },
    { nombre: 'firma_verificacion', etiqueta: 'Firma', tipo: 'text' },
    { nombre: 'observaciones_generales', etiqueta: 'Observaciones', tipo: 'textarea' },
  ],
  'FR-029': [
    { nombre: 'diligenciado_por', etiqueta: 'Diligenciado por', tipo: 'text' },
    { nombre: 'cargo_diligenciado_por', etiqueta: 'Cargo', tipo: 'text' },
    { nombre: 'sede', etiqueta: 'Sede', tipo: 'text' },
    { nombre: 'area_especifica', etiqueta: 'Área específica', tipo: 'text' },
    {
      nombre: 'descripcion_accion_verificacion',
      etiqueta: 'Descripción de la acción de verificación',
      tipo: 'textarea',
    },
    { nombre: 'registro_mantenimiento', etiqueta: 'Registro de mantenimiento', tipo: 'json' },
    { nombre: 'cumple_mantenimiento', etiqueta: 'Cumple mantenimiento', tipo: 'boolean' },
    {
      nombre: 'justificacion_ausencia_mantenimiento',
      etiqueta: 'Justificación ausencia de mantenimiento',
      tipo: 'textarea',
    },
    { nombre: 'firma_responsable', etiqueta: 'Firma', tipo: 'text' },
  ],
};

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
const CODIGOS_FORMATO_REGISTRO_MANTENIMIENTO = FORMATOS_REGISTRO_MANTENIMIENTO.map(
  (formato) => formato.codigo
);

const ESTADO_MANTENIMIENTO_DEFAULT = 'PENDIENTE';

const ESTADOS_MANTENIMIENTO_EDITABLES = ['PENDIENTE', 'EN_EJECUCION'];

const ESTADOS_MANTENIMIENTO_CIERRE = ['CUMPLIDO', 'CANCELADO'];

const DIAS_ALERTA_VENCIMIENTO_DEFAULT = 30;

// Orden de severidad usado para elegir la alerta principal de un equipo.
const SEVERIDAD_SITUACION = {
  EN_EJECUCION: 4,
  VENCIDO: 3,
  PROXIMO_VENCER: 2,
  VIGENTE: 1,
  CUMPLIDO: 0,
  CANCELADO: 0,
};

function esTipoMantenimientoValido(codigo) {
  return CODIGOS_TIPO_MANTENIMIENTO.indexOf(codigo) !== -1;
}

function esFormatoRegistroMantenimientoValido(codigo) {
  return CODIGOS_FORMATO_REGISTRO_MANTENIMIENTO.indexOf(codigo) !== -1;
}

function esEstadoMantenimientoValido(codigo) {
  return CODIGOS_ESTADO_MANTENIMIENTO.indexOf(codigo) !== -1;
}

function esEstadoEditableMantenimiento(codigo) {
  return ESTADOS_MANTENIMIENTO_EDITABLES.indexOf(codigo) !== -1;
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

function obtenerFormatoRegistroMantenimiento(codigo) {
  return FORMATOS_REGISTRO_MANTENIMIENTO.find((item) => item.codigo === codigo) || null;
}

function formatosRegistroMantenimientoActivos() {
  return FORMATOS_REGISTRO_MANTENIMIENTO.filter((item) => item.activo !== false).sort(
    (a, b) => (a.orden || 0) - (b.orden || 0)
  );
}

function etiquetaFormatoRegistroMantenimiento(codigo) {
  const formato = obtenerFormatoRegistroMantenimiento(codigo);
  return formato ? formato.etiqueta : codigo;
}

function etiquetaEstadoMantenimiento(codigo) {
  const estado = ESTADOS_MANTENIMIENTO.find((item) => item.codigo === codigo);
  return estado ? estado.etiqueta : codigo;
}

function claseEstadoMantenimiento(codigo) {
  const estado = ESTADOS_MANTENIMIENTO.find((item) => item.codigo === codigo);
  return estado ? estado.clase : 'secondary';
}

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

function diasRestantesMantenimiento(mantenimiento, hoy) {
  const programada = normalizarDia(mantenimiento ? mantenimiento.fecha_realizacion : null);
  if (programada == null) return null;
  const referencia = normalizarDia(hoy || new Date());
  return Math.round((programada - referencia) / MILISEGUNDOS_POR_DIA);
}

function obtenerSituacion(codigo) {
  const situacion = SITUACIONES_MANTENIMIENTO.find((item) => item.codigo === codigo);
  return situacion || SITUACIONES_MANTENIMIENTO[0];
}

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

module.exports = {
  TIPOS_MANTENIMIENTO,
  FORMATOS_REGISTRO_MANTENIMIENTO,
  CAMPOS_FORMATO_MANTENIMIENTO,
  ESTADOS_MANTENIMIENTO,
  SITUACIONES_MANTENIMIENTO,
  CODIGOS_TIPO_MANTENIMIENTO,
  CODIGOS_FORMATO_REGISTRO_MANTENIMIENTO,
  CODIGOS_ESTADO_MANTENIMIENTO,
  ESTADO_MANTENIMIENTO_DEFAULT,
  ESTADOS_MANTENIMIENTO_EDITABLES,
  ESTADOS_MANTENIMIENTO_CIERRE,
  DIAS_ALERTA_VENCIMIENTO_DEFAULT,
  SEVERIDAD_SITUACION,
  esTipoMantenimientoValido,
  esFormatoRegistroMantenimientoValido,
  esEstadoMantenimientoValido,
  esEstadoEditableMantenimiento,
  esEstadoMantenimientoEditable,
  esEstadoMantenimientoCierre,
  etiquetaTipoMantenimiento,
  obtenerFormatoRegistroMantenimiento,
  formatosRegistroMantenimientoActivos,
  etiquetaFormatoRegistroMantenimiento,
  etiquetaEstadoMantenimiento,
  claseEstadoMantenimiento,
  diasRestantesMantenimiento,
  situacionMantenimiento,
};
