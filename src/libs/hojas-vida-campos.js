const TIPOS_USO_OPCIONES = [
  { clave: 'ACADEMICO', etiqueta: 'Académico' },
  { clave: 'INVESTIGACION', etiqueta: 'Investigación' },
  { clave: 'EXTENSION', etiqueta: 'Extensión' },
  { clave: 'SERVICIOS', etiqueta: 'Servicios' },
];
const CLAVE_USO_OTROS = 'OTROS';
const ETIQUETA_USO_OTROS = 'Otros';

function normalizarTextoTipoUso(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();
}

function buscarOpcionTipoUso(valor) {
  const normalizado = normalizarTextoTipoUso(valor);
  if (!normalizado) return null;
  return (
    TIPOS_USO_OPCIONES.find(
      (opcion) =>
        normalizarTextoTipoUso(opcion.clave) === normalizado ||
        normalizarTextoTipoUso(opcion.etiqueta) === normalizado
    ) || null
  );
}

function parsearTipoUso(valor) {
  const claves = [];
  let otro = '';
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) return { claves: claves, otro: otro };

  texto.split(',').forEach(function (token) {
    const limpio = token.trim();
    if (!limpio) return;
    const normalizado = normalizarTextoTipoUso(limpio);
    if (normalizado === CLAVE_USO_OTROS) {
      if (claves.indexOf(CLAVE_USO_OTROS) === -1) claves.push(CLAVE_USO_OTROS);
      return;
    }
    if (normalizado.indexOf(CLAVE_USO_OTROS + ':') === 0) {
      if (claves.indexOf(CLAVE_USO_OTROS) === -1) claves.push(CLAVE_USO_OTROS);
      const descripcion = limpio.slice(limpio.indexOf(':') + 1).trim();
      if (descripcion) otro = otro ? otro + ', ' + descripcion : descripcion;
      return;
    }
    const opcion = buscarOpcionTipoUso(limpio);
    if (opcion) {
      if (claves.indexOf(opcion.clave) === -1) claves.push(opcion.clave);
      return;
    }
    if (claves.indexOf(CLAVE_USO_OTROS) === -1) claves.push(CLAVE_USO_OTROS);
    otro = otro ? otro + ', ' + limpio : limpio;
  });

  return { claves: claves, otro: otro };
}

function serializarTipoUso(claves, otro) {
  const lista = Array.isArray(claves) ? claves : claves == null ? [] : [claves];
  const seleccion = [];
  let marcaOtros = false;

  lista.forEach(function (clave) {
    const normalizado = normalizarTextoTipoUso(clave);
    if (!normalizado) return;
    if (normalizado === CLAVE_USO_OTROS) {
      marcaOtros = true;
      return;
    }
    const opcion = buscarOpcionTipoUso(normalizado);
    if (opcion && seleccion.indexOf(opcion.clave) === -1) seleccion.push(opcion.clave);
  });

  if (marcaOtros) {
    const descripcion = String(otro == null ? '' : otro)
      .replace(/[\r\n]+/g, ' ')
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    seleccion.push(descripcion ? CLAVE_USO_OTROS + ':' + descripcion : CLAVE_USO_OTROS);
  }

  return seleccion.join(',');
}

function normalizarTipoUso(valor) {
  const parseado = parsearTipoUso(valor);
  const normalizado = serializarTipoUso(parseado.claves, parseado.otro);
  return normalizado === '' ? null : normalizado;
}

function opcionesTipoUsoMarcadas(valor) {
  return parsearTipoUso(valor).claves;
}

function formatearTipoUso(valor) {
  const parseado = parsearTipoUso(valor);
  return parseado.claves
    .map(function (clave) {
      if (clave === CLAVE_USO_OTROS) {
        return parseado.otro ? ETIQUETA_USO_OTROS + ': ' + parseado.otro : ETIQUETA_USO_OTROS;
      }
      const opcion = TIPOS_USO_OPCIONES.find((item) => item.clave === clave);
      return opcion ? opcion.etiqueta : clave;
    })
    .join(', ');
}

const SECCIONES_HOJA_VIDA = [
  'Información del equipo',
  'Adquisición y proveedor',
  'Especificaciones',
];

