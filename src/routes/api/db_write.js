require('dotenv').config();

const pool = require('../../libs/db');

// Función para insertar un registro en la tabla1
async function insertarRegistroTabla1(usuario_id, fecha_creacion, certificado_id, correo, multa) {
  const query =
    'INSERT INTO certificado_estudiante (usuario_id, fecha_creacion, certificado_id, correo, multa) VALUES ($1, $2, $3, $4, $5)';
  const values = [usuario_id, fecha_creacion, certificado_id, correo, multa];

  try {
    const client = await pool.connect();
    await client.query(query, values);
    client.release();
    console.log('Registro insertado correctamente en tabla1');
  } catch (error) {
    console.error('Error al insertar registro en tabla1', error);
  }
}

// Ejemplo de uso — sólo al ejecutar directamente: node db_write.js
if (require.main === module) {
  insertarRegistroTabla1(1, '2023_07_04', '783483yehxbkew', 'andres@m2', '2');
}
