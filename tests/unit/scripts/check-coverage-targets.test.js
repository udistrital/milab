const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCoverageRow,
  verifyCoverageTargets,
} = require('../../../scripts/ci/check-coverage-targets');

test('coverage row parser accepts Node 20 and current Node test report formats', () => {
  const node20 = '# src/public/js/coordinator-autocomplete.js | 100.00 | 90.91 | 100.00 |';
  const currentNode = 'ℹ    coordinator-autocomplete.js      | 100.00 |    92.31 |  100.00 |';
  const route = '# src/milab_routes.js | 100.00 | 100.00 | 100.00 |';

  assert.deepEqual(parseCoverageRow(node20, 'src/public/js/coordinator-autocomplete.js'), {
    lines: 100,
    branches: 90.91,
  });
  assert.deepEqual(parseCoverageRow(currentNode, 'src/public/js/coordinator-autocomplete.js'), {
    lines: 100,
    branches: 92.31,
  });
  assert.deepEqual(parseCoverageRow(route, 'src/milab_routes.js'), {
    lines: 100,
    branches: 100,
  });
});

test('coverage targets accept browser and route modules and report missing rows', () => {
  const output = [
    '# src/public/js/coordinator-autocomplete.js | 100.00 | 90.91 | 100.00 |',
    '# src/public/js/inventory-preview.js | 100.00 | 95.83 | 100.00 |',
    '# src/milab_routes.js | 100.00 | 100.00 | 100.00 |',
  ].join('\n');
  const targets = [
    { file: 'src/public/js/coordinator-autocomplete.js', lines: 95, branches: 90 },
    { file: 'src/public/js/inventory-preview.js', lines: 95, branches: 90 },
    { file: 'src/milab_routes.js', lines: 95, branches: 90 },
  ];

  assert.equal(verifyCoverageTargets(output, targets).length, 3);
  assert.throws(
    () => verifyCoverageTargets(output, [{ ...targets[0], file: 'src/public/js/missing.js' }]),
    /Expected one coverage row for src\/public\/js\/missing\.js, found 0/
  );
});

test('coverage targets fail when line or branch coverage drops below the minimum', () => {
  const output = '# src/public/js/inventory-preview.js | 94.99 | 89.99 | 100.00 |';

  assert.throws(
    () =>
      verifyCoverageTargets(output, [
        { file: 'src/public/js/inventory-preview.js', lines: 95, branches: 90 },
      ]),
    /coverage is 94\.99% lines and 89\.99% branches; required minimum is 95% lines and 90% branches/
  );
});

test('coverage targets can enforce line coverage without a branch threshold', () => {
  const output = '# src/libs/user-identity.js | 80.00 | 46.67 | 100.00 |';

  assert.equal(
    verifyCoverageTargets(output, [{ file: 'src/libs/user-identity.js', lines: 80 }])[0].actual
      .lines,
    80
  );
  assert.throws(
    () =>
      verifyCoverageTargets('# src/libs/user-identity.js | 79.99 | 46.67 | 100.00 |', [
        { file: 'src/libs/user-identity.js', lines: 80 },
      ]),
    /coverage is 79\.99% lines; required minimum is 80% lines/
  );
});
