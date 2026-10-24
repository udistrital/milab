const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const request = require('supertest');

const routePath = path.resolve(__dirname, '../../../src/routes/api/admin/esquema-bd.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');

const DATABASE_INFO = {
  base_datos: 'milab',
  usuario_conexion: 'milab_app',
  usuario_efectivo: 'milab_app',
  search_path: 'milab',
};

function buildApp(route, sessionUser) {
  const app = express();

  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

function defaultPoolQuery(sql) {
  if (sql.includes('current_database()')) {
    return { rows: [DATABASE_INFO] };
  }
  if (sql.includes('FROM pg_class c') && sql.includes('ILIKE')) {
    return {
      rows: [
        {
          esquema: 'milab',
          nombre: 'usuario_ual_rol_operativo',
          tipo: 'Tabla',
          propietario: 'milab_owner',
          lectura_permitida: true,
          uso_esquema_permitido: true,
          creacion_esquema_permitida: false,
          insercion_permitida: false,
          actualizacion_permitida: true,
          eliminacion_permitida: false,
          vaciado_permitido: false,
          referencias_permitidas: false,
          disparadores_permitidos: false,
          comentario: null,
        },
      ],
    };
  }
  if (sql.includes('AND c.relname = $2')) {
    return {
      rows: [
        {
          oid: '16400',
          esquema: 'milab',
          nombre: 'usuario_ual_rol_operativo',
          tipo: 'Tabla',
          propietario: 'milab_owner',
          lectura_permitida: false,
          uso_esquema_permitido: true,
          creacion_esquema_permitida: false,
          insercion_permitida: false,
          actualizacion_permitida: false,
          eliminacion_permitida: false,
          vaciado_permitido: false,
          referencias_permitidas: false,
          disparadores_permitidos: false,
          comentario: null,
        },
      ],
    };
  }
  if (sql.includes('FROM pg_attribute')) {
    return {
      rows: [
        {
          posicion: 1,
          columna: 'id',
          tipo: 'integer',
          permite_nulo: false,
          valor_por_defecto: "nextval('seq')",
          identidad: false,
        },
      ],
    };
  }
  if (sql.includes('FROM pg_constraint')) {
    return { rows: [{ nombre: 'pk_x', tipo: 'Clave primaria', definicion: 'PRIMARY KEY (id)' }] };
  }
  if (sql.includes('FROM pg_indexes')) {
    return { rows: [{ nombre: 'idx_x', definicion: 'CREATE INDEX idx_x ON x (id)' }] };
  }
  if (sql.includes('pg_get_serial_sequence')) {
    return {
      rows: [
        {
          nombre: 'milab.usuario_ual_rol_operativo_id_seq',
          uso_permitido: false,
          lectura_permitida: true,
          actualizacion_permitida: false,
        },
      ],
    };
  }
  return { rows: [] };
}

function loadRoute({ poolQueryImpl } = {}) {
  const originalDb = require.cache[dbPath];
  const poolCalls = [];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: async (sql, params = []) => {
        poolCalls.push({ sql, params });
        return (poolQueryImpl || defaultPoolQuery)(sql, params);
      },
    },
  };

  delete require.cache[routePath];
  const route = require(routePath);

  return {
    route,
    getPoolCalls: () => poolCalls,
    restore() {
      if (originalDb) {
        require.cache[dbPath] = originalDb;
      } else {
        delete require.cache[dbPath];
      }
      delete require.cache[routePath];
    },
  };
}

const ADMIN_USER = { tipo: 'admin', roles: ['admin'], documento: '100' };

test('esquema-bd lists relations for admin and escapes the filter', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, ADMIN_USER);
    const response = await request(app).get('/').query({ q: '100%_' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/admin_esquema_bd');
    assert.equal(response.body.locals.relaciones.length, 1);
    assert.equal(response.body.locals.baseDatos.base_datos, 'milab');
    assert.equal(response.body.locals.baseDatos.usuario_conexion, 'milab_app');
    assert.equal(response.body.locals.baseDatos.usuario_efectivo, 'milab_app');
    assert.equal(response.body.locals.detalle, null);

    const listCall = loaded
      .getPoolCalls()
      .find((call) => call.sql.includes('FROM pg_class c') && call.sql.includes('ILIKE'));
    assert.ok(listCall);
    assert.equal(listCall.params[2], '%100\\%\\_%');
    assert.equal(listCall.sql.includes('100%_'), false);
  } finally {
    loaded.restore();
  }
});

test('esquema-bd reports a missing table instead of failing', async () => {
  const loaded = loadRoute({
    poolQueryImpl: (sql, params) => {
      if (sql.includes('AND c.relname = $2')) {
        return { rows: [] };
      }
      return defaultPoolQuery(sql, params);
    },
  });

  try {
    const app = buildApp(loaded.route, ADMIN_USER);
    const response = await request(app)
      .get('/')
      .query({ esquema: 'milab', tabla: 'usuario_ual_rol_operativo' });

    assert.equal(response.status, 200);
    assert.equal(response.body.view, 'home/admin_esquema_bd');
    assert.equal(response.body.locals.notFound, true);
    assert.equal(response.body.locals.detalle, null);
  } finally {
    loaded.restore();
  }
});

test('esquema-bd returns columns, constraints and indexes for an existing table', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, ADMIN_USER);
    const response = await request(app)
      .get('/')
      .query({ esquema: 'milab', tabla: 'usuario_ual_rol_operativo' });

    assert.equal(response.status, 200);
    const { detalle, notFound } = response.body.locals;
    assert.equal(notFound, false);
    assert.equal(detalle.nombre, 'usuario_ual_rol_operativo');
    assert.equal(detalle.lectura_permitida, false);
    assert.equal(detalle.permisos.esquema.uso, true);
    assert.equal(detalle.permisos.esquema.crear, false);
    assert.equal(detalle.permisos.tabla.insercion, false);
    assert.equal(detalle.permisos.tabla.actualizacion, false);
    assert.equal(detalle.permisos.secuencia.nombre, 'milab.usuario_ual_rol_operativo_id_seq');
    assert.equal(detalle.permisos.secuencia.uso_permitido, false);
    assert.equal(detalle.columnas[0].columna, 'id');
    assert.equal(detalle.restricciones[0].nombre, 'pk_x');
    assert.equal(detalle.indices[0].nombre, 'idx_x');

    const sequenceCall = loaded
      .getPoolCalls()
      .find((call) => call.sql.includes('pg_get_serial_sequence'));
    assert.match(sequenceCall.sql, /format\('%I\.%I', \$1::text, \$2::text\)/);

    const columnCall = loaded.getPoolCalls().find((call) => call.sql.includes('FROM pg_attribute'));
    assert.deepEqual(columnCall.params, ['16400']);
  } finally {
    loaded.restore();
  }
});

test('esquema-bd denies non-admin users', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, { tipo: 'docente', roles: ['docente'], documento: '200' });
    const response = await request(app).get('/');

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(
      loaded.getPoolCalls().some((call) => call.sql.includes('pg_class')),
      false
    );
  } finally {
    loaded.restore();
  }
});

test('esquema-bd denies coordinador_general even though it has read-only admin access', async () => {
  const loaded = loadRoute();

  try {
    const app = buildApp(loaded.route, {
      tipo: 'coordinador_general',
      roles: ['coordinador_general'],
      documento: '300',
    });
    const response = await request(app).get('/');

    assert.equal(response.body.view, 'home/message_error');
    assert.equal(
      loaded.getPoolCalls().some((call) => call.sql.includes('pg_class')),
      false
    );
  } finally {
    loaded.restore();
  }
});
