const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const menuPath = path.resolve(__dirname, '../../../src/libs/menu.js');
const dbPath = path.resolve(__dirname, '../../../src/libs/db.js');

function loadMenuModule(queryImpl) {
  const originalDb = require.cache[dbPath];

  delete require.cache[menuPath];
  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: queryImpl,
    },
  };

  return {
    ...require(menuPath),
    restore() {
      if (originalDb) {
        require.cache[dbPath] = originalDb;
      } else {
        delete require.cache[dbPath];
      }
      delete require.cache[menuPath];
    },
  };
}

test('getMenuForRoles returns empty menu for missing roles', async () => {
  const loaded = loadMenuModule(async () => ({ rows: [] }));

  try {
    const result = await loaded.getMenuForRoles([]);

    assert.deepEqual(result, {
      primaryLinks: [],
      secondaryGroups: [],
      accountLinks: [],
    });
  } finally {
    loaded.restore();
  }
});

test('getMenuForRoles builds menu by section and parent-child hierarchy', async () => {
  const loaded = loadMenuModule(async () => ({
    rows: [
      {
        id: 1,
        parent_id: null,
        section: 'primary',
        label: 'Inicio',
        route: '/milab/inicio',
        icon: 'bi-house-door',
        order_index: 1,
      },
      {
        id: 2,
        parent_id: null,
        section: 'secondary',
        label: 'Administracion',
        route: null,
        icon: 'bi-sliders',
        order_index: 2,
      },
      {
        id: 3,
        parent_id: 2,
        section: 'secondary',
        label: 'Sanciones',
        route: '/milab/api/get_list_multas',
        icon: 'bi-shield-exclamation',
        order_index: 1,
      },
      {
        id: 4,
        parent_id: null,
        section: 'account',
        label: 'Perfil',
        route: '/milab/api/profile',
        icon: 'bi-person-circle',
        order_index: 1,
      },
    ],
  }));

  try {
    const result = await loaded.getMenuForRoles(['coordinador']);

    assert.equal(result.primaryLinks.length, 1);
    assert.equal(result.primaryLinks[0].href, '/milab/inicio');

    assert.equal(result.secondaryGroups.length, 1);
    assert.equal(result.secondaryGroups[0].title, 'Administracion');
    assert.equal(result.secondaryGroups[0].items.length, 1);
    assert.equal(result.secondaryGroups[0].items[0].href, '/milab/api/get_list_multas');

    assert.equal(result.accountLinks.length, 1);
    assert.equal(result.accountLinks[0].href, '/milab/api/profile');
  } finally {
    loaded.restore();
  }
});

test('getMenuForRoles deduplicates repeated rows by id', async () => {
  const loaded = loadMenuModule(async () => ({
    rows: [
      {
        id: 1,
        parent_id: null,
        section: 'primary',
        label: 'Inicio',
        route: '/milab/inicio',
        icon: 'bi-house-door',
        order_index: 1,
      },
      {
        id: 1,
        parent_id: null,
        section: 'primary',
        label: 'Inicio',
        route: '/milab/inicio',
        icon: 'bi-house-door',
        order_index: 1,
      },
    ],
  }));

  try {
    const result = await loaded.getMenuForRoles(['admin']);

    assert.equal(result.primaryLinks.length, 1);
    assert.equal(result.primaryLinks[0].label, 'Inicio');
  } finally {
    loaded.restore();
  }
});
