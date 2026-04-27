const pool = require('./db');
const { normalizeRoles } = require('./roles');

async function getMenuForRoles(roles) {
  const normalizedRoles = normalizeRoles(roles);

  if (!normalizedRoles.length) {
    return {
      primaryLinks: [],
      secondaryGroups: [],
      accountLinks: [],
    };
  }

  const result = await pool.query(
    `
      SELECT
        mi.id,
        mi.parent_id,
        mi.section,
        mi.label,
        mi.route,
        mi.icon,
        mi.order_index
      FROM menu_items mi
      JOIN role_permissions rp
        ON rp.menu_item_id = mi.id
       AND rp.can_view = TRUE
      JOIN roles r
        ON r.id = rp.role_id
      WHERE r.name = ANY($1)
        AND mi.is_active = TRUE
      ORDER BY mi.section, mi.order_index, mi.label
    `,
    [normalizedRoles]
  );

  const items = result.rows || [];
  const byId = new Map();
  const childrenMap = new Map();

  items.forEach((item) => {
    if (byId.has(item.id)) return;
    byId.set(item.id, item);
    if (item.parent_id) {
      if (!childrenMap.has(item.parent_id)) {
        childrenMap.set(item.parent_id, []);
      }
      childrenMap.get(item.parent_id).push(item);
    }
  });

  const uniqueItems = Array.from(byId.values());

  const buildLink = (item) => ({
    label: item.label,
    href: item.route,
    icon: item.icon || 'bi-circle',
  });

  const primaryLinks = uniqueItems
    .filter((item) => item.section === 'primary' && !item.parent_id && item.route)
    .map(buildLink);

  const accountLinks = uniqueItems
    .filter((item) => item.section === 'account' && !item.parent_id && item.route)
    .map(buildLink);

  const secondaryGroups = uniqueItems
    .filter((item) => item.section === 'secondary' && !item.parent_id)
    .map((group) => {
      const groupItems = (childrenMap.get(group.id) || []).map(buildLink);
      if (!groupItems.length) return null;
      return {
        title: group.label,
        icon: group.icon || 'bi-folder',
        items: groupItems,
      };
    })
    .filter(Boolean);

  return {
    primaryLinks,
    secondaryGroups,
    accountLinks,
  };
}

module.exports = {
  getMenuForRoles,
};
