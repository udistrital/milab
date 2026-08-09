const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const path = require('node:path');

const routePath = path.resolve(__dirname, '../../../src/routes/web/home.js');

function buildApp(sessionUser) {
  const app = express();
  const route = require(routePath);

  app.use((req, res, next) => {
    req.session = { user: sessionUser };
    res.render = (view, locals) => res.status(res.statusCode || 200).json({ view, locals });
    next();
  });
  app.use('/', route);

  return app;
}

test('web home renders landing page for guests and redirects authenticated users', async () => {
  delete require.cache[routePath];
  let app = buildApp(null);
  let response = await request(app).get('/');

  assert.equal(response.status, 200);
  assert.equal(response.body.view, 'home/index_2');

  delete require.cache[routePath];
  app = buildApp({ tipo: 'admin' });
  response = await request(app).get('/');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/milab/inicio');
});

test('web home protects inicio and canonical auth/login routes', async () => {
  delete require.cache[routePath];
  let app = buildApp(null);
  let response = await request(app).get('/inicio');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/milab/');

  delete require.cache[routePath];
  app = buildApp({ tipo: 'coordinador' });
  response = await request(app).get('/auth/login');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/milab/inicio');
});

test('web home redirects public aliases to canonical routes', async () => {
  delete require.cache[routePath];
  const app = buildApp(null);

  const consulta = await request(app).get('/consulta');
  assert.equal(consulta.status, 302);
  assert.equal(consulta.headers.location, '/milab/api/consulta-invit');

  const register = await request(app).get('/register');
  assert.equal(register.status, 302);
  assert.equal(register.headers.location, '/milab/auth/microsoft');
});