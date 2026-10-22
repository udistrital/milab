const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { PDFDocument } = require('pdf-lib');
const request = require('supertest');

const root = path.resolve(__dirname, '../../..');
const routePath = path.join(root, 'src/routes/api/encuentros.js');
const poolPath = path.join(root, 'src/libs/db.js');

function buildTestApp(query, { interceptPageRender = false } = {}) {
  const originalPool = require.cache[poolPath];
  delete require.cache[routePath];
  const pool = {
    query,
    async connect() {
      return { query, release() {} };
    },
  };
  require.cache[poolPath] = {
    id: poolPath,
    filename: poolPath,
    loaded: true,
    exports: pool,
  };
  const router = require(routePath);
  const app = express();
  app.set('views', path.join(root, 'src/views'));
  app.set('view engine', 'ejs');
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.csrfToken = 'test-csrf-token';
    res.locals.cspNonce = 'test-nonce';
    next();
  });
  app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    req.session = role
      ? { user: { id: 12, documento: '12345', nombre: 'Operador', roles: [role], tipo: role } }
      : {};
    next();
  });
  if (interceptPageRender) {
    app.use((req, res, next) => {
      const render = res.render.bind(res);
      res.render = (view, options, callback) => {
        if (view === 'home/encuentros-gestion') {
          return res.json({ view, ...options });
        }
        return render(view, options, callback);
      };
      next();
    });
  }
  app.use('/encuentros', router);
  return {
    app,
    restore() {
      delete require.cache[routePath];
      if (originalPool) require.cache[poolPath] = originalPool;
      else delete require.cache[poolPath];
    },
  };
}

function publicQrQuery({
  evento = null,
  participante = null,
  asistencia = null,
  insertRow = null,
} = {}) {
  return async (sql) => {
    if (sql.includes('FROM encuentro_evento WHERE id')) return { rows: evento ? [evento] : [] };
    if (sql.includes('FROM encuentro_participante p'))
      return { rows: participante ? [participante] : [] };
    if (sql.includes('INSERT INTO encuentro_asistencia'))
      return { rows: insertRow ? [insertRow] : [] };
    if (sql.includes('FROM encuentro_asistencia') && sql.includes('FOR UPDATE')) {
      return { rows: asistencia ? [asistencia] : [] };
    }
    return { rows: [] };
  };
}

const evento_en_curso = {
  id: 7,
  nombre: 'Encuentro de prueba',
  fecha: '2026-10-20',
  lugar: 'Sede',
  estado: 'en_curso',
};

test('public QR registration page renders the document-only form while the event is in progress', async () => {
  const setup = buildTestApp(publicQrQuery({ evento: evento_en_curso }));
  try {
    const response = await request(setup.app).get('/encuentros/registro/ingreso/7');
    assert.equal(response.status, 200);
    assert.match(response.text, /id="registro-form"/);
    assert.match(response.text, /name="documento"/);
    assert.match(response.text, /name="csrf-token" content="test-csrf-token"/);
    assert.doesNotMatch(response.text, /name="nombre"|name="correo"/);
  } finally {
    setup.restore();
  }
});

test('public QR registration page blocks registration when the event is not in progress', async () => {
  const setup = buildTestApp(
    publicQrQuery({ evento: { ...evento_en_curso, estado: 'programado' } })
  );
  try {
    const response = await request(setup.app).get('/encuentros/registro/salida/7');
    assert.equal(response.status, 200);
    assert.match(response.text, /no se encuentra en curso/);
    assert.doesNotMatch(response.text, /id="registro-form"/);
  } finally {
    setup.restore();
  }
});

test('public QR links reject unknown types and unknown events', async () => {
  const setup = buildTestApp(publicQrQuery({ evento: null }));
  try {
    const invalidType = await request(setup.app).get('/encuentros/registro/otro/7');
    assert.equal(invalidType.status, 404);
    const unknownEvent = await request(setup.app).get('/encuentros/registro/ingreso/999');
    assert.equal(unknownEvent.status, 404);
    assert.match(unknownEvent.text, /Enlace no válido/);
  } finally {
    setup.restore();
  }
});

test('public QR registration reports documents that are not enrolled in the event', async () => {
  const setup = buildTestApp(publicQrQuery({ participante: null }));
  try {
    const response = await request(setup.app)
      .post('/encuentros/registro/ingreso/7')
      .send({ documento: '1020304050' });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.status, 'not_enrolled');
    assert.match(response.body.message, /1020304050 no fue encontrado/);
    assert.match(response.body.message, /acérquese con los organizadores/);
  } finally {
    setup.restore();
  }
});

