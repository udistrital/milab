const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');

const repositoryRoot = path.resolve(__dirname, '../..');
const testFiles = [
  'tests/unit/libs/coordinator-autocomplete.test.js',
  'tests/unit/libs/inventory-preview.test.js',
  'tests/unit/libs/multa-config.test.js',
  'tests/unit/libs/prestamos-module-access.test.js',
  'tests/unit/libs/user-identity.test.js',
  'tests/integration/app-route-composition.test.js',
];
const coverageTargets = [
  { file: 'src/public/js/coordinator-autocomplete.js', lines: 95, branches: 90 },
  { file: 'src/public/js/inventory-preview.js', lines: 95, branches: 90 },
  { file: 'src/milab_routes.js', lines: 95, branches: 90 },
  { file: 'src/libs/prestamos-module-access.js', lines: 80 },
  { file: 'src/libs/user-identity.js', lines: 80 },
  { file: 'src/libs/multa-config.js', lines: 80 },
];

function parseCoverageRow(output, file) {
  const basename = path.basename(file);
  const rows = stripVTControlCharacters(output)
    .split(/\r?\n/)
    .filter((line) => line.includes(basename) && line.includes('|'));

  if (rows.length !== 1) {
    throw new Error(`Expected one coverage row for ${file}, found ${rows.length}.`);
  }

  const columns = rows[0].split('|').map((column) => column.trim());
  const lineCoverage = Number(columns[1]?.replace('%', ''));
  const branchCoverage = Number(columns[2]?.replace('%', ''));

  if (!Number.isFinite(lineCoverage) || !Number.isFinite(branchCoverage)) {
    throw new Error(`Coverage report has invalid percentages for ${file}.`);
  }

  return { lines: lineCoverage, branches: branchCoverage };
}

function verifyCoverageTargets(output, targets = coverageTargets) {
  return targets.map((target) => {
    const actual = parseCoverageRow(output, target.file);
    const requiresBranchCoverage = Number.isFinite(target.branches);
    if (
      actual.lines < target.lines ||
      (requiresBranchCoverage && actual.branches < target.branches)
    ) {
      const actualCoverage = `${actual.lines.toFixed(2)}% lines${
        requiresBranchCoverage ? ` and ${actual.branches.toFixed(2)}% branches` : ''
      }`;
      const requiredCoverage = `${target.lines}% lines${
        requiresBranchCoverage ? ` and ${target.branches}% branches` : ''
      }`;
      throw new Error(
        `${target.file} coverage is ${actualCoverage}; required minimum is ${requiredCoverage}.`
      );
    }
    return { ...target, actual };
  });
}

function run() {
  const result = spawnSync(
    process.execPath,
    ['--experimental-test-coverage', '--test', '--test-concurrency=1', ...testFiles],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
    }
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    return;
  }

  for (const target of verifyCoverageTargets(result.stdout)) {
    const lineSummary =
      `${target.file} has ${target.actual.lines.toFixed(2)}% line coverage ` +
      `(minimum ${target.lines}%)`;
    const branchSummary = Number.isFinite(target.branches)
      ? ` and ${target.actual.branches.toFixed(2)}% branch coverage ` +
        `(minimum ${target.branches}%)`
      : '';
    console.log(`Coverage target met: ${lineSummary}${branchSummary}.`);
  }
}

if (require.main === module) {
  run();
}

module.exports = { parseCoverageRow, verifyCoverageTargets };
