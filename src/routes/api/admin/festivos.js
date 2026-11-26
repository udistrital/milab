const express = require('express');
const pool = require('../../../libs/db');
const { normalizeLogDocument } = require('../../../libs/account-email');
const { isValidDateOnly } = require('../../../libs/colombian-holidays');
const { requireRoles } = require('../../middlewares/auth');

const router = express.Router();
const NAGER_DATE_BASE_URL = 'https://date.nager.at/api/v3/PublicHolidays';
const MIN_HOLIDAY_YEAR = 2000;
const MAX_HOLIDAY_YEAR = 2100;

router.use(express.urlencoded({ extended: true }));
router.use(express.json());
router.use(
  requireRoles('admin', {
    message: 'Acceso denegado',
    message2: 'Solo los administradores pueden configurar los festivos.',
    limit: 'loginOnly',
  })
);

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseHolidayYear(value) {
  const raw = String(value ?? '');
  if (!/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= MIN_HOLIDAY_YEAR && year <= MAX_HOLIDAY_YEAR ? year : null;
}

function normalizePublicHolidays(entries, year) {
  if (!Array.isArray(entries)) {
    throw new Error('La API de festivos devolvió una respuesta con formato no válido.');
  }

  const holidaysByDate = new Map();
  for (const entry of entries) {
    const date = sanitizeText(entry?.date);
    const name = sanitizeText(entry?.localName) || sanitizeText(entry?.name);
    if (
      entry?.global !== true ||
      !isValidDateOnly(date) ||
      Number(date.slice(0, 4)) !== year ||
      !name
    ) {
      continue;
    }

    holidaysByDate.set(date, { date, name: name.slice(0, 150) });
  }

  if (!holidaysByDate.size) {
    throw new Error('La API no devolvió festivos nacionales válidos para el año seleccionado.');
  }

  return [...holidaysByDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

async function loadHolidays(year) {
  const result = await pool.query(
    `
      SELECT TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, nombre, fuente
      FROM festivo_colombia
      WHERE fecha >= $1::date
        AND fecha < ($1::date + INTERVAL '1 year')
      ORDER BY fecha ASC
    `,
    [`${year}-01-01`]
  );
  return result.rows || [];
}

async function renderPage(req, res, { year, error = null, success = null, status = 200 } = {}) {
  const selectedYear = year || parseHolidayYear(req.query.year) || new Date().getFullYear();
  const holidays = await loadHolidays(selectedYear);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).render('home/admin_festivos', {
    holidays,
    year: selectedYear,
    minYear: MIN_HOLIDAY_YEAR,
    maxYear: MAX_HOLIDAY_YEAR,
    error: error || sanitizeText(req.query.error) || null,
    success: success || sanitizeText(req.query.success) || null,
  });
}

function redirectToYear(res, year, key, message) {
  return res.redirect(
    303,
    `/milab/api/admin/festivos?year=${year}&${key}=${encodeURIComponent(message)}`
  );
}

async function writeAudit(client, req, action, person) {
  const user = req.session?.user || {};
  await client.query(
    'INSERT INTO log (nombre, documento, accion, persona) VALUES ($1, $2, $3, $4)',
    [
      sanitizeText(user.tipo) || 'admin',
      normalizeLogDocument(user.documento_real || user.documento || '') || null,
      action,
      person,
    ]
  );
}

router.get('/', async (req, res) => {
  const rawYear = sanitizeText(req.query.year);
  const parsedYear = parseHolidayYear(rawYear);
  const year = rawYear ? parsedYear || new Date().getFullYear() : new Date().getFullYear();
  try {
    return await renderPage(req, res, {
      year,
      error:
        rawYear && !parsedYear
          ? `Selecciona un año entre ${MIN_HOLIDAY_YEAR} y ${MAX_HOLIDAY_YEAR}.`
          : null,
    });
  } catch (error) {
    console.error('Error cargando configuración de festivos:', error);
    return res.status(500).render('home/message_error', {
      message: 'No fue posible cargar la configuración de festivos.',
      message2: 'Verifica que la estructura de Inventarios esté actualizada.',
      limit: null,
    });
  }
});

router.post('/importar', async (req, res) => {
  const year = parseHolidayYear(req.body?.year);
  if (!year) {
    return redirectToYear(
      res,
      new Date().getFullYear(),
      'error',
      `Selecciona un año entre ${MIN_HOLIDAY_YEAR} y ${MAX_HOLIDAY_YEAR}.`
    );
  }

  let client;
  try {
    const response = await fetch(`${NAGER_DATE_BASE_URL}/${year}/CO`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      throw new Error(`El servicio Nager.Date respondió HTTP ${response.status}.`);
    }
    const holidays = normalizePublicHolidays(await response.json(), year);

    client = await pool.connect();
    await client.query('BEGIN');
    const dates = holidays.map((holiday) => holiday.date);
    const removedResult = await client.query(
      `
        DELETE FROM festivo_colombia
        WHERE fecha >= $1::date
          AND fecha < ($1::date + INTERVAL '1 year')
          AND fuente = 'Nager.Date'
          AND NOT (fecha = ANY($2::date[]))
      `,
      [`${year}-01-01`, dates]
    );
    let importedCount = 0;
    for (const holiday of holidays) {
      const result = await client.query(
        `
          INSERT INTO festivo_colombia (fecha, nombre, fuente)
          VALUES ($1::date, $2, 'Nager.Date')
          ON CONFLICT (fecha) DO UPDATE
          SET nombre = EXCLUDED.nombre,
              fuente = EXCLUDED.fuente,
              fecha_modificacion = CURRENT_TIMESTAMP
          WHERE festivo_colombia.fuente <> 'manual'
          RETURNING fecha
        `,
        [holiday.date, holiday.name]
      );
      importedCount += result.rowCount;
    }
    await writeAudit(
      client,
      req,
      'Importar festivos colombianos',
      `${year} - ${importedCount} festivo(s) sincronizado(s), ${removedResult.rowCount} obsoleto(s) eliminado(s) desde Nager.Date`
    );
    await client.query('COMMIT');
    return redirectToYear(
      res,
      year,
      'success',
      `Se sincronizaron ${importedCount} festivo(s) nacionales y se eliminaron ${removedResult.rowCount} registro(s) obsoleto(s). Los ajustes manuales se conservaron.`
    );
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo importación de festivos:', rollbackError);
      }
    }
    console.error('Error importando festivos colombianos:', error);
    return redirectToYear(
      res,
      year,
      'error',
      'No fue posible importar los festivos. Revisa la conexión con Nager.Date e inténtalo nuevamente.'
    );
  } finally {
    if (client) client.release();
  }
});

