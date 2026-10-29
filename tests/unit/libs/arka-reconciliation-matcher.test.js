const test = require('node:test');
const assert = require('node:assert/strict');
const { buildReconciliationSnapshot } = require('../../../src/libs/arka-reconciliation-matcher');

test('matches ARKA ids and plates first, then uses a unique series as fallback', () => {
  const result = buildReconciliationSnapshot({
    arkaItems: [
      { sourceIndex: 0, arkaId: 500, placa: 'ARKA-001', serie: 'SER-001' },
      { sourceIndex: 1, arkaId: 501, placa: 'ARKA-002', serie: 'SER-002' },
      { sourceIndex: 2, arkaId: 502, placa: '', serie: 'SER-003' },
      { sourceIndex: 3, arkaId: 503, placa: 'ARKA-004', serie: 'SER-004' },
    ],
    inventoryItems: [
      {
        inventarioId: 1,
        ualId: 10,
        nombre: 'Microscopio',
        placa: 'ARKA-001',
        serie: 'SER-001',
        arkaIds: ['500'],
        plates: [],
      },
      {
        inventarioId: 2,
        ualId: 20,
        nombre: 'Balanza',
        placa: '',
        serie: 'SER-002',
        arkaIds: [],
        plates: ['ARKA-002'],
      },
      {
        inventarioId: 3,
        ualId: 10,
        nombre: 'Estereoscopio',
        placa: '',
        serie: 'SER-003',
        arkaIds: [],
        plates: [],
      },
      {
        inventarioId: 4,
        ualId: 10,
        nombre: 'Equipo local',
        placa: 'LOCAL-004',
        serie: 'SER-LOCAL',
        arkaIds: [],
        plates: [],
      },
    ],
    ualIds: [10, 20],
  });

  assert.deepEqual(
    result.details.slice(0, 4).map(({ status, matchType, ualId }) => ({
      status,
      matchType,
      ualId,
    })),
    [
      { status: 'coincide', matchType: 'id_arka', ualId: 10 },
      { status: 'coincide', matchType: 'placa', ualId: 20 },
      { status: 'coincide', matchType: 'serie', ualId: 10 },
      { status: 'solo_arka', matchType: null, ualId: null },
    ]
  );
  assert.equal(result.details[4].status, 'solo_milab');
  assert.deepEqual(result.summaryByUal.get(10), {
    arkaTotal: 4,
    milabTotal: 3,
    matchedTotal: 2,
    unmatchedTotal: 3,
  });
  assert.deepEqual(result.summaryByUal.get(20), {
    arkaTotal: 4,
    milabTotal: 1,
    matchedTotal: 1,
    unmatchedTotal: 3,
  });
});

test('classifies duplicate series as ambiguous and does not report candidate rows twice', () => {
  const result = buildReconciliationSnapshot({
    arkaItems: [{ sourceIndex: 0, arkaId: 10, serie: 'SER-001' }],
    inventoryItems: [
      {
        inventarioId: 1,
        ualId: 4,
        nombre: 'Equipo 1',
        serie: 'SER-001',
        arkaIds: [],
        plates: [],
      },
      {
        inventarioId: 2,
        ualId: 4,
        nombre: 'Equipo 2',
        serie: 'SER-001',
        arkaIds: [],
        plates: [],
      },
    ],
    ualIds: [4],
  });

  assert.equal(result.details.length, 1);
  assert.equal(result.details[0].status, 'ambiguo');
  assert.equal(result.details[0].ualId, 4);
  assert.equal(result.summaryByUal.get(4).matchedTotal, 0);
});

test('marks duplicate ARKA entries matching the same MiLab item as ambiguous', () => {
  const result = buildReconciliationSnapshot({
    arkaItems: [
      { sourceIndex: 0, arkaId: 10, placa: 'ARKA-001' },
      { sourceIndex: 1, arkaId: 10, placa: 'ARKA-001' },
    ],
    inventoryItems: [
      {
        inventarioId: 1,
        ualId: 4,
        nombre: 'Equipo 1',
        placa: 'ARKA-001',
        arkaIds: ['10'],
        plates: [],
      },
    ],
    ualIds: [4],
  });

  assert.deepEqual(
    result.details.map((detail) => detail.status),
    ['ambiguo', 'ambiguo']
  );
  assert.equal(result.summaryByUal.get(4).matchedTotal, 0);
});
