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

const SGA_DEBTORS_SERVICE_NAMES = Object.freeze({
  production: 'servicios_academicos_produccion',
  // Failover target previously used in non-production environments. Uncomment
  // this and the resolver below to restore test-service routing.
  // nonProduction: 'academica_pruebas',
});

function resolveSgaDebtorsServiceName() {
  return SGA_DEBTORS_SERVICE_NAMES.production;
}

// Previous routing for test failover:
// function resolveSgaDebtorsServiceName(environmentName) {
//   const normalizedEnvironment = String(environmentName || '')
//     .trim()
//     .toLowerCase();
//   return NON_PRODUCTION_ENVIRONMENTS.includes(normalizedEnvironment)
//     ? SGA_DEBTORS_SERVICE_NAMES.nonProduction
//     : SGA_DEBTORS_SERVICE_NAMES.production;
// }

module.exports = {
  NON_PRODUCTION_ENVIRONMENTS,
  SGA_DEBTORS_SERVICE_NAMES,
  resolveSgaDebtorsServiceName,
};
