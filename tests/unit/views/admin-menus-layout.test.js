const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const viewPath = path.join(repoRoot, 'src/views/home/admin_menus.ejs');
const stylesPath = path.join(repoRoot, 'src/public/css/styles.css');

test('admin menu permission grid scrolls responsively without hiding role columns', () => {
  const template = fs.readFileSync(viewPath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(template, /<main class="container app-page-shell admin-menus-page">/);
  assert.match(template, /class="table-responsive admin-permissions-table"/);
  assert.match(
    template,
    /roles\.forEach\(function\(role\) \{ %>\s*<th class="text-center admin-menu-role-heading" title="<%= role\.name %>">\s*<%= role\.name %>\s*<\/th>/s
  );
  assert.match(template, /class="form-check-input permission-toggle"/);

  const scopedStart = styles.indexOf('body.app-shell .admin-menus-page > *');
  const scopedEnd = styles.indexOf('body.app-shell .table-responsive', scopedStart);
  const scopedStyles = styles.slice(scopedStart, scopedEnd);

  assert.notEqual(scopedStart, -1);
  assert.notEqual(scopedEnd, -1);
  assert.match(
    scopedStyles,
    /body\.app-shell \.admin-menus-page \.admin-permissions-table\s*\{[^}]*overflow-x:\s*auto;/s
  );
  assert.match(
    scopedStyles,
    /body\.app-shell \.admin-menus-page \.admin-permissions-table > \.admin-permissions-grid\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*100%;/s
  );
  assert.match(scopedStyles, /min-width:\s*0;/);
  assert.match(scopedStyles, /max-width:\s*100%;/);
  assert.doesNotMatch(scopedStyles, /display:\s*none|visibility:\s*hidden/);
});