test('public QR ingreso registers attendance and answers with the uppercase name', async () => {
  const setup = buildTestApp(
    publicQrQuery({
      participante: { id: 21, nombre: 'Ana Pérez', estado_evento: 'en_curso' },
      insertRow: { entrada_en: new Date().toISOString() },
    })
  );
  try {
    const response = await request(setup.app)
      .post('/encuentros/registro/ingreso/7')
      .send({ documento: '1020304050' });
    assert.equal(response.body.ok, true);
    assert.equal(response.body.status, 'registered');
    assert.equal(response.body.message, 'ANA PÉREZ, su registro de ingreso fue exitoso.');
  } finally {
    setup.restore();
  }
});

test('public QR salida is rejected when the attendee has no ingreso yet', async () => {
  const setup = buildTestApp(
    publicQrQuery({
      participante: { id: 21, nombre: 'Ana Pérez', estado_evento: 'en_curso' },
      asistencia: null,
    })
  );
  try {
    const response = await request(setup.app)
      .post('/encuentros/registro/salida/7')
      .send({ documento: '1020304050' });
    assert.equal(response.body.ok, false);
    assert.equal(response.body.status, 'no_entry');
  } finally {
    setup.restore();
  }
});

test('public QR registration validates the document before querying', async () => {
  let queries = 0;
  const setup = buildTestApp(async () => {
    queries += 1;
    return { rows: [] };
  });
  try {
    const response = await request(setup.app)
      .post('/encuentros/registro/ingreso/7')
      .send({ documento: '' });
    assert.equal(response.status, 400);
    assert.equal(queries, 0);
  } finally {
    setup.restore();
  }
});

test('public QR projection renders a centered QR image for the registration link', async () => {
  const setup = buildTestApp(publicQrQuery({ evento: evento_en_curso }));
  try {
    const response = await request(setup.app).get('/encuentros/proyeccion/ingreso/7');
    assert.equal(response.status, 200);
    assert.match(response.text, /src="data:image\/png;base64,/);
    assert.match(response.text, /Escanea el código con tu celular/);
  } finally {
    setup.restore();
  }
});

test('pending certificates endpoint lists attendees with attendance but no sent certificate', async () => {
  const setup = buildTestApp(async (sql) => {
    if (sql.includes("c.email_estado <> 'enviado'") || sql.includes("email_estado <> 'enviado'")) {
      return {
        rows: [
          {
            participante_id: 21,
            nombre: 'Ana Pérez',
            correo: 'ana@example.com',
            certificado_id: null,
            email_estado: null,
          },
        ],
      };
    }
    return { rows: [] };
  });
  try {
    const response = await request(setup.app)
      .get('/encuentros/api/eventos/7/certificados/pendientes')
      .set('x-test-role', 'gestor_laboratorio');
    assert.equal(response.status, 200);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.participantes[0].participante_id, 21);

    const student = await request(setup.app)
      .get('/encuentros/api/eventos/7/certificados/pendientes')
      .set('x-test-role', 'estudiante');
    assert.equal(student.status, 403);
  } finally {
    setup.restore();
  }
});

test('Encuentros management endpoints reject unauthenticated and unauthorized users', async () => {
  let queries = 0;
  const setup = buildTestApp(async () => {
    queries += 1;
    return { rows: [] };
  });

  try {
    const unauthenticated = await request(setup.app).get('/encuentros/api/eventos');
    assert.equal(unauthenticated.status, 401);
    const student = await request(setup.app)
      .get('/encuentros/api/eventos')
      .set('x-test-role', 'estudiante');
    assert.equal(student.status, 403);
    assert.equal(queries, 0);
  } finally {
    setup.restore();
  }
});

test('Gestor de laboratorio can open encounter management without certificate annulment access', async () => {
  const setup = buildTestApp(async () => ({ rows: [] }), { interceptPageRender: true });

  try {
    const response = await request(setup.app)
      .get('/encuentros/gestion')
      .set('x-test-role', 'gestor_laboratorio');

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/encuentros-gestion');
    assert.equal(response.body.canAnnulCertificates, false);
  } finally {
    setup.restore();
  }
});

