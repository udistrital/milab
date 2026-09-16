require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const {
  obtenerCursosUsuario,
  estaCursoCompletado,
  clasificarUsuario,
} = require('./data/mock-data');

const app = express();
const PORT = process.env.PORT || 4000;
const VERBOSE = process.env.MOCK_VERBOSE !== 'false';

app.use(helmet());
app.use(express.json());

app.use((req, _res, next) => {
  if (VERBOSE) {
    console.log(`[EDX-MOCK] ${new Date().toISOString()} ${req.method} ${req.url}`);
  }
  next();
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', service: 'edx-mock', timestamp: new Date().toISOString() });
});


app.post('/api/certificacion/curso', (req, res) => {
  const { codigo_usuario, codigo_curso } = req.body || {};

  if (!codigo_usuario || !codigo_curso) {
    return res.status(400).json({
      error: 'Faltan parámetros requeridos',
      requeridos: ['codigo_usuario', 'codigo_curso'],
      recibidos: Object.keys(req.body || {}),
    });
  }

  const completado = estaCursoCompletado(codigo_usuario, codigo_curso);

  if (VERBOSE) {
    console.log(
      `[EDX-MOCK] Endpoint1 → usuario=${codigo_usuario} (escenario=${clasificarUsuario(
        codigo_usuario,
      )}) curso=${codigo_curso} → completado=${completado}`,
    );
  }

  return res.status(200).json({ completado });
});


app.post('/api/certificacion/usuario', (req, res) => {
  const { codigo_usuario } = req.body || {};

  if (!codigo_usuario) {
    return res.status(400).json({
      error: 'Falta parámetro requerido',
      requeridos: ['codigo_usuario'],
      recibidos: Object.keys(req.body || {}),
    });
  }

  const cursos = obtenerCursosUsuario(codigo_usuario);

  if (VERBOSE) {
    console.log(
      `[EDX-MOCK] Endpoint2 → usuario=${codigo_usuario} (escenario=${clasificarUsuario(
        codigo_usuario,
      )}) → ${cursos.length} cursos retornados`,
    );
  }

  return res.status(200).json({ cursos });
});

// Endpoint de documentación / contrato rápido
app.get('/api/contrato', (_req, res) => {
  res.status(200).json({
    servicio: 'EDX-MOCK Certificación',
    version: '1.0.0',
    endpoints: [
      {
        metodo: 'POST',
        ruta: '/api/certificacion/curso',
        descripcion: 'Consulta el estado de certificación de 1 curso para 1 usuario',
        body_entrada: {
          codigo_usuario: 'string (código identificador del usuario)',
          codigo_curso: 'string (código del curso ej. MOCK-COURSE-001)',
        },
        body_salida: { completado: 'boolean' },
      },
      {
        metodo: 'POST',
        ruta: '/api/certificacion/usuario',
        descripcion: 'Consulta TODOS los cursos y su estado de certificación para 1 usuario',
        body_entrada: {
          codigo_usuario: 'string (código identificador del usuario)',
        },
        body_salida: {
          cursos:
            'Array<{ codigo_curso: string, nombre_curso: string, completado: boolean }>',
        },
      },
    ],
    escenarios_usuarios: {
      'empieza por 1': 'TODOS los cursos completados (completado: true)',
      'empieza por 2': 'NINGÚN curso completado (completado: false)',
      'empieza por 3': 'PARCIAL — MOCK-COURSE-001 y 003 completados, 002 y 004 NO',
      'empieza por 9': 'USUARIO VACÍO — lista de cursos vacía []',
    },
    cursos_mock: [
      'MOCK-COURSE-001 — Curso de prueba 1',
      'MOCK-COURSE-002 — Curso de prueba 2',
      'MOCK-COURSE-003 — Curso de prueba 3',
      'MOCK-COURSE-004 — Curso de prueba 4',
    ],
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint no encontrado', servicio: 'edx-mock' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(` EDX-MOCK Certificación iniciado`);
  console.log(` Puerto  : ${PORT}`);
  console.log(` Verbose : ${VERBOSE}`);
  console.log(` Health  : http://localhost:${PORT}/health`);
  console.log(` Contrato: http://localhost:${PORT}/api/contrato`);
});
