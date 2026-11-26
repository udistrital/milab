const pool = require('./db');

function isValidDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

async function findColombianHoliday(date, client = pool) {
  if (!isValidDateOnly(date)) {
    return null;
  }

  const result = await client.query(
    `
      SELECT TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, nombre
      FROM festivo_colombia
      WHERE fecha = $1::date
      LIMIT 1
    `,
    [date]
  );

  return result.rows[0] || null;
}

async function fetchColombianHolidaysBetween(startDate, endDate, client = pool) {
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
    return [];
  }

  const result = await client.query(
    `
      SELECT TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha, nombre
      FROM festivo_colombia
      WHERE fecha BETWEEN $1::date AND $2::date
      ORDER BY fecha
    `,
    [startDate, endDate]
  );

  return result.rows || [];
}

function filterColombianHolidaySchedules(rows, holidays) {
  const holidayDates = new Set((holidays || []).map((holiday) => holiday.fecha));
  return (rows || []).filter((row) => !holidayDates.has(row.fecha));
}

module.exports = {
  fetchColombianHolidaysBetween,
  filterColombianHolidaySchedules,
  findColombianHoliday,
  isValidDateOnly,
};
