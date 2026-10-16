const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/prestamos-module-access.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');
const facultyScopePath = path.resolve(__dirname, '../../../src/libs/faculty-scope.js');
const operationalRoleAssignmentsPath = path.resolve(
  __dirname,
  '../../../src/libs/operational-role-assignments.js'
);

function loadPrestamosModuleAccess({ queryImpl, scopeImpl, operationalScopeImpl } = {}) {
  const originals = new Map();

  const stubs = [
    [
      dbPath,
      {
        query: queryImpl || (async () => ({ rows: [] })),
      },
    ],
    [
      facultyScopePath,
      {
        resolveCoordinatorScope:
          scopeImpl || (async () => ({ coordinatorDocument: '123', facultyIds: [2, 4] })),
      },
    ],
    [
      operationalRoleAssignmentsPath,
      {
        fetchOperationalRoleScopeByUser:
          operationalScopeImpl ||
          (async () => ({
            role: 'monitor',
            facultyIds: [7, 9],
            laboratoryNames: ['Lab 1'],
            ualIds: [10],
          })),
      },
    ],
  ];

  delete require.cache[modulePath];

  for (const [stubPath, exports] of stubs) {
    originals.set(stubPath, require.cache[stubPath]);
    require.cache[stubPath] = {
      id: stubPath,
      filename: stubPath,
      loaded: true,
      exports,
    };
  }

  return {
    ...require(modulePath),
    restore() {
      for (const [stubPath, original] of originals.entries()) {
        if (original) {
          require.cache[stubPath] = original;
        } else {
          delete require.cache[stubPath];
        }
      }

      delete require.cache[modulePath];
    },
  };
}

test('getPrestamosModuleAccess bypasses faculty checks for admin', async () => {
  const loaded = loadPrestamosModuleAccess();

  try {
    const result = await loaded.getPrestamosModuleAccess({ roles: ['admin'] });

    assert.deepEqual(result, {
      role: 'admin',
      facultyIds: [],
      allowedFacultyIds: [],
      blockedFacultyIds: [],
      blocked: false,
    });
  } finally {
    loaded.restore();
  }
});

test('resolveAllowedPrestamosFacultyIdsForRole keeps all faculties when access table is missing', async () => {
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async () => {
      const error = new Error('missing relation');
      error.code = '42P01';
      throw error;
    },
  });

  try {
    const result = await loaded.resolveAllowedPrestamosFacultyIdsForRole([2, 5], 'coordinador');

    assert.deepEqual(result, [2, 5]);
  } finally {
    loaded.restore();
  }
});

test('getPrestamosModuleAccess blocks coordinador when all faculties are explicitly disabled', async () => {
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async () => ({
      rows: [
        { facultad_id: 2, permitido: false },
        { facultad_id: 4, permitido: false },
      ],
    }),
  });

  try {
    const result = await loaded.getPrestamosModuleAccess({
      documento: '123',
      roles: ['coordinador'],
    });

    assert.deepEqual(result, {
      role: 'coordinador',
      facultyIds: [2, 4],
      allowedFacultyIds: [],
      blockedFacultyIds: [2, 4],
      blocked: true,
    });
  } finally {
    loaded.restore();
  }
});

test('removePrestamosNavigation strips prestamos links from all navigation sections', () => {
  const loaded = loadPrestamosModuleAccess();

  try {
    const navigation = loaded.removePrestamosNavigation({
      primaryLinks: [{ href: '/milab/prestamos' }, { href: '/milab/api/dashboard' }],
      accountLinks: [{ href: '/milab/prestamos/perfil' }, { href: '/milab/api/profile' }],
      secondaryGroups: [
        {
          title: 'Prestamos',
          items: [{ href: '/milab/prestamos/solicitudes' }],
        },
        {
          title: 'Operacion',
          items: [{ href: '/milab/api/logs' }, { href: '/milab/prestamos/reportes' }],
        },
      ],
    });

    assert.deepEqual(navigation, {
      primaryLinks: [{ href: '/milab/api/dashboard' }],
      accountLinks: [{ href: '/milab/api/profile' }],
      secondaryGroups: [
        {
          title: 'Operacion',
          items: [{ href: '/milab/api/logs' }],
        },
      ],
    });
  } finally {
    loaded.restore();
  }
});

