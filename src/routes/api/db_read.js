require('dotenv').config();

const pool = require('../../libs/db');

// Función para obtener todos los registros de la tabla1
async function obtenerRegistrosTabla1() {
  const query = 'SELECT * FROM certificado_estudiante';

  try {
    const client = await pool.connect();
    const result = await client.query(query);
    client.release();

    console.log('Registros de certificados de estudiantes:');
    console.table(result.rows);
  } catch (error) {
    console.error('Error al obtener registros de tabla1', error);
  }
}

// Ejemplo de uso — sólo al ejecutar directamente: node db_read.js
if (require.main === module) {
  obtenerRegistrosTabla1();
}
