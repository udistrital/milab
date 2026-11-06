const ESTADOS_BAJA_HOJA_VIDA = [
  {
    codigo: 'REGISTRADA',
    etiqueta: 'Registrada',
    clase: 'warning',
    bloqueaPrestamo: false,
  },
  {
    codigo: 'APLICADA',
    etiqueta: 'Aplicada',
    clase: 'danger',
    bloqueaPrestamo: true,
  },
  {
    codigo: 'REVERTIDA',
    etiqueta: 'Revertida',
    clase: 'success',
    bloqueaPrestamo: false,
  },
];

const CODIGOS_ESTADO_BAJA_HOJA_VIDA = ESTADOS_BAJA_HOJA_VIDA.map((estado) => estado.codigo);

function obtenerEstadoBajaHojaVida(codigo) {
  return (
    ESTADOS_BAJA_HOJA_VIDA.find((estado) => estado.codigo === String(codigo || '').trim().toUpperCase()) ||
    null
  );
}

function esEstadoBajaHojaVidaValido(codigo) {
  return CODIGOS_ESTADO_BAJA_HOJA_VIDA.includes(String(codigo || '').trim().toUpperCase());
}

function etiquetaEstadoBajaHojaVida(codigo) {
  const estado = obtenerEstadoBajaHojaVida(codigo);
  return estado ? estado.etiqueta : codigo;
}

function claseEstadoBajaHojaVida(codigo) {
  const estado = obtenerEstadoBajaHojaVida(codigo);
  return estado ? estado.clase : 'secondary';
}

function bloqueaPrestamoPorBaja(codigo) {
  const estado = obtenerEstadoBajaHojaVida(codigo);
  return Boolean(estado && estado.bloqueaPrestamo);
}

module.exports = {
  ESTADOS_BAJA_HOJA_VIDA,
  CODIGOS_ESTADO_BAJA_HOJA_VIDA,
  obtenerEstadoBajaHojaVida,
  esEstadoBajaHojaVidaValido,
  etiquetaEstadoBajaHojaVida,
  claseEstadoBajaHojaVida,
  bloqueaPrestamoPorBaja,
};
