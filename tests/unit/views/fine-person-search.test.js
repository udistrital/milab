const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ejs = require('ejs');

const workspaceRoot = path.resolve(__dirname, '../../../');
const partialPath = path.join(workspaceRoot, 'src/views/partials/fine-person-search.ejs');

function renderStudentSearch() {
  return ejs.renderFile(partialPath, {
    csrfToken: 'csrf-token',
    cspNonce: 'test-nonce',
    searchConfig: {
      title: 'Sanciones de estudiantes',
      description: 'Consulta de sanciones',
      searchUrl: '/milab/api/get-info-multa',
      loadingMessage: 'Buscando',
      studentSearch: true,
    },
  });
}

test('fine person search lists código before documento in the search type select', async () => {
  const html = await renderStudentSearch();
  const options = [...html.matchAll(/<option value="(codigo|documento)"/g)].map(
    (match) => match[1]
  );

  assert.deepEqual(options, ['codigo', 'documento']);
});

test('fine person search preselects código institucional with a matching label and placeholder', async () => {
  const html = await renderStudentSearch();

  assert.match(html, /<option value="codigo" selected>Código institucional<\/option>/);
  assert.doesNotMatch(html, /<option value="documento" selected>/);
  assert.match(html, /id="fineSearchLabel">Código institucional<\/label>/);
  assert.match(html, /placeholder="Ej: 20241001"/);
});
