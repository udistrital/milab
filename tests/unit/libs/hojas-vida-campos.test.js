const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TIPOS_USO_OPCIONES,
  CLAVE_USO_OTROS,
  CAMPOS_HOJA_VIDA,
  parsearTipoUso,
  serializarTipoUso,
  normalizarTipoUso,
  opcionesTipoUsoMarcadas,
  formatearTipoUso,
} = require('../../../src/libs/hojas-vida-campos');

test('tipo_uso: el catalogo expone las opciones del formato con tildes', () => {
  assert.deepEqual(
    TIPOS_USO_OPCIONES.map((opcion) => opcion.etiqueta),
    ['Académico', 'Investigación', 'Extensión', 'Servicios']
  );
});

test('tipo_uso: el campo se declara como multiseleccion con opcion "Otros"', () => {
  const campo = CAMPOS_HOJA_VIDA.find((item) => item.nombre === 'tipo_uso');
  assert.equal(campo.tipo, 'uso');
  assert.equal(campo.permiteOtros, true);
  assert.equal(campo.opciones, TIPOS_USO_OPCIONES);
});

test('parsearTipoUso reconoce las claves y la descripcion de "Otros"', () => {
  const resultado = parsearTipoUso('ACADEMICO,SERVICIOS,OTROS:Certificacion externa');
  assert.deepEqual(resultado.claves, ['ACADEMICO', 'SERVICIOS', CLAVE_USO_OTROS]);
  assert.equal(resultado.otro, 'Certificacion externa');
});

test('parsearTipoUso tolera el texto libre legado', () => {
  const reconocido = parsearTipoUso('Academico, Investigacion');
  assert.deepEqual(reconocido.claves, ['ACADEMICO', 'INVESTIGACION']);
  assert.equal(reconocido.otro, '');

  const libre = parsearTipoUso('Docencia y extension');
  assert.deepEqual(libre.claves, [CLAVE_USO_OTROS]);
  assert.equal(libre.otro, 'Docencia y extension');
});

test('serializarTipoUso guarda claves y la descripcion de "Otros"', () => {
  assert.equal(
    serializarTipoUso(['ACADEMICO', 'OTROS'], 'Certificacion externa'),
    'ACADEMICO,OTROS:Certificacion externa'
  );
  assert.equal(serializarTipoUso(['OTROS'], ''), 'OTROS');
  assert.equal(serializarTipoUso([], 'ignorado'), '');
  assert.equal(serializarTipoUso('SERVICIOS', ''), 'SERVICIOS');
});

test('normalizarTipoUso unifica formatos y descarta valores vacios', () => {
  assert.equal(normalizarTipoUso('academico'), 'ACADEMICO');
  assert.equal(normalizarTipoUso('Académico, Servicios'), 'ACADEMICO,SERVICIOS');
  assert.equal(normalizarTipoUso('Docencia'), 'OTROS:Docencia');
  assert.equal(normalizarTipoUso(''), null);
  assert.equal(normalizarTipoUso(null), null);
});

test('opcionesTipoUsoMarcadas devuelve las claves activas', () => {
  assert.deepEqual(opcionesTipoUsoMarcadas('ACADEMICO,OTROS:x'), ['ACADEMICO', 'OTROS']);
  assert.deepEqual(opcionesTipoUsoMarcadas(''), []);
});

test('formatearTipoUso entrega texto legible con tildes', () => {
  assert.equal(formatearTipoUso('ACADEMICO,EXTENSION'), 'Académico, Extensión');
  assert.equal(formatearTipoUso('OTROS:Certificacion'), 'Otros: Certificacion');
  assert.equal(formatearTipoUso(''), '');
});
