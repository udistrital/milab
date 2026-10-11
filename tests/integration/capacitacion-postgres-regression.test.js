const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const databaseUrl = process.env.MILAB_CAPACITACION_TEST_DATABASE_URL;
const {
  buildManagementApp,
  createPostgresFixture,
} = require('./helpers/capacitacion-postgres-fixture');
const {
  getCertificacionesLocalesVigentes,
  getCursosActivosDeEquipo,
} = require('../../src/libs/capacitacion-cert-validation');

test(
  'PostgreSQL prevents concurrent enrollment overbooking and enforces active-record uniqueness',
  {
    skip: databaseUrl
      ? false
      : 'Set MILAB_CAPACITACION_TEST_DATABASE_URL to run PostgreSQL regressions',
  },
  async () => {
    const fixture = await createPostgresFixture();
    const appOne = buildManagementApp(fixture.db, { id: 55, documento: 'student-1' });
    const appTwo = buildManagementApp(fixture.db, { id: 56, documento: 'student-2' });

    try {
      const triggerClient = await fixture.db.connect();
      try {
        await triggerClient.query(`
          CREATE FUNCTION pause_capacitacion_enrollment()
          RETURNS TRIGGER
          LANGUAGE plpgsql
          AS $$
          BEGIN
            PERFORM pg_sleep(0.4);
            RETURN NEW;
          END;
          $$;
          CREATE TRIGGER trg_pause_capacitacion_enrollment
          BEFORE INSERT ON inscripcion_sesion_capacitacion
          FOR EACH ROW EXECUTE FUNCTION pause_capacitacion_enrollment();
        `);
      } finally {
        triggerClient.release();
      }

      const enrollments = await Promise.all([
        request(appOne.app).post('/inscribirme/1').send({}),
        request(appTwo.app).post('/inscribirme/1').send({}),
      ]);

      assert.deepEqual(
        enrollments.map((response) => response.status),
        [201, 201]
      );
      assert.deepEqual(enrollments.map((response) => response.body.inscripcion.estado).sort(), [
        'cupo_excedido',
        'inscrito',
      ]);

      const removeDelay = await fixture.db.connect();
      try {
        await removeDelay.query(
          'DROP TRIGGER trg_pause_capacitacion_enrollment ON inscripcion_sesion_capacitacion'
        );
        await removeDelay.query('DROP FUNCTION pause_capacitacion_enrollment()');
      } finally {
        removeDelay.release();
      }

      const activeEnrollments = await fixture.db.query(
        `SELECT estado, COUNT(*)::int AS total
           FROM inscripcion_sesion_capacitacion
          WHERE activo = TRUE
          GROUP BY estado`
      );
      assert.deepEqual(
        activeEnrollments.rows
          .map((row) => [row.estado, row.total])
          .sort(([stateA], [stateB]) => stateA.localeCompare(stateB)),
        [
          ['cupo_excedido', 1],
          ['inscrito', 1],
        ]
      );

      await assert.rejects(
        fixture.db.query(
          `INSERT INTO inscripcion_sesion_capacitacion
             (sesion_capacitacion_id, usuario_documento, usuario_id, estado)
           VALUES (1, 'student-1', 55, 'inscrito')`
        ),
        (error) => error.code === '23505'
      );

      await fixture.db.query(
        `INSERT INTO asistencia_capacitacion
           (sesion_capacitacion_id, usuario_documento, asistio, metodo)
         VALUES (1, 'student-1', TRUE, 'manual')`
      );
      await assert.rejects(
        fixture.db.query(
          `INSERT INTO asistencia_capacitacion
             (sesion_capacitacion_id, usuario_documento, asistio, metodo)
           VALUES (1, 'student-1', TRUE, 'manual')`
        ),
        (error) => error.code === '23505'
      );

      const certificateFields = `
        (codigo_curso, facultad_id, usuario_documento, usuario_id, modalidad,
         fecha_vencimiento, vigencia_meses, certificado_por_laboratorista_doc)
        VALUES ('COURSE-1', 1, 'student-1', 55, 'programada',
                CURRENT_TIMESTAMP + INTERVAL '1 year', 12, 'lab-1')`;
      await fixture.db.query(`INSERT INTO certificacion_usuario ${certificateFields}`);
      await assert.rejects(
        fixture.db.query(`INSERT INTO certificacion_usuario ${certificateFields}`),
        (error) => error.code === '23505'
      );
      await assert.rejects(
        fixture.db.query(
          `INSERT INTO certificacion_usuario
             (codigo_curso, facultad_id, usuario_documento, usuario_id, modalidad,
              fecha_vencimiento, vigencia_meses, certificado_por_laboratorista_doc)
           VALUES ('COURSE-1', 1, 'student-2', 56, 'programada',
                   CURRENT_TIMESTAMP + INTERVAL '1 year', 0, 'lab-1')`
        ),
        (error) => error.code === '23514'
      );
    } finally {
      appTwo.restore();
      appOne.restore();
      await fixture.cleanup();
    }
  }
);

