const test = require('node:test');
const assert = require('node:assert/strict');
const {
  fetchColombianHolidays,
  findColombianHoliday,
  filterColombianHolidaySchedules,
  isValidDateOnly,
} = require('../../../src/libs/colombian-holidays');

test('Colombian holiday dates must be valid ISO calendar dates', () => {
  assert.equal(isValidDateOnly('2028-02-29'), true);
  assert.equal(isValidDateOnly('2026-02-29'), false);
  assert.equal(isValidDateOnly('2026-13-01'), false);
  assert.equal(isValidDateOnly('2026-1-01'), false);
});

test('schedule expansion omits rows on configured holidays only', () => {
  const rows = [
    { fecha: '2026-01-01', hora_inicio: '08:00' },
    { fecha: '2026-01-02', hora_inicio: '08:00' },
  ];
  assert.deepEqual(
    filterColombianHolidaySchedules(rows, [{ fecha: '2026-01-01', nombre: 'Año Nuevo' }]),
    [{ fecha: '2026-01-02', hora_inicio: '08:00' }]
  );
});

test('holiday lookup queries the existing holiday table only for valid dates', async () => {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ fecha: '2026-01-01', nombre: 'Año Nuevo' }] };
    },
  };

  assert.deepEqual(await findColombianHoliday('2026-02-30', client), null);
  assert.deepEqual(calls, []);
  assert.deepEqual(await findColombianHoliday('2026-01-01', client), {
    fecha: '2026-01-01',
    nombre: 'Año Nuevo',
  });
  assert.match(calls[0].sql, /FROM festivo_colombia/);
  assert.deepEqual(calls[0].params, ['2026-01-01']);
});

test('calendar holiday query returns labels for the existing national holiday records', async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      return { rows: [{ fecha: '2026-12-25', nombre: 'Navidad' }] };
    },
  };
  assert.deepEqual(await fetchColombianHolidays(client), [
    { fecha: '2026-12-25', nombre: 'Navidad' },
  ]);
  assert.match(calls[0], /FROM festivo_colombia/);
});