test('Gestor de laboratorio can list events globally with database-backed pagination', async () => {
  let listQuery;
  const setup = buildTestApp(async (sql) => {
    if (sql.includes('COUNT(*)::int AS total')) return { rows: [{ total: 1 }] };
    listQuery = sql;
    return {
      rows: [
        {
          id: 3,
          nombre: 'Encuentro de prueba',
          fecha: '2026-10-20',
          hora_inicio: '09:00',
          hora_fin: '10:00',
          lugar: 'Sede',
          organizador: 'MiLab',
          estado: 'programado',
          participantes: 0,
        },
      ],
    };
  });

  try {
    const response = await request(setup.app)
      .get('/encuentros/api/eventos')
      .set('x-test-role', 'gestor_laboratorio');
    assert.equal(response.status, 200);
    assert.equal(response.body.eventos[0].nombre, 'Encuentro de prueba');
    assert.equal(response.body.paginacion.total, 1);
    assert.doesNotMatch(listQuery, /ual_id|laboratorio/i);
  } finally {
    setup.restore();
  }
});

test('event list returns technical diagnostics only to administrators', async () => {
  const setup = buildTestApp(async () => {
    const error = new Error('Database operation failed');
    error.code = 'XX000';
    throw error;
  });

  try {
    const adminResponse = await request(setup.app)
      .get('/encuentros/api/eventos')
      .set('x-test-role', 'admin');
    assert.equal(adminResponse.status, 500);
    assert.match(adminResponse.body.adminErrorDetail, /Database operation failed/);

    const managerResponse = await request(setup.app)
      .get('/encuentros/api/eventos')
      .set('x-test-role', 'gestor_laboratorio');
    assert.equal(managerResponse.status, 500);
    assert.equal(managerResponse.body.adminErrorDetail, undefined);
  } finally {
    setup.restore();
  }
});

test('Gestor de laboratorio cannot correct attendance or annul certificates', async () => {
  let queries = 0;
  const setup = buildTestApp(async () => {
    queries += 1;
    return { rows: [] };
  });

  try {
    const attendance = await request(setup.app)
      .patch('/encuentros/api/eventos/14/asistencia/12345/corregir')
      .set('x-test-role', 'gestor_laboratorio')
      .send({
        motivo: 'Corrección de prueba',
        entrada_en: null,
        salida_en: null,
      });
    const certificate = await request(setup.app)
      .patch('/encuentros/api/certificados/7/anular')
      .set('x-test-role', 'gestor_laboratorio')
      .send({ motivo: 'Anulación de prueba' });

    assert.equal(attendance.status, 403);
    assert.equal(certificate.status, 403);
    assert.equal(queries, 0);
  } finally {
    setup.restore();
  }
});

test('authorized manager can revise a started event certificate template without changing issued certificates', async () => {
  const statements = [];
  let eventState = 'en_curso';
  const setup = buildTestApp(async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('SELECT id, estado FROM encuentro_evento')) {
      return { rows: [{ id: 14, estado: eventState }] };
    }
    return { rows: [] };
  });

  try {
    const response = await request(setup.app)
      .patch('/encuentros/api/eventos/14/plantilla')
      .set('x-test-role', 'admin')
      .field(
        'plantilla_config',
        JSON.stringify({
          nombre: { x: 120, y: 80, fontSize: 18, align: 'center' },
          qr_verificacion: { type: 'qr', x: 24, y: 24, width: 70 },
        })
      );

    assert.equal(response.status, 200);
    assert.match(response.body.message, /certificados emitidos no cambian/i);
    const update = statements.find(({ sql }) => sql.includes('UPDATE encuentro_evento'));
    assert.ok(update);
    assert.match(update.sql, /plantilla_config = \$4::jsonb/);
    assert.match(update.sql, /plantilla_pdf_path = COALESCE\(\$2, plantilla_pdf_path\)/);
    assert.equal(update.values[1], null);
    assert.deepEqual(JSON.parse(update.values[3]), {
      nombre: { x: 120, y: 80, fontSize: 18, align: 'center' },
      qr_verificacion: { type: 'qr', x: 24, y: 24, width: 70 },
    });
    assert.ok(statements.some(({ sql }) => sql.includes('INSERT INTO log')));
    assert.equal(
      statements.some(({ sql }) => /encuentro_certificado|archivo_actual/.test(sql)),
      false
    );

    eventState = 'programado';
    const beforeRejectedUpdateCount = statements.filter(({ sql }) =>
      sql.includes('UPDATE encuentro_evento')
    ).length;
    const notStarted = await request(setup.app)
      .patch('/encuentros/api/eventos/14/plantilla')
      .set('x-test-role', 'admin')
      .field(
        'plantilla_config',
        JSON.stringify({
          qr_verificacion: { type: 'qr', x: 24, y: 24, width: 70 },
        })
      );
    assert.equal(notStarted.status, 409);
    assert.equal(
      statements.filter(({ sql }) => sql.includes('UPDATE encuentro_evento')).length,
      beforeRejectedUpdateCount
    );
  } finally {
    setup.restore();
  }
});

