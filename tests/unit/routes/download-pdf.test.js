const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/download-pdf.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const generatePathPath = path.resolve(__dirname, '../../../src/libs/generate-path.js');
const authPath = path.resolve(__dirname, '../../../src/routes/middlewares/auth.js');

function buildApp(route) {
  const app = express();

  app.use((req, res, next) => {
    req.session = {
      user: {
        tipo: 'admin',
        documento: '1024467835',
      },
    };
    next();
  });
  app.use('/', route);

  return app;
}

function loadRoute() {
  const originals = new Map();
  const downloadCalls = [];
  const stubs = [
    [dbPath, { query: async () => ({ rows: [] }) }],
    [generatePathPath, { buildGeneratePath: (fileName) => `/tmp/${fileName}` }],
    [
      authPath,
      {
        requireRoles: () => (req, res, next) => next(),
      },
    ],
  ];

  delete require.cache[routePath];

  for (const [modulePath, stub] of stubs) {
    originals.set(modulePath, require.cache[modulePath]);
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports: stub,
    };
  }

  return {
    route: require(routePath),
    downloadCalls,
    installDownloadSpy(app) {
      app.response.download = function download(filePath, fileName) {
        downloadCalls.push({ filePath, fileName });
        this.status(200).json({ filePath, fileName });
      };
    },
    restore() {
      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }

      delete require.cache[routePath];
    },
  };
}

test('download-pdf parses form submissions and downloads the generated certificate', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route);
    loaded.installDownloadSpy(app);

    const response = await request(app).post('/').type('form').send({
      con_codigo: '20211081025',
    });

    assert.equal(response.status, 200);
    assert.deepEqual(loaded.downloadCalls, [
      {
        filePath: '/tmp/certificado_20211081025.pdf',
        fileName: 'Certificado_PazySalvo.pdf',
      },
    ]);
  } finally {
    loaded.restore();
  }
});