router.post('/crear', async (req, res) => {
  const date = sanitizeText(req.body?.fecha);
  const name = sanitizeText(req.body?.nombre);
  const year = parseHolidayYear(date.slice(0, 4)) || new Date().getFullYear();
  if (!isValidDateOnly(date) || !parseHolidayYear(date.slice(0, 4)) || !name || name.length > 150) {
    return redirectToYear(
      res,
      year,
      'error',
      'Indica una fecha válida y un nombre de hasta 150 caracteres.'
    );
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO festivo_colombia (fecha, nombre, fuente)
        VALUES ($1::date, $2, 'manual')
        ON CONFLICT (fecha) DO UPDATE
        SET nombre = EXCLUDED.nombre,
            fuente = 'manual',
            fecha_modificacion = CURRENT_TIMESTAMP
      `,
      [date, name]
    );
    await writeAudit(client, req, 'Configurar festivo colombiano', `${date} - ${name}`);
    await client.query('COMMIT');
    return redirectToYear(res, year, 'success', 'Festivo guardado correctamente.');
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo registro de festivo:', rollbackError);
      }
    }
    console.error('Error guardando festivo colombiano:', error);
    return redirectToYear(res, year, 'error', 'No fue posible guardar el festivo.');
  } finally {
    if (client) client.release();
  }
});

router.post('/eliminar', async (req, res) => {
  const date = sanitizeText(req.body?.fecha);
  const year = parseHolidayYear(date.slice(0, 4)) || new Date().getFullYear();
  if (!isValidDateOnly(date)) {
    return redirectToYear(res, year, 'error', 'La fecha del festivo no es válida.');
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `DELETE FROM festivo_colombia
       WHERE fecha = $1::date
       RETURNING TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, nombre`,
      [date]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return redirectToYear(res, year, 'error', 'El festivo seleccionado ya no existe.');
    }
    await writeAudit(
      client,
      req,
      'Eliminar festivo colombiano',
      `${result.rows[0].fecha} - ${result.rows[0].nombre}`
    );
    await client.query('COMMIT');
    return redirectToYear(res, year, 'success', 'Festivo eliminado correctamente.');
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error revirtiendo eliminación de festivo:', rollbackError);
      }
    }
    console.error('Error eliminando festivo colombiano:', error);
    return redirectToYear(res, year, 'error', 'No fue posible eliminar el festivo.');
  } finally {
    if (client) client.release();
  }
});

module.exports = router;