test('certificate template editing remains manager-only', async () => {
  let queries = 0;
  const setup = buildTestApp(async () => {
    queries += 1;
    return { rows: [] };
  });

  try {
    const unauthenticated = await request(setup.app).patch('/encuentros/api/eventos/14/plantilla');
    const student = await request(setup.app)
      .patch('/encuentros/api/eventos/14/plantilla')
      .set('x-test-role', 'estudiante');

    assert.equal(unauthenticated.status, 401);
    assert.equal(student.status, 403);
    assert.equal(queries, 0);
  } finally {
    setup.restore();
  }
});

test('authorized manager can replace the certificate PDF after an event is finalized', async () => {
  const storageRoot = path.join(root, 'private', `encuentros-test-${process.pid}`);
  const storageParent = path.dirname(storageRoot);
  const previousStorageRoot = process.env.ENCUENTROS_STORAGE_DIR;
  let storageParentExisted = true;
  try {
    await fs.access(storageParent);
  } catch {
    storageParentExisted = false;
  }
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 200]);
  const pdfBuffer = Buffer.from(await pdf.save());
  let updateValues;
  let setup;
  process.env.ENCUENTROS_STORAGE_DIR = storageRoot;

  try {
    setup = buildTestApp(async (sql, values) => {
      if (sql.includes('SELECT id, estado FROM encuentro_evento')) {
        return { rows: [{ id: 14, estado: 'finalizado' }] };
      }
      if (sql.includes('UPDATE encuentro_evento')) updateValues = values;
      return { rows: [] };
    });

    const response = await request(setup.app)
      .patch('/encuentros/api/eventos/14/plantilla')
      .set('x-test-role', 'admin')
      .field(
        'plantilla_config',
        JSON.stringify({
          qr_verificacion: { type: 'qr', x: 24, y: 24, width: 70 },
        })
      )
      .attach('plantilla_pdf', pdfBuffer, {
        filename: 'plantilla-actualizada.pdf',
        contentType: 'application/pdf',
      });

    assert.equal(response.status, 200);
    assert.ok(updateValues[1].startsWith('templates/'));
    assert.equal(updateValues[2], 'plantilla-actualizada.pdf');
    assert.equal((await fs.stat(path.join(storageRoot, updateValues[1]))).size, pdfBuffer.length);
  } finally {
    setup?.restore();
    if (previousStorageRoot === undefined) delete process.env.ENCUENTROS_STORAGE_DIR;
    else process.env.ENCUENTROS_STORAGE_DIR = previousStorageRoot;
    await fs.rm(storageRoot, { recursive: true, force: true });
    if (!storageParentExisted) {
      try {
        await fs.rmdir(storageParent);
      } catch (error) {
        if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) {
          process.emitWarning(`No se pudo limpiar el almacenamiento de prueba: ${error.message}`);
        }
      }
    }
  }
});

test('event detail returns database-backed statistics for the visual summary', async () => {
  const setup = buildTestApp(async (sql) => {
    if (sql.includes('COUNT(DISTINCT p.id)')) {
      return {
        rows: [
          {
            id: 14,
            nombre: 'Encuentro de prueba',
            estado: 'en_curso',
            total_participantes: 4,
            entradas: 3,
            salidas: 2,
            sin_entrada: 1,
            dentro_sin_salida: 1,
            certificados_generados: 2,
            certificados_enviados: 1,
            certificados_pendientes: 0,
            certificados_con_error: 1,
          },
        ],
      };
    }
    return { rows: [] };
  });

  try {
    const response = await request(setup.app)
      .get('/encuentros/api/eventos/14')
      .set('x-test-role', 'admin');

    assert.equal(response.status, 200);
    assert.equal(response.body.estadisticas.total_participantes, 4);
    assert.equal(response.body.estadisticas.entradas, 3);
    assert.equal(response.body.estadisticas.salidas, 2);
    assert.equal(response.body.estadisticas.porcentaje_asistencia, 75);
    assert.equal(response.body.estadisticas.porcentaje_completado, 50);
    assert.equal(response.body.estadisticas.certificados_enviados, 1);
    assert.equal(response.body.estadisticas.certificados_con_error, 1);
  } finally {
    setup.restore();
  }
});

