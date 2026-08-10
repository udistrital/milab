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
