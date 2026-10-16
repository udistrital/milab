const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { stripVTControlCharacters } = require('node:util');

const repositoryRoot = path.resolve(__dirname, '../..');
const testFiles = [
  'tests/unit/libs/coordinator-autocomplete.test.js',
  'tests/unit/libs/inventory-preview.test.js',
  'tests/integration/app-route-composition.test.js',
];
const coverageTargets = [
  { file: 'src/public/js/coordinator-autocomplete.js', lines: 95, branches: 90 },
  { file: 'src/public/js/inventory-preview.js', lines: 95, branches: 90 },
  { file: 'src/milab_routes.js', lines: 95, branches: 90 },
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
    if (actual.lines < target.lines || actual.branches < target.branches) {
      throw new Error(
        `${target.file} coverage is ${actual.lines.toFixed(2)}% lines and ` +
          `${actual.branches.toFixed(2)}% branches; required minimum is ` +
          `${target.lines}% lines and ${target.branches}% branches.`
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
    console.log(
      `Coverage target met: ${target.file} has ${target.actual.lines.toFixed(2)}% line ` +
        `coverage (minimum ${target.lines}%) and ${target.actual.branches.toFixed(2)}% ` +
        `branch coverage (minimum ${target.branches}%).`
    );
  }
}

if (require.main === module) {
  run();
}

module.exports = { parseCoverageRow, verifyCoverageTargets };
