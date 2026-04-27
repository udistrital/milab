const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/generate-path.js');

function loadGeneratePathModule(envOverrides = {}) {
  const previousEnv = {
    PRIVATE_GENERATE_DIR_ENABLED: process.env.PRIVATE_GENERATE_DIR_ENABLED,
    PRIVATE_GENERATE_DIR: process.env.PRIVATE_GENERATE_DIR,
  };

  Object.entries(envOverrides).forEach(([key, value]) => {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });

  delete require.cache[modulePath];
  const loaded = require(modulePath);

  return {
    ...loaded,
    restore() {
      Object.entries(previousEnv).forEach(([key, value]) => {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      });

      delete require.cache[modulePath];
    },
  };
}

test('generate-path uses public folder when private mode is disabled', () => {
  const loaded = loadGeneratePathModule({
    PRIVATE_GENERATE_DIR_ENABLED: 'false',
    PRIVATE_GENERATE_DIR: undefined,
  });

  try {
    assert.equal(loaded.usePrivateGenerateDir, false);
    assert.match(loaded.generateDir, /src\/public\/generate$/);
    assert.equal(loaded.buildGeneratePath('file.pdf'), path.join(loaded.generateDir, 'file.pdf'));
  } finally {
    loaded.restore();
  }
});

test('generate-path uses configured private folder when enabled', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'milab-generate-'));
  const loaded = loadGeneratePathModule({
    PRIVATE_GENERATE_DIR_ENABLED: 'true',
    PRIVATE_GENERATE_DIR: tempDir,
  });

  try {
    assert.equal(loaded.usePrivateGenerateDir, true);
    assert.equal(loaded.generateDir, tempDir);
    assert.equal(loaded.buildGeneratePath('file.pdf'), path.join(tempDir, 'file.pdf'));
  } finally {
    loaded.restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
