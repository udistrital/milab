const express = require('express');

const pool = require('../../libs/db');
const { requireRoles } = require('../middlewares/auth');
const router = express.Router();

const requireAdminDashboardAccess = requireRoles('admin', {
  message: '¡Acceso denegado!',
  message2: 'No tienes permisos para ver el dashboard',
  limit: 'noSession',
});

router.get('/', requireAdminDashboardAccess, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const filtro = req.query.filtro || 'dia';
  const requestedChart = typeof req.query.grafico === 'string' ? req.query.grafico.trim() : '';
  const selectedChart = [
    'estudiantes',
    'docentes',
    'sanciones',
    'sancionesActivas',
    'sancionesSaldadas',
    'laboratoristas',
    'coordinadores',
    'usuariosRegistrados',
  ].includes(requestedChart)
    ? requestedChart
    : 'estudiantes';

  let dateTrunc;
  let labelFormat;

  switch (filtro) {
    case 'anio':
      dateTrunc = 'year';
      labelFormat = 'Año';
      break;
    case 'mes':
      dateTrunc = 'month';
      labelFormat = 'Mes';
      break;
    case 'semana':
      dateTrunc = 'week';
      labelFormat = 'Semana';
      break;
    case 'dia':
    default:
      dateTrunc = 'day';
      labelFormat = 'Día';
      break;
  }

  try {
    async function getData(query, fieldName = 'fecha') {
      const result = await pool.query(query, [dateTrunc]);

      let labels, data;

      if (result.rows.length === 0) {
        labels = [];
        data = [];
      } else {
        labels = result.rows.map((row) => {
          const fecha = new Date(row[fieldName]);
          switch (filtro) {
            case 'anio':
              return fecha.getFullYear().toString();
            case 'mes':
              return fecha.toLocaleDateString('es-CO', {
                year: 'numeric',
                month: '2-digit',
              });
            case 'semana': {
              const inicioAnio = new Date(fecha.getFullYear(), 0, 1);
              const diasDesdeInicio = Math.floor((fecha - inicioAnio) / (24 * 60 * 60 * 1000));
              const numeroSemana = Math.ceil((diasDesdeInicio + inicioAnio.getDay() + 1) / 7);
              return `S${numeroSemana}/${fecha.getFullYear()}`;
            }
            case 'dia':
            default:
              return fecha.toLocaleDateString('es-CO', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              });
          }
        });
        data = result.rows.map((row) => parseInt(row.cantidad) || 0);
      }

      return { labels, data };
    }

    const estudiantes = await getData(`
      SELECT date_trunc($1, fecha_creacion) AS fecha, COUNT(*) AS cantidad
      FROM estudiante
      WHERE fecha_creacion IS NOT NULL
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    const docentes = await getData(`
      SELECT date_trunc($1, fecha_creacion) AS fecha, COUNT(*) AS cantidad
      FROM docente
      WHERE fecha_creacion IS NOT NULL
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    const multas = await getData(`
      SELECT date_trunc($1, fecha_multa) AS fecha, COUNT(*) AS cantidad
      FROM multas
      WHERE fecha_multa IS NOT NULL
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    // Nuevas consultas para multas por estado
    const multasActivas = await getData(`
      SELECT date_trunc($1, fecha_multa) AS fecha, COUNT(*) AS cantidad
      FROM multas
      WHERE fecha_multa IS NOT NULL AND con_estado_multa = 'ACTIVA'
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    const multasSaldadas = await getData(`
      SELECT date_trunc($1, fecha_multa) AS fecha, COUNT(*) AS cantidad
      FROM multas
      WHERE fecha_multa IS NOT NULL AND con_estado_multa = 'SALDADO'
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    const laboratoristas = await getData(`
      SELECT date_trunc($1, CURRENT_DATE) AS fecha, COUNT(*) AS cantidad
      FROM laboratorista
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    const coordinadores = await getData(`
      SELECT date_trunc($1, CURRENT_DATE) AS fecha, COUNT(*) AS cantidad
      FROM coordinador_laboratorio
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    const usuariosRegistrados = await getData(`
      SELECT date_trunc($1, CURRENT_DATE) AS fecha, COUNT(documento) AS cantidad
      FROM usuario
      GROUP BY fecha
      ORDER BY fecha ASC
    `);

    res.render('home/dashboard', {
      filtro,
      labelFormat,
      selectedChart,
      chartsData: {
        estudiantes,
        docentes,
        multas,
        multasActivas,
        multasSaldadas,
        laboratoristas,
        coordinadores,
        usuariosRegistrados,
      },
    });
  } catch (error) {
    console.error('Error en dashboard:', error);
    res.status(500).send('Error en dashboard');
  }
});

module.exports = router;
