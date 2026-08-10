const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/db-credentials.js');
const configPath = path.resolve(__dirname, '../../../src/config/config.js');
const awsModulePath = require.resolve('@aws-sdk/client-secrets-manager');

function loadDbCredentialsModule({ configOverrides = {}, sendImpl } = {}) {
  const originalConfig = require.cache[configPath];
  const originalAws = require.cache[awsModulePath];
  const originalEnv = { ...process.env };
  const clientConfigs = [];
  const commandInputs = [];

  class FakeSecretsManagerClient {
    constructor(options) {
      clientConfigs.push(options);
    }

    async send(command) {
      if (typeof sendImpl === 'function') {
        return sendImpl(command);
      }

      return {
        SecretString: JSON.stringify({ user: 'secret_user', password: 'secret_password' }),
      };
    }
  }

  class FakeGetSecretValueCommand {
    constructor(input) {
      this.input = input;
      commandInputs.push(input);
    }
  }

  delete require.cache[modulePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      config: {
        dbSecretEnabled: true,
        dbUser: 'fallback_user',
        dbPassword: 'fallback_password',
        dbSecretIdEnvVar: 'DB_AWS_SECRET_ID',
        dbSecretRegionEnvVar: 'AWS_REGION',
        dbSecretUserKey: 'user',
        dbSecretPasswordKey: 'password',
        ...configOverrides,
      },
    },
  };
  require.cache[awsModulePath] = {
    id: awsModulePath,
    filename: awsModulePath,
    loaded: true,
    exports: {
      SecretsManagerClient: FakeSecretsManagerClient,
      GetSecretValueCommand: FakeGetSecretValueCommand,
    },
  };

  return {
    ...require(modulePath),
    clientConfigs,
    commandInputs,
    restore() {
      process.env = originalEnv;

      if (originalConfig) {
        require.cache[configPath] = originalConfig;
      } else {
        delete require.cache[configPath];
      }

      if (originalAws) {
        require.cache[awsModulePath] = originalAws;
      } else {
        delete require.cache[awsModulePath];
      }

      delete require.cache[modulePath];
    },
  };
}

test('resolveDatabaseCredentials returns config credentials when secret mode is disabled', async () => {
  const loaded = loadDbCredentialsModule({
    configOverrides: {
      dbSecretEnabled: false,
      dbUser: 'plain_user',
      dbPassword: 'plain_password',
    },
  });

  try {
    const credentials = await loaded.resolveDatabaseCredentials();

    assert.deepEqual(credentials, {
      user: 'plain_user',
      password: 'plain_password',
    });
    assert.equal(loaded.clientConfigs.length, 0);
  } finally {
    loaded.restore();
  }
});

test('resolveDatabaseCredentials reads credentials from AWS SecretString', async () => {
  const loaded = loadDbCredentialsModule();
  process.env.DB_AWS_SECRET_ID = 'milab/db';
  process.env.AWS_REGION = 'us-east-1';

  try {
    const credentials = await loaded.resolveDatabaseCredentials();

    assert.deepEqual(credentials, {
      user: 'secret_user',
      password: 'secret_password',
    });
    assert.deepEqual(loaded.clientConfigs, [{ region: 'us-east-1' }]);
    assert.deepEqual(loaded.commandInputs, [{ SecretId: 'milab/db' }]);
  } finally {
    loaded.restore();
  }
});

test('resolveDatabaseCredentials reads credentials from AWS SecretBinary and custom keys', async () => {
  const loaded = loadDbCredentialsModule({
    configOverrides: {
      dbSecretUserKey: 'username',
      dbSecretPasswordKey: 'passcode',
    },
    sendImpl: async () => ({
      SecretBinary: Buffer.from(
        JSON.stringify({ username: 'binary_user', passcode: 'binary_password' })
      ),
    }),
  });
  process.env.DB_AWS_SECRET_ID = 'milab/db';
  process.env.AWS_REGION = 'us-east-2';

  try {
    const credentials = await loaded.resolveDatabaseCredentials();

    assert.deepEqual(credentials, {
      user: 'binary_user',
      password: 'binary_password',
    });
  } finally {
    loaded.restore();
  }
});

test('resolveDatabaseCredentials fails when the secret id env var is missing', async () => {
  const loaded = loadDbCredentialsModule();
  delete process.env.DB_AWS_SECRET_ID;
  process.env.AWS_REGION = 'us-east-1';

  try {
    await assert.rejects(
      loaded.resolveDatabaseCredentials(),
      /\[DB_SECRET\] La variable DB_AWS_SECRET_ID es obligatoria\./
    );
  } finally {
    loaded.restore();
  }
});

test('parseSecretJson fails for invalid JSON payloads', () => {
  const loaded = loadDbCredentialsModule();

  try {
    assert.throws(
      () => loaded.parseSecretJson('not-json', 'milab/db'),
      /\[DB_SECRET\] El secreto milab\/db no tiene un JSON valido\./
    );
  } finally {
    loaded.restore();
  }
});

test('resolveDatabaseCredentials fails when the secret omits required fields', async () => {
  const loaded = loadDbCredentialsModule({
    sendImpl: async () => ({
      SecretString: JSON.stringify({ user: 'secret_user' }),
    }),
  });
  process.env.DB_AWS_SECRET_ID = 'milab/db';
  process.env.AWS_REGION = 'us-east-1';

  try {
    await assert.rejects(
      loaded.resolveDatabaseCredentials(),
      /\[DB_SECRET\] El campo password no existe o esta vacio en el secreto milab\/db\./
    );
  } finally {
    loaded.restore();
  }
});
