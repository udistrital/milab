const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const clientPath = path.resolve(__dirname, '../../../src/libs/edx-cert-client.js');
const validationPath = path.resolve(__dirname, '../../../src/libs/capacitacion-cert-validation.js');

function loadValidation(clientStub) {
  const originalClient = require.cache[clientPath];
  const originalValidation = require.cache[validationPath];
  delete require.cache[validationPath];
  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: clientStub,
  };

  return {
    validation: require(validationPath),
    restore() {
      delete require.cache[validationPath];
      if (originalClient) {
        require.cache[clientPath] = originalClient;
      } else {
        delete require.cache[clientPath];
      }
      if (originalValidation) {
        require.cache[validationPath] = originalValidation;
      }
    },
  };
}

function createPool({ cursos = [], certificaciones = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.includes('FROM equipo_especializado')) return { rows: cursos };
      if (sql.includes('FROM certificacion_usuario')) return { rows: certificaciones };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test('certification validation permits equipment without active associated courses', async () => {
  let externalCalls = 0;
  const loaded = loadValidation({
    USE_MOCK: true,
    consultarCurso: async () => {
      externalCalls += 1;
      return { completado: true };
    },
    consultarCursosUsuario: async () => {
      externalCalls += 1;
      return { cursos: [] };
    },
  });
  const pool = createPool();

  try {
    const result = await loaded.validation.validarCertificacionesParaReserva({
      pool,
      usuario: {},
      idEquipo: 12,
    });

    assert.equal(result.permitir, true);
    assert.deepEqual(result.cursos, []);
    assert.equal(externalCalls, 0);
    assert.equal(pool.queries.length, 1);
  } finally {
    loaded.restore();
  }
});

test('current local certificates and EDX completion jointly satisfy all equipment requirements', async () => {
  let batchCalls = 0;
  let individualCalls = 0;
  const loaded = loadValidation({
    USE_MOCK: false,
    consultarCursosUsuario: async (documento) => {
      batchCalls += 1;
      assert.equal(documento, '12345');
      return { cursos: [{ codigo_curso: 'EDX-2', completado: true }] };
    },
    consultarCurso: async () => {
      individualCalls += 1;
      return { completado: false };
    },
  });
  const pool = createPool({
    cursos: [
      { codigo_curso: 'LOCAL-1', nombre_curso: 'Curso local' },
      { codigo_curso: 'EDX-2', nombre_curso: 'Curso EDX' },
    ],
    certificaciones: [
      {
        codigo_curso: 'LOCAL-1',
        modalidad: 'presencial',
        fecha_vencimiento: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        sesion_id: 7,
      },
    ],
  });

  try {
    const result = await loaded.validation.validarCertificacionesParaReserva({
      pool,
      usuario: { documento: ' 12345 ' },
      idEquipo: 12,
    });

    assert.equal(result.permitir, true);
    assert.deepEqual(
      result.cursos_completados.map((curso) => [curso.codigo_curso, curso.origen_completado]),
      [
        ['LOCAL-1', 'local_milab'],
        ['EDX-2', 'edx'],
      ]
    );
    assert.equal(batchCalls, 1);
    assert.equal(individualCalls, 0);
    assert.equal(pool.queries[1].params[0], '12345');
    assert.match(pool.queries[1].sql, /fecha_vencimiento > CURRENT_TIMESTAMP/);
  } finally {
    loaded.restore();
  }
});

test('missing batch entries are checked individually and incomplete courses block the reservation', async () => {
  const individualCalls = [];
  const loaded = loadValidation({
    USE_MOCK: true,
    consultarCursosUsuario: async () => ({
      cursos: [{ codigo_curso: 'COURSE-1', completado: true }],
    }),
    consultarCurso: async (documento, codigoCurso) => {
      individualCalls.push([documento, codigoCurso]);
      return { completado: false };
    },
  });
  const pool = createPool({
    cursos: [
      { codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno' },
      { codigo_curso: 'COURSE-2', nombre_curso: 'Curso dos' },
    ],
  });

  try {
    await assert.rejects(
      loaded.validation.validarCertificacionesParaReserva({
        pool,
        usuario: { codigo_usuario: 'S-1' },
        idEquipo: 3,
      }),
      (error) => {
        assert.equal(error.bloqueoCert.tipo, 'pendientes');
        assert.deepEqual(
          error.bloqueoCert.cursos_pendientes.map((curso) => curso.codigo_curso),
          ['COURSE-2']
        );
        assert.match(error.bloqueoCert.mensaje, /Curso dos/);
        return true;
      }
    );

    assert.deepEqual(individualCalls, [['S-1', 'COURSE-2']]);
  } finally {
    loaded.restore();
  }
});

test('a batch omission falls back to the individual EDX result', async () => {
  const individualCalls = [];
  const loaded = loadValidation({
    USE_MOCK: false,
    consultarCursosUsuario: async () => ({ cursos: [] }),
    consultarCurso: async (documento, codigoCurso) => {
      individualCalls.push([documento, codigoCurso]);
      return { completado: true };
    },
  });
  const pool = createPool({
    cursos: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso uno' }],
  });

  try {
    const result = await loaded.validation.validarCertificacionesParaReserva({
      pool,
      usuario: { documento: 'student-1' },
      idEquipo: 3,
    });

    assert.equal(result.permitir, true);
    assert.deepEqual(
      result.cursos_completados.map(({ codigo_curso, origen_completado }) => [
        codigo_curso,
        origen_completado,
      ]),
      [['COURSE-1', 'edx']]
    );
    assert.deepEqual(individualCalls, [['student-1', 'COURSE-1']]);
  } finally {
    loaded.restore();
  }
});

test('an EDX outage fails closed and reports the technical failure', async () => {
  const loggedErrors = [];
  const loaded = loadValidation({
    USE_MOCK: false,
    consultarCursosUsuario: async () => {
      throw new Error('batch unavailable');
    },
    consultarCurso: async () => {
      throw new Error('individual unavailable');
    },
  });
  const pool = createPool({
    cursos: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso requerido' }],
  });

  try {
    await assert.rejects(
      loaded.validation.validarCertificacionesParaReserva({
        pool,
        usuario: { documento: '12345' },
        idEquipo: 3,
        onErrorTecnico: async (message) => loggedErrors.push(message),
      }),
      (error) => {
        assert.equal(error.bloqueoCert.tipo, 'error_tecnico');
        assert.equal(error.bloqueoCert.mock_en_uso, false);
        assert.match(error.bloqueoCert.mensaje, /bloquea por seguridad/);
        return true;
      }
    );

    assert.equal(loggedErrors.length, 2);
    assert.match(loggedErrors[0], /Error EDX consultando curso=COURSE-1/);
    assert.match(loggedErrors[1], /Error servicio EDX/);
  } finally {
    loaded.restore();
  }
});

test('a required-course check without a user document is blocked and logged', async () => {
  const loggedErrors = [];
  const loaded = loadValidation({
    USE_MOCK: true,
    consultarCurso: async () => ({ completado: true }),
    consultarCursosUsuario: async () => ({ cursos: [] }),
  });
  const pool = createPool({
    cursos: [{ codigo_curso: 'COURSE-1', nombre_curso: 'Curso requerido' }],
  });

  try {
    await assert.rejects(
      loaded.validation.validarCertificacionesParaReserva({
        pool,
        usuario: { id: 11 },
        idEquipo: 3,
        onErrorTecnico: async (message) => loggedErrors.push(message),
      }),
      (error) => {
        assert.equal(error.bloqueoCert.tipo, 'error_tecnico');
        assert.deepEqual(error.bloqueoCert.causas, ['usuario_sin_documento']);
        return true;
      }
    );
    assert.equal(pool.queries.length, 1);
    assert.match(loggedErrors[0], /usuario sin documento/);
  } finally {
    loaded.restore();
  }
});