test('finalized encounter report downloads an aggregate PDF grouped by faculty', async () => {
  const statements = [];
  const setup = buildTestApp(async (sql, values) => {
    statements.push({ sql, values });
    if (sql.includes('FROM encuentro_evento e')) {
      return {
        rows: [
          {
            id: 14,
            nombre: 'Encuentro de prueba',
            fecha: '2026-10-20',
            hora_inicio: '09:00',
            hora_fin: '10:00',
            lugar: 'Sede',
            organizador: 'MiLab',
            estado: 'finalizado',
            total_participantes: 4,
            entradas: 3,
            salidas: 2,
            sin_entrada: 1,
            dentro_sin_salida: 1,
            certificados_generados: 2,
            certificados_enviados: 1,
            certificados_pendientes: 0,
            certificados_con_error: 1,
          },
        ],
      };
    }
    if (sql.includes('FROM encuentro_participante p')) {
      return {
        rows: [
          {
            facultad: 'Facultad con menor participación',
            registrados: 1,
            con_entrada: 1,
            completaron: 1,
          },
          {
            facultad: 'Facultad con mayor participación',
            registrados: 3,
            con_entrada: 2,
            completaron: 1,
          },
        ],
      };
    }
    return { rows: [] };
  });

  try {
    const response = await request(setup.app)
      .get('/encuentros/api/eventos/14/informe.pdf')
      .set('x-test-role', 'gestor_laboratorio');

    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /application\/pdf/);
    assert.match(response.headers['content-disposition'], /informe-encuentro-14\.pdf/);
    assert.ok(Buffer.isBuffer(response.body));
    assert.equal(response.body.subarray(0, 5).toString(), '%PDF-');
    assert.equal(statements.length, 2);
    assert.match(statements[1].sql, /ORDER BY registrados ASC, facultad ASC/);

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(response.body),
      verbosity: 0,
    }).promise;
    try {
      let reportText = '';
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        reportText += ` ${content.items.map((item) => item.str).join(' ')}`;
      }
      assert.match(reportText, /Informe del encuentro/);
      assert.match(reportText, /Registrados activos/);
      assert.match(reportText, /Participación por facultad/);
      assert.ok(
        reportText.indexOf('Facultad con menor participación') <
          reportText.indexOf('Facultad con mayor participación')
      );
    } finally {
      await pdf.destroy();
    }
  } finally {
    setup.restore();
  }
});

test('encounter report is unavailable before the event is finalized', async () => {
  let queries = 0;
  const setup = buildTestApp(async (sql) => {
    queries += 1;
    if (sql.includes('FROM encuentro_evento e')) {
      return { rows: [{ id: 14, estado: 'en_curso' }] };
    }
    return { rows: [] };
  });

  try {
    const response = await request(setup.app)
      .get('/encuentros/api/eventos/14/informe.pdf')
      .set('x-test-role', 'gestor_laboratorio');

    assert.equal(response.status, 409);
    assert.match(response.body.message, /cuando el encuentro haya finalizado/i);
    assert.equal(queries, 1);
  } finally {
    setup.restore();
  }
});

test('public certificate verification exposes only required certificate data', async () => {
  let queryCount = 0;
  const setup = buildTestApp(async () => {
    queryCount += 1;
    return {
      rows: [
        {
          codigo: 'CERTIFICADO-123',
          estado: 'valido',
          fecha_emision: '2026-10-20T10:00:00.000Z',
          evento: 'Encuentro institucional',
          fecha_evento: '2026-10-20',
          participante: 'Participante de prueba',
        },
      ],
    };
  });

  try {
    const response = await request(setup.app).get(`/encuentros/verificar/${'a'.repeat(64)}`);
    assert.equal(response.status, 200);
    assert.match(response.text, /Encuentro institucional/);
    assert.match(response.text, /Participante de prueba/);
    assert.doesNotMatch(response.text, /documento|correo/i);
    assert.equal(queryCount, 1);

    const invalid = await request(setup.app).get('/encuentros/verificar/not-a-token');
    assert.equal(invalid.status, 200);
    assert.match(invalid.text, /no existe o no es válido/);
    assert.equal(queryCount, 1);
  } finally {
    setup.restore();
  }
});

test('personal achievements are scoped to the authenticated MiLab user', async () => {
  let queryValues;
  const setup = buildTestApp(async (sql, values) => {
    assert.match(sql, /WHERE l\.usuario_id = \$1/);
    queryValues = values;
    return {
      rows: [{ id: 4, evento: 'Encuentro institucional', codigo_certificado: 'CERT-123' }],
    };
  });

  try {
    const response = await request(setup.app)
      .get('/encuentros/api/mis-logros')
      .set('x-test-role', 'estudiante');
    assert.equal(response.status, 200);
    assert.equal(response.body.logros[0].codigo_certificado, 'CERT-123');
    assert.deepEqual(queryValues, [12]);
  } finally {
    setup.restore();
  }
});
