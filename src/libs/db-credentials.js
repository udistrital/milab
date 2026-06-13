const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { config } = require('../config/config');

function getRequiredProcessEnv(envVarName) {
  const value = process.env[envVarName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[DB_SECRET] La variable ${envVarName} es obligatoria.`);
  }

  return value.trim();
}

function decodeSecretResponse(secretValueResponse, secretId) {
  if (typeof secretValueResponse?.SecretString === 'string') {
    return secretValueResponse.SecretString;
  }

  if (secretValueResponse?.SecretBinary) {
    return Buffer.from(secretValueResponse.SecretBinary).toString('utf8');
  }

  throw new Error(
    `[DB_SECRET] El secreto ${secretId} no contiene ni SecretString ni SecretBinary.`
  );
}

function parseSecretJson(secretRawValue, secretId) {
  try {
    return JSON.parse(secretRawValue);
  } catch (error) {
    throw new Error(`[DB_SECRET] El secreto ${secretId} no tiene un JSON valido.`, {
      cause: error,
    });
  }
}

function getRequiredSecretField(secretJson, fieldName, secretId) {
  const value = secretJson?.[fieldName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `[DB_SECRET] El campo ${fieldName} no existe o esta vacio en el secreto ${secretId}.`
    );
  }

  return value;
}

async function resolveFromAwsSecretsManager() {
  const secretId = getRequiredProcessEnv(config.dbSecretIdEnvVar);
  const region = getRequiredProcessEnv(config.dbSecretRegionEnvVar);

  const client = new SecretsManagerClient({ region });
  const response = await client.send(
    new GetSecretValueCommand({
      SecretId: secretId,
    })
  );

  const rawSecret = decodeSecretResponse(response, secretId);
  const secretJson = parseSecretJson(rawSecret, secretId);

  return {
    user: getRequiredSecretField(secretJson, config.dbSecretUserKey, secretId),
    password: getRequiredSecretField(secretJson, config.dbSecretPasswordKey, secretId),
  };
}

async function resolveDatabaseCredentials() {
  if (!config.dbSecretEnabled) {
    return {
      user: config.dbUser,
      password: config.dbPassword,
    };
  }

  return resolveFromAwsSecretsManager();
}

module.exports = {
  resolveDatabaseCredentials,
  parseSecretJson,
};
