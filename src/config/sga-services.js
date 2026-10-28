// Servicios SGA por ambiente. Se definen aquí y no en el .env.
// Las consultas usan el gateway https de OATI con token OAuth (no el puerto 8282).

// Retained for the previous test-service failover routing below.
const NON_PRODUCTION_ENVIRONMENTS = Object.freeze([
  'dev',
  'development',
  'local',
  'test',
  'testing',
  'staging',
  'preprod',
]);

const OATI_PUBLIC_ENVIRONMENTS = Object.freeze(['dev', 'development', 'test', 'testing']);

const SGA_SERVICE_NAMES = Object.freeze({
  production: 'servicios_academicos_produccion',
  test: 'academica_pruebas',
});

function isOatiPublicEnvironment(environmentName) {
  const normalizedEnvironment = String(environmentName || '')
    .trim()
    .toLowerCase();
  return OATI_PUBLIC_ENVIRONMENTS.includes(normalizedEnvironment);
}

function resolveSgaServiceName(environmentName) {
  return isOatiPublicEnvironment(environmentName)
    ? SGA_SERVICE_NAMES.test
    : SGA_SERVICE_NAMES.production;
}

module.exports = {
  NON_PRODUCTION_ENVIRONMENTS,
  OATI_PUBLIC_ENVIRONMENTS,
  SGA_SERVICE_NAMES,
  isOatiPublicEnvironment,
  resolveSgaServiceName,
};
