require('dotenv').config();

const pool = require('../../libs/db');

// Función para insertar un registro en la tabla1
async function insertarRegistroTabla1(
  nombre,
  cc,
  codigo,
  programa,
  estado_estudiante,
  fecha_creacion,
  id_Certificado,
  correo,
  multa
) {
  const query =
    'INSERT INTO estudiante (nombre, cc, codigo, programa, estado_estudiante, fecha_creacion,id_Certificado, correo, multa) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)';
  const values = [
    nombre,
    cc,
    codigo,
    programa,
    estado_estudiante,
    fecha_creacion,
    id_Certificado,
    correo,
    multa,
  ];

  try {
    const client = await pool.connect();
    await client.query(query, values);
    client.release();
    console.log('Registro insertado correctamente en tabla1');
  } catch (error) {
    console.error('Error al insertar registro en tabla1', error);
  }
}

// // Función para insertar un registro en la tabla2
// async function insertarRegistroTabla2(descripcion, fecha_registro) {
//   const query = 'INSERT INTO tabla2 (descripcion, fecha_registro) VALUES ($1, $2)';
//   const values = [descripcion, fecha_registro];

//   try {
//     const client = await pool.connect();
//     const result = await client.query(query, values);
//     client.release();
//     console.log('Registro insertado correctamente en tabla2');
//   } catch (error) {
//     console.error('Error al insertar registro en tabla2', error);
//   }
// }

// Ejemplo de uso
insertarRegistroTabla1(
  'John Wick 3',
  1032431632,
  20062005102,
  'Ingenieria electronica',
  'A',
  '2023_07_04',
  '783483yehxbkew',
  'andres@m2',
  '2'
);
//insertarRegistroTabla2('Descripción del registro', '2023-07-04');