test('getPrestamosModuleAccess checks whether any faculty enabled access for students and docentes', async () => {
  const enabled = loadPrestamosModuleAccess({
    queryImpl: async () => ({ rows: [{ has_enabled: true }] }),
  });

  try {
    const studentAccess = await enabled.getPrestamosModuleAccess({ roles: ['estudiante'] });
    const docenteAccess = await enabled.getPrestamosModuleAccess({ roles: ['docente'] });

    assert.equal(studentAccess.blocked, false);
    assert.equal(studentAccess.role, 'estudiante');
    assert.equal(docenteAccess.blocked, false);
    assert.equal(docenteAccess.role, 'docente');
  } finally {
    enabled.restore();
  }

  const disabled = loadPrestamosModuleAccess({
    queryImpl: async () => ({ rows: [{ has_enabled: false }] }),
  });

  try {
    const disabledAccess = await disabled.getPrestamosModuleAccess({ roles: ['estudiante'] });
    assert.equal(disabledAccess.blocked, true);
  } finally {
    disabled.restore();
  }
});

test('resolvePrestamosRestrictedRoleScope handles missing identity, unsupported roles, coordinators, and monitors', async () => {
  const scopeCalls = [];
  const operationalCalls = [];
  const loaded = loadPrestamosModuleAccess({
    scopeImpl: async (client, document) => {
      scopeCalls.push(document);
      return { facultyIds: ['2', 'invalid', 4] };
    },
    operationalScopeImpl: async (user, role, client) => {
      operationalCalls.push({ user, role, client });
      return { facultyIds: [7, '9'] };
    },
  });

  try {
    assert.deepEqual(await loaded.resolvePrestamosRestrictedRoleScope({ roles: ['coordinador'] }), {
      role: null,
      facultyIds: [],
    });
    assert.deepEqual(
      await loaded.resolvePrestamosRestrictedRoleScope({
        roles: ['estudiante'],
        documento: 'student-1',
      }),
      { role: null, facultyIds: [] }
    );
    assert.deepEqual(
      await loaded.resolvePrestamosRestrictedRoleScope({
        roles: ['coordinador'],
        documento: 'coord-1',
      }),
      { role: 'coordinador', facultyIds: [2, 4] }
    );
    const monitor = { roles: ['monitor'], documento: 'monitor-1' };
    assert.deepEqual(await loaded.resolvePrestamosRestrictedRoleScope(monitor), {
      role: 'monitor',
      facultyIds: [7, '9'],
    });
    assert.deepEqual(scopeCalls, ['coord-1']);
    assert.equal(operationalCalls.length, 1);
    assert.equal(operationalCalls[0].user, monitor);
    assert.equal(operationalCalls[0].role, 'monitor');
    assert.equal(typeof operationalCalls[0].client.query, 'function');
  } finally {
    loaded.restore();
  }
});

test('getPrestamosModuleAccess resolves laboratorista faculty scope and partial access', async () => {
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async (query) => {
      if (query.includes('FROM laboratorista_ual lu')) {
        return { rows: [{ faculty_id: '2' }, { faculty_id: 5 }, { faculty_id: 'invalid' }] };
      }
      if (query.includes('FROM laboratorista')) {
        return { rows: [{ documento: 'lab-1' }] };
      }
      if (query.includes('FROM facultad_modulo_acceso')) {
        return { rows: [{ facultad_id: 2, permitido: false }] };
      }
      return { rows: [] };
    },
  });

  try {
    const access = await loaded.getPrestamosModuleAccess({
      roles: ['laboratorista'],
      documento: 'login-lab',
    });

    assert.deepEqual(access, {
      role: 'laboratorista',
      facultyIds: [2, 5],
      allowedFacultyIds: [5],
      blockedFacultyIds: [2],
      blocked: false,
    });
  } finally {
    loaded.restore();
  }
});

