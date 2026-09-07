const homeRouter = require('../src/routes/web/home');
const dashboardRouter = require('../src/routes/api/dashboard');
const getListEstudiantesRouter = require('../src/routes/api/get_list_estudiantes');
const getData1Router = require('../src/routes/api/get-data1');
const verificaMultaDocenteRouter = require('../src/routes/api/verifica_multa_docente');

function getHandler(router, method, routePath) {
  const layer = router.stack.find(
    (entry) => entry.route && entry.route.path === routePath && entry.route.methods[method]
  );

  if (!layer) {
    throw new Error(`Handler not found for ${method.toUpperCase()} ${routePath}`);
  }

  return layer.route.stack.map((entry) => entry.handle);
}

async function invokeHandler(handlers, req) {
  const result = {
    headers: {},
    statusCode: 200,
    action: null,
  };

  const res = {
    setHeader(name, value) {
      result.headers[name] = value;
      return this;
    },
    set(name, value) {
      result.headers[name] = value;
      return this;
    },
    status(code) {
      result.statusCode = code;
      return this;
    },
    render(view, locals) {
      result.action = { type: 'render', view, locals };
      return this;
    },
    redirect(firstArg, secondArg) {
      const url = typeof secondArg === 'string' ? secondArg : firstArg;
      const statusCode = typeof secondArg === 'string' ? firstArg : 302;
      result.action = { type: 'redirect', url, statusCode };
      return this;
    },
    send(payload) {
      result.action = { type: 'send', payload };
      return this;
    },
    json(payload) {
      result.action = { type: 'json', payload };
      return this;
    },
  };

  async function runHandlerAt(index) {
    if (index >= handlers.length) {
      return;
    }

    let nextCalled = false;
    const maybePromise = handlers[index](req, res, () => {
      nextCalled = true;
      result.action = { type: 'next' };
      return runHandlerAt(index + 1);
    });

    await Promise.resolve(maybePromise);

    if (nextCalled) {
      return;
    }
  }

  await runHandlerAt(0);
  return result;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const tests = [];
  const homeRoot = getHandler(homeRouter, 'get', '/');
  const dashboardHome = getHandler(dashboardRouter, 'get', '/');
  const estudiantesHome = getHandler(getListEstudiantesRouter, 'get', '/');
  const consultaMasivaHome = getHandler(getListEstudiantesRouter, 'get', '/get_consulta');
  const studentVerification = getHandler(getData1Router, 'get', '/verificacion');
  const docenteVerification = getHandler(verificaMultaDocenteRouter, 'get', '/verificacion');

  const roleRedirects = [
    ['admin', '/milab/inicio'],
    ['coordinador', '/milab/inicio'],
    ['laboratorista', '/milab/inicio'],
    ['estudiante', '/milab/inicio'],
    ['docente', '/milab/inicio'],
  ];

  for (const [role, expectedUrl] of roleRedirects) {
    const result = await invokeHandler(homeRoot, {
      session: { user: { tipo: role, documento: 'test-user' } },
    });

    assert(result.action?.type === 'redirect', `Expected redirect for role ${role}`);
    assert(
      result.action.url === expectedUrl,
      `Unexpected redirect for ${role}: ${result.action.url}`
    );
    tests.push(`PASS role redirect ${role} -> ${expectedUrl}`);
  }

  const guestResult = await invokeHandler(homeRoot, { session: {} });
  assert(guestResult.action?.type === 'render', 'Expected guest root to render landing');
  assert(
    guestResult.action.view === 'home/index_2',
    'Expected guest landing to render home/index_2'
  );
  tests.push('PASS guest root renders home/index_2');

  const adminSession = { user: { tipo: 'admin', documento: '1024467835', nombre: 'Admin Local' } };

  const dashboardResult = await invokeHandler(dashboardHome, {
    session: adminSession,
    query: {},
  });
  assert(dashboardResult.action?.type === 'render', 'Expected admin dashboard to render');
  assert(dashboardResult.action.view === 'home/dashboard', 'Expected admin dashboard view');
  tests.push('PASS admin dashboard renders home/dashboard');

  const listResult = await invokeHandler(estudiantesHome, {
    session: adminSession,
    query: {},
  });
  assert(listResult.action?.type === 'render', 'Expected admin student list to render');
  assert(
    listResult.action.view === 'home/get_list_estudiantes',
    'Expected get_list_estudiantes view'
  );
  tests.push('PASS admin get_list_estudiantes renders');

  const consultaAdmin = await invokeHandler(consultaMasivaHome, { session: adminSession });
  assert(consultaAdmin.action?.type === 'render', 'Expected admin consulta masiva to render');
  assert(
    consultaAdmin.action.view === 'home/consulta_masiva',
    'Expected consulta_masiva view for admin'
  );
  tests.push('PASS admin consulta_masiva renders');

  for (const role of ['coordinador', 'laboratorista']) {
    const consultaRole = await invokeHandler(consultaMasivaHome, {
      session: { user: { tipo: role, documento: `${role}-local` } },
    });
    assert(consultaRole.action?.type === 'render', `Expected consulta masiva render for ${role}`);
    assert(
      consultaRole.action.view === 'home/consulta_masiva',
      `Expected consulta_masiva view for ${role}`
    );
    tests.push(`PASS ${role} consulta_masiva renders`);
  }

  const studentAsAdmin = await invokeHandler(studentVerification, { session: adminSession });
  assert(
    studentAsAdmin.action?.type === 'render',
    'Expected admin student verification flow to render'
  );
  assert(
    studentAsAdmin.action.view === 'home/get-info2',
    'Expected get-info2 view for admin student verification'
  );
  tests.push('PASS admin can access student verification flow');

  const docenteAsAdmin = await invokeHandler(docenteVerification, { session: adminSession });
  assert(
    docenteAsAdmin.action?.type === 'render',
    'Expected admin docente verification flow to render'
  );
  assert(
    docenteAsAdmin.action.view === 'home/get-info-docente',
    'Expected get-info-docente view for admin docente verification'
  );
  tests.push('PASS admin can access docente verification flow');

  const deniedDashboard = await invokeHandler(dashboardHome, {
    session: { user: { tipo: 'coordinador', documento: 'coord-local' } },
    query: {},
  });
  assert(deniedDashboard.action?.type === 'render', 'Expected denied dashboard to render error');
  assert(
    deniedDashboard.action.view === 'home/message_error',
    'Expected message_error for denied dashboard'
  );
  tests.push('PASS coordinator is denied admin dashboard');

  console.log(tests.join('\n'));
}

run().catch((error) => {
  console.error('VALIDATION FAILED');
  console.error(error);
  process.exit(1);
});
