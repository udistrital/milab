/**
 * Endpoints de prueba y diagnóstico para la integración con el
 * servicio de certificación EDX (Mock o Real).
 *
 * Estas rutas son de uso DESARROLLO/DIAGNÓSTICO. En producción se
 * consumiría el cliente `edx-cert-client.js` directamente desde la
 * lógica de negocio del módulo de capacitación.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const {
  consultarCurso,
  consultarCursosUsuario,
  healthCheck,
  USE_MOCK,
  BASE_URL,
} = require('../../libs/edx-cert-client');

const router = express.Router();

/**
 * GET /api/certificacion-edx/estado
 * Diagnóstico: health check del servicio externo + configuración activa.
 */
router.get('/estado', async (_req, res) => {
  try {
    const servicioDisponible = await healthCheck();
    res.status(200).json({
      configuracion: {
        modo: USE_MOCK ? 'MOCK' : 'PRODUCCION (EDX real)',
        url_base: BASE_URL,
      },
      servicio: {
        disponible: servicioDisponible,
        health_check_url: `${BASE_URL}/health`,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Error al consultar estado del servicio EDX',
      detalle: err.message,
    });
  }
});

/**
 * POST /api/certificacion-edx/curso
 * Prueba el Endpoint 1 del servicio EDX: estado de 1 curso para 1 usuario.
 *
 * Body: { codigo_usuario: "100001", codigo_curso: "MOCK-COURSE-001" }
 */
router.post(
  '/curso',
  [
    body('codigo_usuario').notEmpty().withMessage('codigo_usuario es requerido'),
    body('codigo_curso').notEmpty().withMessage('codigo_curso es requerido'),
  ],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    try {
      const { codigo_usuario, codigo_curso } = req.body;
      const resultado = await consultarCurso(codigo_usuario, codigo_curso);
      res.status(200).json({
        entrada: { codigo_usuario, codigo_curso },
        respuesta_edx: resultado,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({
        error: 'Fallo la comunicación con el servicio EDX',
        detalle: err.message,
      });
    }
  },
);

/**
 * POST /api/certificacion-edx/usuario
 * Prueba el Endpoint 2 del servicio EDX: lista de cursos certificados de un usuario.
 *
 * Body: { codigo_usuario: "300001" }
 */
router.post(
  '/usuario',
  [body('codigo_usuario').notEmpty().withMessage('codigo_usuario es requerido')],
  async (req, res) => {
    const errores = validationResult(req);
    if (!errores.isEmpty()) {
      return res.status(400).json({ errores: errores.array() });
    }

    try {
      const { codigo_usuario } = req.body;
      const resultado = await consultarCursosUsuario(codigo_usuario);
      const resumen = {
        total_cursos: resultado.cursos.length,
        completados: resultado.cursos.filter((c) => c.completado).length,
        pendientes: resultado.cursos.filter((c) => !c.completado).length,
      };
      res.status(200).json({
        entrada: { codigo_usuario },
        resumen,
        respuesta_edx: resultado,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(502).json({
        error: 'Fallo la comunicación con el servicio EDX',
        detalle: err.message,
      });
    }
  },
);

/**
 * POST /api/certificacion-edx/prueba-completa
 * Ejecuta una batería de pruebas contra los 4 escenarios mock
 * y los 4 cursos, devolviendo una matriz de resultados.
 */
router.post('/prueba-completa', async (_req, res) => {
  const escenarios = [
    { codigo: '100001', descripcion: 'TODOS certificados (prefijo 1)' },
    { codigo: '200001', descripcion: 'NINGÚN certificado (prefijo 2)' },
    { codigo: '300001', descripcion: 'PARCIAL (prefijo 3)' },
    { codigo: '900001', descripcion: 'USUARIO VACÍO (prefijo 9)' },
  ];
  const cursos = [
    'MOCK-COURSE-001',
    'MOCK-COURSE-002',
    'MOCK-COURSE-003',
    'MOCK-COURSE-004',
  ];

  try {
    const matriz = [];
    for (const escenario of escenarios) {
      const fila = {
        usuario: escenario.codigo,
        descripcion: escenario.descripcion,
        por_curso: {},
      };
      for (const curso of cursos) {
        const r = await consultarCurso(escenario.codigo, curso);
        fila.por_curso[curso] = r.completado;
      }
      const listado = await consultarCursosUsuario(escenario.codigo);
      fila.total_cursos_listados = listado.cursos.length;
      matriz.push(fila);
    }

    res.status(200).json({
      modo: USE_MOCK ? 'MOCK' : 'PRODUCCION',
      timestamp: new Date().toISOString(),
      matriz_escenarios: matriz,
    });
  } catch (err) {
    res.status(502).json({
      error: 'Fallo la batería de pruebas',
      detalle: err.message,
    });
  }
});

module.exports = router;
