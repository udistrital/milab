//ConfigurCIÓN variables de entorno

require('dotenv').config();

const config = {
  env: process.env.NODE_ENV,
  port: process.env.PORT,
  dbUser: process.env.DB_USER,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,
  dbHost: process.env.DB_HOST,
  dbPort: process.env.DB_PORT,
  options: `-c search_path=${process.env.DB_SCHEMA}`,
};

module.exports = { config };
