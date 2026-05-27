const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/user-identity.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const rolesPath = path.resolve(__dirname, '../../../src/libs/roles.js');

function loadUserIdentity(queryImpl) {
  const originalDb = require.cache[dbPath];
  const originalRoles = require.cache[rolesPath];

  delete require.cache[modulePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: queryImpl,
    },
  };
  require.cache[rolesPath] = {
    id: rolesPath,
    filename: rolesPath,
    loaded: true,
    exports: {
      getPrimaryRole(roles) {
        return roles[0] || null;
      },
      normalizeRoles(roles) {
        return Array.isArray(roles) ? roles : [];
      },
    },
  };

  return {
    userIdentity: require(modulePath),
    restore() {
      if (originalDb) {
        require.cache[dbPath] = originalDb;
      } else {
        delete require.cache[dbPath];
      }

      if (originalRoles) {
        require.cache[rolesPath] = originalRoles;
      } else {
        delete require.cache[rolesPath];
      }

      delete require.cache[modulePath];
    },
  };
}

test('isSyntheticInstitutionalEmail detects document-based placeholder emails', () => {
  const loaded = loadUserIdentity(async () => ({ rows: [] }));

  try {
    const { isPlaceholderEmail, isSyntheticInstitutionalEmail } = loaded.userIdentity;

    assert.equal(isSyntheticInstitutionalEmail('1000694178@udistrital.edu.co', '1000694178'), true);
    assert.equal(isSyntheticInstitutionalEmail('acmendeza@udistrital.edu.co', '1000694178'), false);
    assert.equal(isSyntheticInstitutionalEmail('', '1000694178'), false);
    assert.equal(isPlaceholderEmail('no-email+1000694178@placeholder.milab.local'), true);
    assert.equal(isPlaceholderEmail('acmendeza@udistrital.edu.co'), false);
  } finally {
    loaded.restore();
  }
});

test('upsertUsuarioByDocumento stores a non-deliverable placeholder when no real email is provided', async () => {
  let capturedValues = null;
  const loaded = loadUserIdentity(async (query, values) => {
    capturedValues = values;
    return { rows: [{ id: 1 }] };
  });

  try {
    const { upsertUsuarioByDocumento } = loaded.userIdentity;
    const userId = await upsertUsuarioByDocumento({
      documento: '1000694178',
      nombre: 'Estudiante Prueba',
      correo: null,
      codigo: '20211081025',
    });

    assert.equal(userId, 1);
    assert.equal(capturedValues[0], '1000694178');
    assert.equal(capturedValues[1], 'no-email+1000694178@placeholder.milab.local');
    assert.equal(capturedValues[2], 'Estudiante Prueba');
  } finally {
    loaded.restore();
  }
});
