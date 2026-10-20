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

test('identity lookup helpers skip empty identifiers and return matching user rows', async () => {
  const user = {
    id: 7,
    correo: 'demo@udistrital.edu.co',
    documento: '1007',
    nombre: 'Usuario Demo',
    roles: ['estudiante'],
  };
  const calls = [];
  const loaded = loadUserIdentity(async (query, values) => {
    calls.push({ query, values });
    return {
      rows: values[0] === user.correo || values[0] === user.id ? [user] : [],
    };
  });

  try {
    const { fetchUserByEmail, fetchUserById } = loaded.userIdentity;

    assert.equal(await fetchUserByEmail(''), null);
    assert.equal(await fetchUserById(0), null);
    assert.deepEqual(await fetchUserByEmail(user.correo), user);
    assert.equal(await fetchUserByEmail('missing@udistrital.edu.co'), null);
    assert.deepEqual(await fetchUserById(user.id), user);
    assert.equal(await fetchUserById(404), null);
    assert.equal(calls.length, 4);
    assert.match(calls[0].query, /LOWER\(u\.correo\)/);
    assert.match(calls[2].query, /WHERE u\.id = \$1/);
  } finally {
    loaded.restore();
  }
});

test('upsertUsuarioByDocumento rejects a blank document and applies safe defaults', async () => {
  let capturedValues = null;
  const loaded = loadUserIdentity(async (query, values) => {
    capturedValues = values;
    return { rows: [] };
  });

  try {
    const { upsertUsuarioByDocumento } = loaded.userIdentity;

    assert.equal(await upsertUsuarioByDocumento({ documento: '   ' }), null);
    assert.equal(capturedValues, null);
    assert.equal(
      await upsertUsuarioByDocumento({
        documento: ' 1008 ',
        nombre: '   ',
        correo: ' DEMO@UDISTRITAL.EDU.CO ',
        codigo: '',
        estado: '',
        carrera: '',
      }),
      null
    );
    assert.deepEqual(capturedValues, [
      '1008',
      'demo@udistrital.edu.co',
      'Sin nombre',
      null,
      null,
      null,
    ]);
  } finally {
    loaded.restore();
  }
});

test('student and docente profiles are persisted only after the base user is found', async () => {
  const calls = [];
  const loaded = loadUserIdentity(async (query, values) => {
    calls.push({ query, values });
    if (query.includes('INSERT INTO usuario')) {
      return { rows: [{ id: calls.length }] };
    }
    return { rows: [] };
  });

  try {
    const { ensurePerfilEstudiante, ensurePerfilDocente } = loaded.userIdentity;

    assert.equal(
      await ensurePerfilEstudiante({
        documento: '1009',
        nombre: 'Estudiante Demo',
        codigo: '2020101',
        programa: 'Ciencias',
        estado: 'Activo',
        correo: 'estudiante@udistrital.edu.co',
      }),
      1
    );
    assert.equal(
      await ensurePerfilDocente({
        documento: 'docente-1',
        nombre: 'Docente Demo',
        estado: 'Activo',
        correo: 'docente@udistrital.edu.co',
      }),
      3
    );
    assert.equal(calls.length, 4);
    assert.match(calls[1].query, /INSERT INTO perfil_estudiante/);
    assert.match(calls[3].query, /INSERT INTO perfil_docente/);
    assert.deepEqual(calls[1].values, [
      1,
      '1009',
      'Estudiante Demo',
      '2020101',
      'Ciencias',
      'Activo',
    ]);
    assert.deepEqual(calls[3].values, [3, 'docente-1', 'Docente Demo', 'Activo']);
  } finally {
    loaded.restore();
  }
});

test('student and docente profile helpers return null when no base user is available', async () => {
  let queryCount = 0;
  const loaded = loadUserIdentity(async () => {
    queryCount += 1;
    return { rows: [] };
  });

  try {
    const { ensurePerfilEstudiante, ensurePerfilDocente } = loaded.userIdentity;

    assert.equal(await ensurePerfilEstudiante({ documento: '' }), null);
    assert.equal(await ensurePerfilDocente({ documento: '   ' }), null);
    assert.equal(await ensurePerfilEstudiante({ documento: '1010' }), null);
    assert.equal(await ensurePerfilDocente({ documento: 'docente-2' }), null);
    assert.equal(queryCount, 2);
  } finally {
    loaded.restore();
  }
});

test('student and docente identifiers resolve only when the identifying fields exist', async () => {
  const calls = [];
  const loaded = loadUserIdentity(async (query, values) => {
    calls.push({ query, values });
    return {
      rows: [query.includes('perfil_estudiante') ? { usuario_id: 21 } : { usuario_id: 22 }],
    };
  });

  try {
    const { resolveUsuarioIdForDocente, resolveUsuarioIdForStudent } = loaded.userIdentity;

    assert.equal(await resolveUsuarioIdForStudent({ documento: '', codigo: '' }), null);
    assert.equal(await resolveUsuarioIdForDocente('  '), null);
    assert.equal(await resolveUsuarioIdForStudent({ documento: ' 1011 ', codigo: ' 202011 ' }), 21);
    assert.equal(await resolveUsuarioIdForDocente(' docente-3 '), 22);
    assert.deepEqual(
      calls.map(({ values }) => values),
      [['1011', '202011'], ['docente-3']]
    );
  } finally {
    loaded.restore();
  }
});

test('buildSessionUser handles missing rows and normalizes the primary role', () => {
  const loaded = loadUserIdentity(async () => ({ rows: [] }));

  try {
    const { buildSessionUser } = loaded.userIdentity;

    assert.equal(buildSessionUser(null), null);
    assert.deepEqual(
      buildSessionUser({
        id: 12,
        correo: 'docente@udistrital.edu.co',
        documento: 'docente-4',
        nombre: 'Docente Demo',
        roles: ['docente', 'estudiante'],
      }),
      {
        id: 12,
        correo: 'docente@udistrital.edu.co',
        documento: 'docente-4',
        documento_real: 'docente-4',
        nombre: 'Docente Demo',
        roles: ['docente', 'estudiante'],
        tipo: 'docente',
      }
    );
  } finally {
    loaded.restore();
  }
});
