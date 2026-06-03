const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const modulePath = path.resolve(__dirname, '../../../src/libs/oati-name.js');
const oatiClientPath = path.resolve(__dirname, '../../../src/libs/oati-client.js');

function loadOatiNameModule({ requestImpl }) {
  const originalOatiClient = require.cache[oatiClientPath];
  const calls = [];

  delete require.cache[modulePath];
  require.cache[oatiClientPath] = {
    id: oatiClientPath,
    filename: oatiClientPath,
    loaded: true,
    exports: {
      getAcademicServicePath(value) {
        return `svc/${value}`;
      },
      async requestOati(pathname) {
        calls.push(pathname);
        if (typeof requestImpl === 'function') {
          return requestImpl(pathname);
        }
        return {};
      },
    },
  };

  return {
    oatiName: require(modulePath),
    calls,
    restore() {
      if (originalOatiClient) {
        require.cache[oatiClientPath] = originalOatiClient;
      } else {
        delete require.cache[oatiClientPath];
      }

      delete require.cache[modulePath];
    },
  };
}

test('resolveOatiName returns empty for blank or zero identifiers', async () => {
  const loaded = loadOatiNameModule({ requestImpl: async () => ({}) });

  try {
    assert.equal(await loaded.oatiName.resolveOatiName(''), '');
    assert.equal(await loaded.oatiName.resolveOatiName('0'), '');
    assert.equal(loaded.calls.length, 0);
  } finally {
    loaded.restore();
  }
});

test('resolveOatiName prefers student name from active endpoint', async () => {
  const loaded = loadOatiNameModule({
    requestImpl: async (pathname) => {
      if (pathname.includes('datos_basicos_activos_cedula')) {
        return {
          datosEstudianteCollection: {
            datosBasicosEstudiante: [{ nombre: '  Estudiante Activo  ' }],
          },
        };
      }

      throw new Error('unexpected path');
    },
  });

  try {
    const name = await loaded.oatiName.resolveOatiName('1020');

    assert.equal(name, 'Estudiante Activo');
    assert.equal(loaded.calls.length, 1);
    assert.equal(loaded.calls[0], 'svc/datos_basicos_activos_cedula/1020');
  } finally {
    loaded.restore();
  }
});

test('resolveOatiName falls back to second student endpoint when first fails', async () => {
  const loaded = loadOatiNameModule({
    requestImpl: async (pathname) => {
      if (pathname.includes('datos_basicos_activos_cedula')) {
        throw new Error('timeout');
      }

      if (pathname.includes('datos_basicos_estudiante')) {
        return {
          datosBasicosEstudiante: {
            nombre: 'Estudiante Backup',
          },
        };
      }

      return {};
    },
  });

  try {
    const name = await loaded.oatiName.resolveOatiName('2040');

    assert.equal(name, 'Estudiante Backup');
    assert.equal(loaded.calls.length, 2);
  } finally {
    loaded.restore();
  }
});

test('resolveOatiName falls back to teacher lookup when student endpoints return empty', async () => {
  const loaded = loadOatiNameModule({
    requestImpl: async (pathname) => {
      if (pathname.includes('consultar_estado_docente')) {
        return {
          docentesCollection: {
            docente: [{ nombre: 'Docente OATI' }],
          },
        };
      }

      return { datosEstudianteCollection: { datosBasicosEstudiante: [] } };
    },
  });

  try {
    const name = await loaded.oatiName.resolveOatiName('3050');

    assert.equal(name, 'Docente OATI');
    assert.equal(
      loaded.calls.some((call) => call.includes('consultar_estado_docente/3050')),
      true
    );
  } finally {
    loaded.restore();
  }
});
