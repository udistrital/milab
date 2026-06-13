const { Pool } = require('pg');
const { config } = require('../config/config');
const { resolveDatabaseCredentials } = require('./db-credentials');

let poolPromise;

async function createPool() {
  const credentials = await resolveDatabaseCredentials();

  const pool = new Pool({
    host: config.dbHost,
    port: config.dbPort,
    user: credentials.user,
    password: credentials.password,
    database: config.dbName,
    options: config.options,
  });

  // Manejo centralizado de errores del pool
  pool.on('error', (err) => {
    console.error('Error inesperado en el pool de PostgreSQL:', err);
  });

  return pool;
}

function getPool() {
  if (!poolPromise) {
    poolPromise = createPool();
  }

  return poolPromise;
}

module.exports = {
  query: async (...args) => {
    const pool = await getPool();
    return pool.query(...args);
  },
  connect: async () => {
    const pool = await getPool();
    return pool.connect();
  },
  end: async () => {
    const pool = await getPool();
    return pool.end();
  },
  init: async () => {
    await getPool();
  },
};
