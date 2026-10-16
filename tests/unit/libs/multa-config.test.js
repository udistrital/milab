const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/multa-config.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');

function loadMultaConfig(queryImpl) {
  const originalDb = require.cache[dbPath];

  delete require.cache[modulePath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: { query: queryImpl },
  };

  return {
    ...require(modulePath),
    restore() {
      if (originalDb) {
        require.cache[dbPath] = originalDb;
      } else {
        delete require.cache[dbPath];
      }

      delete require.cache[modulePath];
    },
  };
}

function buildConfigRow(overrides = {}) {
  return {
    facultad_id: 7,
    permite_crear_multas_activas_directas: true,
    permite_saldar_multas_directas: false,
    fecha_ultima_modificacion: '2026-10-16T12:00:00.000Z',
    documento_ultimo_autorizador: 'admin-1',
    accion_ultima: 'actualizar',
    ...overrides,
  };
}

test('sanction type helpers normalize user input and accept only configured values', () => {
  const loaded = loadMultaConfig(async () => ({ rows: [] }));

  try {
    const validType = loaded.SANCTION_TYPES[0];

    assert.equal(loaded.normalizeSanctionType(null), '');
    assert.equal(loaded.normalizeSanctionType(` ${validType} `), validType);
    assert.equal(loaded.isValidSanctionType(` ${validType} `), true);
    assert.equal(loaded.isValidSanctionType('Tipo de sanción no configurado'), false);
  } finally {
    loaded.restore();
  }
});

test('fetchMultaConfigsForFacultyIds skips empty input and fills defaults for missing rows', async () => {
  const calls = [];
  const loaded = loadMultaConfig(async (query, params) => {
    calls.push({ query, params });
    return { rows: [buildConfigRow({ facultad_id: 1 })] };
  });

  try {
    assert.equal((await loaded.fetchMultaConfigsForFacultyIds([])).size, 0);
    assert.equal((await loaded.fetchMultaConfigsForFacultyIds(['invalid'])).size, 0);
    assert.equal(calls.length, 0);

    const configs = await loaded.fetchMultaConfigsForFacultyIds([1, 2, '3', 'invalid']);

    assert.equal(calls.length, 1);
    assert.match(calls[0].query, /facultad_id IN \(\$1, \$2, \$3\)/);
    assert.deepEqual(calls[0].params, [1, 2, '3']);
    assert.equal(configs.size, 3);
    assert.deepEqual(configs.get(1), {
      facultad_id: 1,
      permite_crear_multas_activas_directas: true,
      permite_saldar_multas_directas: false,
      fecha_ultima_modificacion: '2026-10-16T12:00:00.000Z',
      documento_ultimo_autorizador: 'admin-1',
      accion_ultima: 'actualizar',
    });
    assert.deepEqual(configs.get(2), {
      facultad_id: 2,
      permite_crear_multas_activas_directas: false,
      permite_saldar_multas_directas: false,
      fecha_ultima_modificacion: null,
      documento_ultimo_autorizador: null,
      accion_ultima: 'inicial',
    });
    assert.equal(configs.get(3).facultad_id, 3);
  } finally {
    loaded.restore();
  }
});

test('faculty and UAL lookups normalize persisted configuration and handle missing rows', async () => {
  const calls = [];
  const loaded = loadMultaConfig(async (query, params) => {
    calls.push({ query, params });
    return query.includes('WHERE facultad_id = $1')
      ? { rows: [buildConfigRow({ permite_saldar_multas_directas: true })] }
      : { rows: [] };
  });

  try {
    assert.deepEqual(await loaded.resolveMultaConfigForFacultyId('invalid'), {
      facultad_id: null,
      permite_crear_multas_activas_directas: false,
      permite_saldar_multas_directas: false,
      fecha_ultima_modificacion: null,
      documento_ultimo_autorizador: null,
      accion_ultima: 'inicial',
    });
    assert.deepEqual(await loaded.resolveMultaConfigForFacultyId('7'), {
      facultad_id: 7,
      permite_crear_multas_activas_directas: true,
      permite_saldar_multas_directas: true,
      fecha_ultima_modificacion: '2026-10-16T12:00:00.000Z',
      documento_ultimo_autorizador: 'admin-1',
      accion_ultima: 'actualizar',
    });
    assert.equal((await loaded.resolveMultaConfigForUalId('invalid')).facultad_id, null);
    assert.equal((await loaded.resolveMultaConfigForUalId(10)).facultad_id, null);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].params, [7]);
    assert.deepEqual(calls[1].params, [10]);
  } finally {
    loaded.restore();
  }
});

