const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const viewsPath = path.resolve(__dirname, '../../../src/views');

function findEjsFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findEjsFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.ejs') ? [entryPath] : [];
  });
}

test('all EJS pages and partials compile', () => {
  const templates = findEjsFiles(viewsPath);
  assert.ok(templates.length > 0, 'expected to find application EJS templates');

  templates.forEach((templatePath) => {
    assert.doesNotThrow(
      () => ejs.compile(fs.readFileSync(templatePath, 'utf8'), { filename: templatePath }),
      `EJS syntax error in ${path.relative(viewsPath, templatePath)}`
    );
  });
});
