// Servicios SGA por ambiente. Se definen aquí y no en el .env.
// Las consultas usan el gateway https de OATI con token OAuth (no el puerto 8282).

const NON_PRODUCTION_ENVIRONMENTS = Object.freeze([
  'dev',
  'development',
  'local',
  'test',
  'testing',
  'staging',
  'preprod',
]);

const SGA_DEBTORS_SERVICE_NAMES = Object.freeze({
  production: 'servicios_academicos_produccion',
  nonProduction: 'academica_pruebas',
});

// Cualquier ambiente no listado como no productivo (incluido vacío) usa producción.
function resolveSgaDebtorsServiceName(environmentName) {
  const normalizedEnvironment = String(environmentName || '')
    .trim()
    .toLowerCase();
  return NON_PRODUCTION_ENVIRONMENTS.includes(normalizedEnvironment)
    ? SGA_DEBTORS_SERVICE_NAMES.nonProduction
    : SGA_DEBTORS_SERVICE_NAMES.production;
}

module.exports = {
  NON_PRODUCTION_ENVIRONMENTS,
  SGA_DEBTORS_SERVICE_NAMES,
  resolveSgaDebtorsServiceName,
};
