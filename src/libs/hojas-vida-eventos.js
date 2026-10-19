const TIPOS_EVENTO_HOJA_VIDA = [
  {
    codigo: 'CREACION',
    etiqueta: 'Creación de la hoja de vida',
    sistema: true,
    clase: 'success',
    ayuda: 'Se generó al cargar el archivo o registrar la hoja de vida.',
  },
  {
    codigo: 'CONFIRMACION',
    etiqueta: 'Confirmación de la hoja de vida',
    sistema: true,
    clase: 'success',
    ayuda: 'Se generó al confirmar la hoja de vida (creación oficial).',
  },
  {
    codigo: 'EDICION',
    etiqueta: 'Edición de la hoja de vida',
    sistema: true,
    clase: 'info',
    ayuda: 'Se generó al actualizar información de la hoja de vida.',
  },
  {
    codigo: 'TRASLADO',
    etiqueta: 'Traslado / cambio de ubicación',
    sistema: false,
    clase: 'primary',
    ayuda: 'Registra el cambio de ubicación del equipo (usa valor anterior y nuevo).',
  },
  {
    codigo: 'MANTENIMIENTO',
    etiqueta: 'Mantenimiento realizado',
    sistema: false,
    clase: 'warning',
    ayuda: 'Registra un mantenimiento aplicado al equipo.',
  },
  {
    codigo: 'PRESTAMO',
    etiqueta: 'Préstamo / uso del equipo',
    sistema: false,
    clase: 'info',
    ayuda: 'Registra entrega o uso del equipo por un tercero.',
  },
  {
    codigo: 'INCIDENCIA',
    etiqueta: 'Incidencia / novedad',
    sistema: false,
    clase: 'danger',
    ayuda: 'Registra daños, fallas o novedades del equipo.',
  },
  {
    codigo: 'BAJA',
    etiqueta: 'Baja / retiro del activo',
    sistema: false,
    clase: 'dark',
    ayuda: 'Registra el retiro o desactivación del equipo.',
  },
  {
    codigo: 'OBSERVACION',
    etiqueta: 'Observación',
    sistema: false,
    clase: 'secondary',
    ayuda: 'Nota libre asociada al ciclo de vida del activo.',
  },
];

const CODIGOS_TIPO_EVENTO = TIPOS_EVENTO_HOJA_VIDA.map((tipo) => tipo.codigo);

const TIPOS_EVENTO_MANUALES = TIPOS_EVENTO_HOJA_VIDA.filter((tipo) => !tipo.sistema);

function obtenerTipoEvento(codigo) {
  return TIPOS_EVENTO_HOJA_VIDA.find((tipo) => tipo.codigo === codigo) || null;
}

function esTipoEventoValido(codigo) {
  return CODIGOS_TIPO_EVENTO.indexOf(codigo) !== -1;
}

function esTipoEventoManual(codigo) {
  const tipo = obtenerTipoEvento(codigo);
  return Boolean(tipo) && !tipo.sistema;
}

function etiquetaTipoEvento(codigo) {
  const tipo = obtenerTipoEvento(codigo);
  return tipo ? tipo.etiqueta : codigo;
}

function claseTipoEvento(codigo) {
  const tipo = obtenerTipoEvento(codigo);
  return tipo ? tipo.clase : 'secondary';
}

module.exports = {
  TIPOS_EVENTO_HOJA_VIDA,
  CODIGOS_TIPO_EVENTO,
  TIPOS_EVENTO_MANUALES,
  obtenerTipoEvento,
  esTipoEventoValido,
  esTipoEventoManual,
  etiquetaTipoEvento,
  claseTipoEvento,
};
