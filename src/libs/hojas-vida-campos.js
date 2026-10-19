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
  { nombre: 'tipo_uso', etiqueta: 'Uso', seccion: 'Información del equipo', tipo: 'text' },
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
};
