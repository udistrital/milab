const variableName = 'MILAB_CAPACITACION_TEST_DATABASE_URL';
const useApplicationDatabase = process.env.MILAB_CAPACITACION_TEST_USE_APP_DB === 'true';

if (!process.env[variableName] && !useApplicationDatabase) {
  console.error(
    `Set ${variableName} or explicitly enable the dedicated application test database.`
  );
  process.exitCode = 1;
}