test('resolveMultaConfigForMultaId follows the fine to UAL and faculty configuration', async () => {
  const calls = [];
  const loaded = loadMultaConfig(async (query, params) => {
    calls.push({ query, params });
    return { rows: [buildConfigRow({ facultad_id: 5 })] };
  });

  try {
    const invalid = await loaded.resolveMultaConfigForMultaId('not-an-id');
    assert.equal(invalid.facultad_id, null);
    assert.equal(calls.length, 0);

    const config = await loaded.resolveMultaConfigForMultaId('42');
    assert.equal(config.facultad_id, 5);
    assert.match(calls[0].query, /JOIN ual ON ual\.ual_id = multa\.ual_id/);
    assert.deepEqual(calls[0].params, [42]);
  } finally {
    loaded.restore();
  }
});

test('upsertConfigForFacultyId validates identifiers and writes only supplied boolean settings', async () => {
  const calls = [];
  const loaded = loadMultaConfig(async (query, params) => {
    calls.push({ query, params });
    return { rows: [buildConfigRow()] };
  });

  try {
    await assert.rejects(
      loaded.upsertConfigForFacultyId('invalid', {}, 'admin-1', 'actualizar'),
      /facultad_id inválido/
    );
    assert.equal(calls.length, 0);

    const config = await loaded.upsertConfigForFacultyId(
      '7',
      {
        permite_crear_multas_activas_directas: true,
        permite_saldar_multas_directas: false,
      },
      ' admin-1 ',
      ' actualizar '
    );

    assert.equal(config.facultad_id, 7);
    assert.match(calls[0].query, /ON CONFLICT \(facultad_id\) DO UPDATE/);
    assert.deepEqual(calls[0].params.slice(0, 3), [7, true, false]);
    assert.ok(calls[0].params[3] instanceof Date);
    assert.deepEqual(calls[0].params.slice(4), ['admin-1', 'actualizar']);
  } finally {
    loaded.restore();
  }
});

test('upsertConfigForFacultyId leaves unspecified access values unchanged', async () => {
  let capturedQuery = '';
  let capturedParams = [];
  const loaded = loadMultaConfig(async (query, params) => {
    capturedQuery = query;
    capturedParams = params;
    return { rows: [] };
  });

  try {
    const result = await loaded.upsertConfigForFacultyId(8, {}, '', '');

    assert.equal(result.facultad_id, null);
    assert.match(
      capturedQuery,
      /ON CONFLICT \(facultad_id\) DO UPDATE SET fecha_ultima_modificacion = EXCLUDED\.fecha_ultima_modificacion/
    );
    assert.equal(capturedParams.length, 2);
    assert.equal(capturedParams[0], 8);
    assert.ok(capturedParams[1] instanceof Date);
  } finally {
    loaded.restore();
  }
});

test('logConfigChangeToAuditoria records normalized metadata and applies defaults', async () => {
  const calls = [];
  const loaded = loadMultaConfig(async () => ({ rows: [] }));
  const client = {
    async query(query, params) {
      calls.push({ query, params });
      return { rows: [] };
    },
  };

  try {
    await loaded.logConfigChangeToAuditoria(
      client,
      ' admin-1 ',
      'CAMBIO',
      'Permisos actualizados',
      { facultadId: 7 }
    );
    await loaded.logConfigChangeToAuditoria(client, null, '', '', null);

    assert.match(calls[0].query, /INSERT INTO auditoria/);
    assert.deepEqual(calls[0].params.slice(0, 5), [
      ' admin-1 ',
      'prestamos',
      'autorizaciones_multas_facultad',
      'CAMBIO',
      'Permisos actualizados',
    ]);
    assert.ok(calls[0].params[5] instanceof Date);
    assert.equal(calls[0].params[6], JSON.stringify({ facultadId: 7 }));
    assert.deepEqual(calls[1].params.slice(0, 5), [
      null,
      'prestamos',
      'autorizaciones_multas_facultad',
      'CONFIG_MULTAS',
      'Cambio de configuración de multas por facultad',
    ]);
    assert.equal(calls[1].params[6], null);
  } finally {
    loaded.restore();
  }
});

test('logConfigChangeToAuditoria does not abort the caller when audit persistence fails', async (t) => {
  const errorSpy = t.mock.method(console, 'error', () => {});
  const loaded = loadMultaConfig(async () => ({ rows: [] }));

  try {
    await assert.doesNotReject(
      loaded.logConfigChangeToAuditoria(
        {
          async query() {
            throw new Error('Audit unavailable');
          },
        },
        'admin-1',
        'CAMBIO',
        'Prueba',
        null
      )
    );
    assert.equal(errorSpy.mock.callCount(), 1);
  } finally {
    loaded.restore();
  }
});