const CAMPOS_HOJA_VIDA = [
  // Información del equipo
  {
    nombre: 'nombre_equipo',
    etiqueta: 'Nombre del equipo',
    seccion: 'Información del equipo',
    tipo: 'text',
  },
  {
    nombre: 'codigo_inventario',
    etiqueta: 'Código de inventario',
    seccion: 'Información del equipo',
    tipo: 'text',
  },
  {
    nombre: 'codigo_interno',
    etiqueta: 'Código interno',
    seccion: 'Información del equipo',
    tipo: 'text',
  },
  {
    nombre: 'numero_serie',
    etiqueta: 'Número de serie',
    seccion: 'Información del equipo',
    tipo: 'text',
  },
  { nombre: 'marca', etiqueta: 'Marca', seccion: 'Información del equipo', tipo: 'text' },
  {
    nombre: 'referencia_modelo',
    etiqueta: 'Modelo / Referencia',
    seccion: 'Información del equipo',
    tipo: 'text',
  },
  {
    nombre: 'dependencia',
    etiqueta: 'Dependencia / Área',
    seccion: 'Información del equipo',
    tipo: 'text',
  },
  { nombre: 'ubicacion', etiqueta: 'Ubicación', seccion: 'Información del equipo', tipo: 'text' },
  { nombre: 'cantidad', etiqueta: 'Cantidades', seccion: 'Información del equipo', tipo: 'number' },
  { nombre: 'anio', etiqueta: 'Año', seccion: 'Información del equipo', tipo: 'text' },
  {
    nombre: 'fecha_adquisicion',
    etiqueta: 'Fecha de compra',
    seccion: 'Información del equipo',
    tipo: 'date',
  },
  {
    nombre: 'tipo_uso',
    etiqueta: 'Uso',
    seccion: 'Información del equipo',
    tipo: 'uso',
    opciones: TIPOS_USO_OPCIONES,
    permiteOtros: true,
  },
  {
    nombre: 'responsable',
    etiqueta: 'Responsable',
    seccion: 'Información del equipo',
    tipo: 'text',
  },
  { nombre: 'supervisor', etiqueta: 'Supervisor', seccion: 'Información del equipo', tipo: 'text' },

  // Adquisición y proveedor
  {
    nombre: 'numero_factura_compra',
    etiqueta: 'Número de factura de compra',
    seccion: 'Adquisición y proveedor',
    tipo: 'text',
  },
  {
    nombre: 'numero_remision_compra',
    etiqueta: 'Número de remisión de compra',
    seccion: 'Adquisición y proveedor',
    tipo: 'text',
  },
  { nombre: 'proveedor', etiqueta: 'Proveedor', seccion: 'Adquisición y proveedor', tipo: 'text' },
  {
    nombre: 'valor_compra',
    etiqueta: 'Valor de compra',
    seccion: 'Adquisición y proveedor',
    tipo: 'number',
  },
  {
    nombre: 'pais_origen',
    etiqueta: 'País de origen',
    seccion: 'Adquisición y proveedor',
    tipo: 'text',
  },
  {
    nombre: 'tiempo_garantia',
    etiqueta: 'Tiempo de garantía',
    seccion: 'Adquisición y proveedor',
    tipo: 'text',
  },
  {
    nombre: 'tiempo_vida_util',
    etiqueta: 'Tiempo de vida útil',
    seccion: 'Adquisición y proveedor',
    tipo: 'text',
  },
  {
    nombre: 'frecuencia_mantenimiento',
    etiqueta: 'Frecuencia de mantenimiento',
    seccion: 'Adquisición y proveedor',
    tipo: 'text',
  },
  {
    nombre: 'potencia_electrica',
    etiqueta: 'Potencia eléctrica',
    seccion: 'Adquisición y proveedor',
    tipo: 'text',
  },

  // Especificaciones
  { nombre: 'funcion', etiqueta: 'Función', seccion: 'Especificaciones', tipo: 'textarea' },
  {
    nombre: 'descripcion_fisica',
    etiqueta: 'Descripción física',
    seccion: 'Especificaciones',
    tipo: 'textarea',
  },
  {
    nombre: 'especificaciones_tecnicas',
    etiqueta: 'Especificaciones técnicas',
    seccion: 'Especificaciones',
    tipo: 'textarea',
  },
  {
    nombre: 'instrucciones_uso',
    etiqueta: 'Instrucciones de uso',
    seccion: 'Especificaciones',
    tipo: 'textarea',
  },
  {
    nombre: 'condiciones_seguridad',
    etiqueta: 'Condiciones de seguridad',
    seccion: 'Especificaciones',
    tipo: 'textarea',
  },
  {
    nombre: 'protocolo_limpieza',
    etiqueta: 'Protocolo de limpieza',
    seccion: 'Especificaciones',
    tipo: 'textarea',
  },
  {
    nombre: 'cuenta_manual',
    etiqueta: 'Cuenta con manual',
    seccion: 'Especificaciones',
    tipo: 'textarea',
  },
  { nombre: 'accesorios', etiqueta: 'Accesorios', seccion: 'Especificaciones', tipo: 'textarea' },
  {
    nombre: 'foto_descripcion',
    etiqueta: 'Descripción de la fotografía',
    seccion: 'Especificaciones',
    tipo: 'textarea',
  },
];

const CAMPOS_POR_SECCION = SECCIONES_HOJA_VIDA.map((seccion) => ({
  seccion,
  campos: CAMPOS_HOJA_VIDA.filter((campo) => campo.seccion === seccion),
}));

const NOMBRES_CAMPOS_HOJA_VIDA = CAMPOS_HOJA_VIDA.map((campo) => campo.nombre);

module.exports = {
  SECCIONES_HOJA_VIDA,
  CAMPOS_HOJA_VIDA,
  CAMPOS_POR_SECCION,
  NOMBRES_CAMPOS_HOJA_VIDA,
  TIPOS_USO_OPCIONES,
  CLAVE_USO_OTROS,
  ETIQUETA_USO_OTROS,
  parsearTipoUso,
  serializarTipoUso,
  normalizarTipoUso,
  opcionesTipoUsoMarcadas,
  formatearTipoUso,
};
