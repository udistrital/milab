const express = require('express');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');

function resolveRepoPath(...segments) {
  return path.resolve(repoRoot, ...segments);
}

function loadModuleWithStubs({ entryPath, stubs = [], purgePaths = [] }) {
  const originals = new Map();

  delete require.cache[entryPath];
  for (const modulePath of purgePaths) {
    delete require.cache[modulePath];
  }

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
    loaded: require(entryPath),
    restore() {
      delete require.cache[entryPath];

      for (const [modulePath, original] of originals.entries()) {
        if (original) {
          require.cache[modulePath] = original;
        } else {
          delete require.cache[modulePath];
        }
      }
    },
  };
}

function buildApp({ entryPath, mountPath = '/', sessionHarness, stubs = [], purgePaths = [] }) {
  const app = express();
  const loaded = loadModuleWithStubs({ entryPath, stubs, purgePaths });

  app.use((req, res, next) => {
    if (sessionHarness) {
      sessionHarness.attach(req);
    }

    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });

  app.use(mountPath, loaded.loaded);
  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error);
    }

    return res.status(error?.status || 500).json({
      error: error?.message || 'Unexpected test error',
    });
  });

  return {
    app,
    restore: loaded.restore,
  };
}

module.exports = {
  buildApp,
  loadModuleWithStubs,
  resolveRepoPath,
};
