const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { loadModuleWithStubs, resolveRepoPath } = require('./helpers/build-test-app');

const appPath = resolveRepoPath('src/app.js');
const loggerPath = resolveRepoPath('src/libs/logger.js');
const dbPath = resolveRepoPath('src/libs/db.js');
const microsoftPath = resolveRepoPath('src/routes/middlewares/microsoft.js');
const notificationJobPath = resolveRepoPath('src/jobs/coordinator-pending-notifications.job.js');
const loggedErrors = [];
const testLogger = {
  child() {
    return testLogger;
  },
  warn() {},
  info() {},
  error(...args) {
    loggedErrors.push(
      args.map((value) => {
        if (value instanceof Error) return value.stack;
        if (value?.err instanceof Error) return value.err.stack;
        return value;
      })
    );
  },
  debug() {},
  trace() {},
  fatal() {},
};

test('full app mounts the public MILab home route beneath /milab', async () => {
  const previousEnv = new Map(
    ['NODE_ENV', 'SESSION_SECRET', 'SESSION_SECURE', 'ENABLE_DEV_LOGIN'].map((key) => [
      key,
      process.env[key],
    ])
  );
  let loaded;

  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'integration-test-secret';
  process.env.SESSION_SECURE = 'false';
  delete process.env.ENABLE_DEV_LOGIN;

  try {
    loggedErrors.length = 0;
    loaded = loadModuleWithStubs({
      entryPath: appPath,
      stubs: [
        [
          loggerPath,
          {
            createRequestId() {
              return 'test-request-id';
            },
            parseBoolean(value, fallback) {
              return fallback;
            },
            installConsoleBridge() {},
            installProcessHandlers() {},
            loggerConfig: {
              requestLoggingEnabled: false,
              requestSampleRate: 0,
              slowRequestMs: 1000,
            },
            maskIdentifier(value) {
              return value;
            },
            logger: testLogger,
          },
        ],
        [
          dbPath,
          {
            async query() {
              return { rows: [] };
            },
            async connect() {
              return {
                async query() {
                  return { rows: [] };
                },
                release() {},
              };
            },
          },
        ],
        [microsoftPath, {}],
        [
          notificationJobPath,
          {
            startCoordinatorPendingNotificationsJob() {},
          },
        ],
      ],
      purgePaths: [appPath, loggerPath, dbPath, microsoftPath, notificationJobPath],
    });

    const response = await request(loaded.loaded).get('/milab/');

    assert.equal(response.status, 200, JSON.stringify(loggedErrors));
    assert.match(response.headers['content-type'], /html/);
  } finally {
    loaded?.restore();
    for (const [key, previousValue] of previousEnv) {
      if (previousValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
});