test(
  'PostgreSQL regressions cover sanctions, enrollment lifecycle and management scope',
  {
    skip: databaseUrl
      ? false
      : 'Set MILAB_CAPACITACION_TEST_DATABASE_URL to run PostgreSQL regressions',
  },
  async () => {
    const fixture = await createPostgresFixture();
    const student = buildManagementApp(fixture.db, {
      id: 55,
      documento: 'student-1',
    });
    const laboratorista = buildManagementApp(
      fixture.db,
      {
        id: 60,
        documento: 'lab-1',
        tipo: 'laboratorista',
        roles: ['laboratorista'],
      },
      {
        scope: { isAdmin: false, ualIds: [11], facultyIds: [1] },
      }
    );

    try {
      const sanctionCases = [
        { userId: 55, estado: 'ACTIVA', activo: true, expected: 403 },
        { userId: 56, estado: 'PENDIENTE', activo: true, expected: 403 },
        { userId: 57, estado: 'POR SALDAR', activo: true, expected: 403 },
        { userId: 58, estado: 'CERRADA', activo: true, expected: 201 },
        { userId: 59, estado: 'ACTIVA', activo: false, expected: 201 },
      ];

      for (const sanctionCase of sanctionCases) {
        await fixture.db.query(
          'INSERT INTO multa (usuario_sancionado_id, activo, con_estado_multa) VALUES ($1, $2, $3)',
          [sanctionCase.userId, sanctionCase.activo, sanctionCase.estado]
        );
        const userApp = buildManagementApp(fixture.db, {
          id: sanctionCase.userId,
          documento: `student-${sanctionCase.userId - 54}`,
        });

        try {
          const response = await request(userApp.app)
            .post('/solicitar')
            .send({ codigo_curso: 'COURSE-1' });
          assert.equal(response.status, sanctionCase.expected);
          if (sanctionCase.expected === 403) {
            assert.match(response.body.message, /sanciones activas/i);
          } else {
            await fixture.db.query('DELETE FROM solicitud_capacitacion WHERE id = $1', [
              response.body.solicitud.id,
            ]);
          }
        } finally {
          userApp.restore();
          await fixture.db.query('DELETE FROM multa WHERE usuario_sancionado_id = $1', [
            sanctionCase.userId,
          ]);
        }
      }

      await fixture.db.query(
        `INSERT INTO multa (usuario_sancionado_id, activo, con_estado_multa)
         VALUES (55, TRUE, 'ACTIVA')`
      );
      const sanctionedEnrollment = await request(student.app).post('/inscribirme/1').send({});
      assert.equal(sanctionedEnrollment.status, 403);
      await fixture.db.query('DELETE FROM multa WHERE usuario_sancionado_id = 55');

      const cancelledSessionId = await fixture.addSession({ estado: 'cancelada' });
      const pastSessionId = await fixture.addSession({
        fechaInicio: new Date(Date.now() - 48 * 60 * 60 * 1000),
        fechaFin: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      const cancelledResponse = await request(student.app)
        .post(`/inscribirme/${cancelledSessionId}`)
        .send({});
      const pastResponse = await request(student.app)
        .post(`/inscribirme/${pastSessionId}`)
        .send({});
      assert.equal(cancelledResponse.status, 400);
      assert.match(cancelledResponse.body.message, /no admite inscripciones/i);
      assert.equal(pastResponse.status, 400);
      assert.match(pastResponse.body.message, /ya finalizó/i);

      const duplicateSessionId = await fixture.addSession({ cupo: 2 });
      const duplicateResponses = await Promise.all([
        request(student.app).post(`/inscribirme/${duplicateSessionId}`).send({}),
        request(student.app).post(`/inscribirme/${duplicateSessionId}`).send({}),
      ]);
      assert.deepEqual(duplicateResponses.map((response) => response.status).sort(), [201, 409]);
      const duplicateCount = await fixture.db.query(
        `SELECT COUNT(*)::int AS total
           FROM inscripcion_sesion_capacitacion
          WHERE sesion_capacitacion_id = $1
            AND usuario_documento = 'student-1'
            AND estado = 'inscrito'`,
        [duplicateSessionId]
      );
      assert.equal(duplicateCount.rows[0].total, 1);

      const reactivationSessionId = await fixture.addSession();
      await fixture.db.query(
        `INSERT INTO inscripcion_sesion_capacitacion
           (sesion_capacitacion_id, usuario_documento, usuario_id, usuario_nombre, estado)
         VALUES ($1, 'student-1', 55, 'Estudiante', 'cancelado')`,
        [reactivationSessionId]
      );
      const reactivationResponse = await request(student.app)
        .post(`/inscribirme/${reactivationSessionId}`)
        .send({});
      assert.equal(reactivationResponse.status, 201);
      assert.equal(reactivationResponse.body.inscripcion.estado, 'inscrito');
      const reactivated = await fixture.db.query(
        `SELECT COUNT(*)::int AS total
           FROM inscripcion_sesion_capacitacion
          WHERE sesion_capacitacion_id = $1
            AND usuario_documento = 'student-1'
            AND estado = 'inscrito'`,
        [reactivationSessionId]
      );
      assert.equal(reactivated.rows[0].total, 1);

      const outsideSessionId = await fixture.addSession({
        codigoCurso: 'COURSE-2',
        ualId: 12,
        facultadId: 2,
      });
      const sessionList = await request(laboratorista.app).get('/gestion/sesiones');
      assert.equal(sessionList.status, 200);
      assert.ok(sessionList.body.sesiones.length > 0);
      assert.ok(sessionList.body.sesiones.every((session) => session.ual_id === 11));
      assert.equal(
        sessionList.body.sesiones.some((session) => session.id === outsideSessionId),
        false
      );

      const outsideStateChange = await request(laboratorista.app)
        .post(`/gestion/sesiones/${outsideSessionId}/cambiar-estado`)
        .send({ estado: 'cancelada' });
      assert.equal(outsideStateChange.status, 404);
      const outsideState = await fixture.db.query(
        'SELECT estado FROM sesion_capacitacion WHERE id = $1',
        [outsideSessionId]
      );
      assert.equal(outsideState.rows[0].estado, 'programada');

      const inScopeStateChange = await request(laboratorista.app)
        .post('/gestion/sesiones/1/cambiar-estado')
        .send({ estado: 'cancelada' });
      assert.equal(inScopeStateChange.status, 200);
      assert.equal(inScopeStateChange.body.sesion.estado, 'cancelada');
    } finally {
      laboratorista.restore();
      student.restore();
      await fixture.cleanup();
    }
  }
);

test(
  'PostgreSQL preserves attendance and renews certificates only for eligible attendees',
  {
    skip: databaseUrl
      ? false
      : 'Set MILAB_CAPACITACION_TEST_DATABASE_URL to run PostgreSQL regressions',
  },
  async () => {
    const fixture = await createPostgresFixture();
    const administrator = buildManagementApp(fixture.db, {
      id: 60,
      documento: 'admin-1',
      tipo: 'admin',
      roles: ['admin'],
    });
    const student = buildManagementApp(fixture.db, {
      id: 55,
      documento: 'student-1',
    });

    try {
      await fixture.db.query(
        `INSERT INTO inscripcion_sesion_capacitacion
           (sesion_capacitacion_id, usuario_documento, usuario_id, usuario_nombre, estado)
         VALUES
           (1, 'student-1', 55, 'Estudiante uno', 'inscrito'),
           (1, 'student-2', 56, 'Estudiante dos', 'inscrito')`
      );
      await fixture.db.query(
        `UPDATE sesion_capacitacion
            SET estado = 'realizada',
                fecha_inicio = CURRENT_TIMESTAMP - INTERVAL '3 hours',
                fecha_fin = CURRENT_TIMESTAMP - INTERVAL '2 hours'
          WHERE id = 1`
      );

      const attendeeMarked = await request(administrator.app)
        .post('/gestion/asistencia/marcar')
        .send({ sesion_id: 1, usuario_documento: 'student-1', asistio: true, metodo: 'manual' });
      const absentMarked = await request(administrator.app)
        .post('/gestion/asistencia/marcar')
        .send({ sesion_id: 1, usuario_documento: 'student-2', asistio: false, metodo: 'manual' });
      const attendanceUpdated = await request(administrator.app)
        .post('/gestion/asistencia/marcar')
        .send({ sesion_id: 1, usuario_documento: 'student-1', asistio: false, metodo: 'manual' });
      await request(administrator.app)
        .post('/gestion/asistencia/marcar')
        .send({ sesion_id: 1, usuario_documento: 'student-1', asistio: true, metodo: 'manual' });

      assert.equal(attendeeMarked.status, 200);
      assert.equal(absentMarked.status, 200);
      assert.equal(attendanceUpdated.status, 200);
      assert.equal(attendanceUpdated.body.asistencia.id, attendeeMarked.body.asistencia.id);
      const attendanceRows = await fixture.db.query(
        `SELECT usuario_documento, asistio, COUNT(*) OVER ()::int AS total
           FROM asistencia_capacitacion
          WHERE sesion_capacitacion_id = 1
          ORDER BY usuario_documento`
      );
      assert.equal(attendanceRows.rows.length, 2);
      assert.deepEqual(
        attendanceRows.rows.map((row) => [row.usuario_documento, row.asistio]),
        [
          ['student-1', true],
          ['student-2', false],
        ]
      );

      const firstIssue = await request(administrator.app)
        .post('/gestion/sesiones/1/certificar-asistentes')
        .send({});
      assert.equal(firstIssue.status, 200);
      assert.equal(firstIssue.body.total_procesados, 1);
      assert.equal(firstIssue.body.total_certificados, 1);
      const firstCertificate = await fixture.db.query(
        `SELECT id, activo, fecha_vencimiento
           FROM certificacion_usuario
          WHERE codigo_curso = 'COURSE-1' AND usuario_documento = 'student-1'`
      );
      assert.equal(firstCertificate.rows.length, 1);
      assert.equal(firstCertificate.rows[0].activo, true);
      const currentLocalCertifications = await getCertificacionesLocalesVigentes(
        fixture.db,
        'student-1'
      );
      assert.ok(currentLocalCertifications.has('COURSE-1'));

      const duplicateIssue = await request(administrator.app)
        .post('/gestion/sesiones/1/certificar-asistentes')
        .send({});
      assert.equal(duplicateIssue.status, 200);
      assert.equal(duplicateIssue.body.total_certificados, 0);
      assert.equal(duplicateIssue.body.total_ya_certificados, 1);
      const afterDuplicate = await fixture.db.query(
        `SELECT id, activo
           FROM certificacion_usuario
          WHERE codigo_curso = 'COURSE-1' AND usuario_documento = 'student-1'`
      );
      assert.deepEqual(afterDuplicate.rows, [{ id: firstCertificate.rows[0].id, activo: true }]);

      await fixture.db.query(
        `UPDATE certificacion_usuario
            SET fecha_emision = CURRENT_TIMESTAMP - INTERVAL '2 days',
                fecha_vencimiento = CURRENT_TIMESTAMP - INTERVAL '1 day'
          WHERE id = $1`,
        [firstCertificate.rows[0].id]
      );
      const expiredLocalCertifications = await getCertificacionesLocalesVigentes(
        fixture.db,
        'student-1'
      );
      assert.equal(expiredLocalCertifications.has('COURSE-1'), false);
      const renewedIssue = await request(administrator.app)
        .post('/gestion/sesiones/1/certificar-asistentes')
        .send({});
      assert.equal(renewedIssue.status, 200);
      assert.equal(renewedIssue.body.total_certificados, 1);
      const certificateHistory = await fixture.db.query(
        `SELECT id, activo, fecha_vencimiento,
                activo = TRUE AND fecha_vencimiento > CURRENT_TIMESTAMP AS vigente
           FROM certificacion_usuario
          WHERE codigo_curso = 'COURSE-1' AND usuario_documento = 'student-1'
          ORDER BY id`
      );
      assert.equal(certificateHistory.rows.length, 2);
      assert.equal(certificateHistory.rows[0].activo, false);
      assert.equal(certificateHistory.rows[0].vigente, false);
      assert.equal(certificateHistory.rows[1].activo, true);
      assert.equal(certificateHistory.rows[1].vigente, true);
      const renewedLocalCertifications = await getCertificacionesLocalesVigentes(
        fixture.db,
        'student-1'
      );
      assert.ok(renewedLocalCertifications.has('COURSE-1'));

      const currentCertificates = await request(student.app).get(
        '/mis-certificaciones?vigente=true'
      );
      assert.equal(currentCertificates.status, 200);
      assert.equal(currentCertificates.body.filas, 1);
      assert.equal(currentCertificates.body.certificaciones[0].vigente, true);
      const expiredCertificates = await request(student.app).get(
        '/mis-certificaciones?vigente=false'
      );
      assert.equal(expiredCertificates.status, 200);
      assert.equal(expiredCertificates.body.filas, 1);
      assert.equal(expiredCertificates.body.certificaciones[0].vigente, false);

      const otherStudentCertificate = await fixture.db.query(
        `SELECT COUNT(*)::int AS total
           FROM certificacion_usuario
          WHERE codigo_curso = 'COURSE-1' AND usuario_documento = 'student-2'`
      );
      assert.equal(otherStudentCertificate.rows[0].total, 0);
    } finally {
      student.restore();
      administrator.restore();
      await fixture.cleanup();
    }
  }
);

test(
  'PostgreSQL migration is repeatable and rejects cross-faculty course-laboratory links',
  {
    skip: databaseUrl
      ? false
      : 'Set MILAB_CAPACITACION_TEST_DATABASE_URL to run PostgreSQL regressions',
  },
  async () => {
    const fixture = await createPostgresFixture();

    try {
      const indexCount = async () => {
        const result = await fixture.db.query(
          `SELECT COUNT(*)::int AS total
             FROM pg_indexes
            WHERE schemaname = $1 AND indexname LIKE 'uq_%'`,
          [fixture.schema]
        );
        return result.rows[0].total;
      };
      const indexesBefore = await indexCount();
      await fixture.applyMigrationAgain();
      assert.equal(await indexCount(), indexesBefore);

      await assert.rejects(
        fixture.db.query(
          `INSERT INTO curso_laboratorio (codigo_curso, id_laboratorio)
           VALUES ('COURSE-1', 12)`
        ),
        (error) => /no pertenece a la facultad/i.test(error.message)
      );

      await fixture.db.query(
        `INSERT INTO curso_laboratorio (codigo_curso, id_laboratorio)
         VALUES ('COURSE-2', 12)`
      );
      await assert.rejects(
        fixture.db.query(
          `UPDATE curso_laboratorio
              SET id_laboratorio = 11
            WHERE codigo_curso = 'COURSE-2' AND id_laboratorio = 12`
        ),
        (error) => /no pertenece a la facultad/i.test(error.message)
      );

      await fixture.db.query('INSERT INTO equipo (id) VALUES (1)');
      await fixture.db.query(
        `INSERT INTO equipo_especializado (codigo_curso, id_equipo)
         VALUES ('COURSE-1', 1)`
      );
      assert.deepEqual(
        (await getCursosActivosDeEquipo(fixture.db, 1)).map((course) => course.codigo_curso),
        ['COURSE-1']
      );
      await fixture.db.query(`UPDATE cursos SET activo = FALSE WHERE codigo_curso = 'COURSE-1'`);
      assert.deepEqual(await getCursosActivosDeEquipo(fixture.db, 1), []);
      await fixture.db.query(`UPDATE cursos SET activo = TRUE WHERE codigo_curso = 'COURSE-1'`);
      await fixture.db.query(
        `UPDATE equipo_especializado
            SET activo = FALSE
          WHERE codigo_curso = 'COURSE-1' AND id_equipo = 1`
      );
      assert.deepEqual(await getCursosActivosDeEquipo(fixture.db, 1), []);
    } finally {
      await fixture.cleanup();
    }
  }
);