test('resolveAllowedPrestamosFacultyIdsForRole keeps only explicitly disabled faculties out', async () => {
  let capturedParams;
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async (query, params) => {
      capturedParams = params;
      return {
        rows: [
          { facultad_id: 2, permitido: true },
          { facultad_id: 4, permitido: false },
        ],
      };
    },
  });

  try {
    assert.deepEqual(
      await loaded.resolveAllowedPrestamosFacultyIdsForRole([2, '4', 6, 'invalid'], 'monitor'),
      [2, 6]
    );
    assert.deepEqual(capturedParams, [[2, 4, 6], 'monitor']);
    assert.deepEqual(await loaded.resolveAllowedPrestamosFacultyIdsForRole([], 'monitor'), []);
    assert.deepEqual(await loaded.resolveAllowedPrestamosFacultyIdsForRole([2], null), []);
  } finally {
    loaded.restore();
  }
});

test('module access checks preserve legacy availability when access metadata is missing', async () => {
  const missingAccessTable = () => {
    const error = new Error('missing access metadata');
    error.code = '42703';
    return error;
  };
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async (query) => {
      if (query.includes('SELECT EXISTS')) throw missingAccessTable();
      if (query.includes('SELECT facultad_id, permitido')) throw missingAccessTable();
      if (query.includes('LEFT JOIN facultad_modulo_acceso')) throw missingAccessTable();
      return {
        rows: [
          {
            facultad_id: 3,
            nombre: 'Facultad de Ciencias',
            coordinador_permitido: true,
            laboratorista_permitido: true,
            monitor_permitido: true,
          },
        ],
      };
    },
  });

  try {
    assert.equal((await loaded.getPrestamosModuleAccess({ roles: ['estudiante'] })).blocked, false);
    assert.deepEqual(
      await loaded.resolveAllowedPrestamosFacultyIdsForRole([3, 8], 'monitor'),
      [3, 8]
    );
    assert.deepEqual(await loaded.listPrestamosFacultyAccess(), [
      {
        facultad_id: 3,
        nombre: 'Facultad de Ciencias',
        coordinador_permitido: true,
        laboratorista_permitido: true,
        monitor_permitido: true,
      },
    ]);
  } finally {
    loaded.restore();
  }
});

test('module access lookup propagates database errors other than missing access metadata', async () => {
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async () => {
      const error = new Error('database unavailable');
      error.code = '08006';
      throw error;
    },
  });

  try {
    await assert.rejects(
      loaded.getPrestamosModuleAccess({ roles: ['estudiante'] }),
      /database unavailable/
    );
    await assert.rejects(
      loaded.resolveAllowedPrestamosFacultyIdsForRole([2], 'monitor'),
      /database unavailable/
    );
    await assert.rejects(loaded.listPrestamosFacultyAccess(), /database unavailable/);
  } finally {
    loaded.restore();
  }
});

test('updatePrestamosFacultyAccess persists the faculty role permission', async () => {
  let capturedQuery = '';
  let capturedParams = null;
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async (query, params) => {
      capturedQuery = query;
      capturedParams = params;
      return { rows: [] };
    },
  });

  try {
    await loaded.updatePrestamosFacultyAccess({
      facultadId: 9,
      role: 'monitor',
      permitido: false,
    });

    assert.match(capturedQuery, /INSERT INTO facultad_modulo_acceso/);
    assert.deepEqual(capturedParams, [9, 'monitor', false]);
  } finally {
    loaded.restore();
  }
});

test('listPrestamosFacultyAccess returns configured rows and rejects unrelated database failures', async () => {
  const configuredRows = [
    {
      facultad_id: 4,
      nombre: 'Facultad de Ingeniería',
      coordinador_permitido: false,
      laboratorista_permitido: true,
      monitor_permitido: true,
    },
  ];
  const loaded = loadPrestamosModuleAccess({
    queryImpl: async () => ({ rows: configuredRows }),
  });

  try {
    assert.deepEqual(await loaded.listPrestamosFacultyAccess(), configuredRows);
  } finally {
    loaded.restore();
  }
});
