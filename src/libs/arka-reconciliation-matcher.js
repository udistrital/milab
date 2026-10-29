const { normalizeIdentifier } = require('./inventario-import');

function addToIndex(index, value, item) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return;

  const matches = index.get(normalized) || [];
  matches.push(item);
  index.set(normalized, matches);
}

function buildLocalIndexes(inventoryItems) {
  const identifiers = new Map();
  const plates = new Map();
  const serials = new Map();

  inventoryItems.forEach((item) => {
    item.arkaIds.forEach((value) => addToIndex(identifiers, value, item));
    item.plates.forEach((value) => addToIndex(plates, value, item));
    addToIndex(plates, item.placa, item);
    (item.series || []).forEach((value) => addToIndex(serials, value, item));
    addToIndex(serials, item.serie, item);
  });

  return { identifiers, plates, serials };
}

function uniqueItems(items) {
  return Array.from(new Map(items.map((item) => [item.inventarioId, item])).values());
}

function findCandidates(indexes, values) {
  const matches = [];
  values.forEach((value) => {
    const normalized = normalizeIdentifier(value);
    if (normalized) {
      matches.push(...(indexes.get(normalized) || []));
    }
  });
  return uniqueItems(matches);
}

function resolveMatch(arkaItem, indexes) {
  const identifierMatches = findCandidates(indexes.identifiers, [arkaItem.arkaId]);
  const plateMatches = findCandidates(indexes.plates, [arkaItem.placa]);
  const primaryMatches = uniqueItems([...identifierMatches, ...plateMatches]);

  if (primaryMatches.length > 1) {
    return {
      candidates: primaryMatches,
      item: null,
      matchType: identifierMatches.length ? 'id_arka' : 'placa',
      status: 'ambiguo',
    };
  }

  if (primaryMatches.length === 1) {
    return {
      candidates: primaryMatches,
      item: primaryMatches[0],
      matchType: identifierMatches.length ? 'id_arka' : 'placa',
      status: null,
    };
  }

  const serialMatches = findCandidates(indexes.serials, [arkaItem.serie]);
  if (serialMatches.length === 1) {
    return {
      candidates: serialMatches,
      item: serialMatches[0],
      matchType: 'serie',
      status: null,
    };
  }
  if (serialMatches.length > 1) {
    return {
      candidates: serialMatches,
      item: null,
      matchType: 'serie',
      status: 'ambiguo',
    };
  }

  return { candidates: [], item: null, matchType: null, status: 'solo_arka' };
}

function buildAlertKey(row) {
  const ambiguousSuffix =
    row.status === 'ambiguo' && row.sourceIndex !== null && row.sourceIndex !== undefined
      ? `:ambiguo:${row.sourceIndex}`
      : '';
  if (row.arkaId) return `arka:id:${row.arkaId}${ambiguousSuffix}`;
  if (row.placa) return `arka:placa:${normalizeIdentifier(row.placa)}${ambiguousSuffix}`;
  if (row.serie) return `arka:serie:${normalizeIdentifier(row.serie)}${ambiguousSuffix}`;
  if (row.inventarioId) return `milab:inventario:${row.inventarioId}`;
  return `arka:fila:${row.sourceIndex}`;
}

function buildReconciliationSnapshot({ arkaItems, inventoryItems, ualIds }) {
  const indexes = buildLocalIndexes(inventoryItems);
  const matches = arkaItems.map((item) => resolveMatch(item, indexes));
  const matchedByInventory = new Map();

  matches.forEach((match, index) => {
    if (!match.item) return;
    const arkaIndexes = matchedByInventory.get(match.item.inventarioId) || [];
    arkaIndexes.push(index);
    matchedByInventory.set(match.item.inventarioId, arkaIndexes);
  });

  matchedByInventory.forEach((arkaIndexes, inventoryId) => {
    if (arkaIndexes.length < 2) return;
    arkaIndexes.forEach((index) => {
      const currentMatch = matches[index];
      currentMatch.status = 'ambiguo';
      currentMatch.candidates = [currentMatch.item];
      currentMatch.item = null;
    });
    matchedByInventory.delete(inventoryId);
  });

  const accountedInventoryIds = new Set();
  const details = matches.map((match, sourceIndex) => {
    match.candidates.forEach((candidate) => accountedInventoryIds.add(candidate.inventarioId));
    const arkaItem = arkaItems[sourceIndex];
    const matchedItem = match.item;
    const ualCandidates = [
      ...new Set(uniqueItems(match.candidates).map((candidate) => candidate.ualId)),
    ];
    const ualId =
      matchedItem?.ualId || (ualCandidates.length === 1 ? ualCandidates[0] : null) || null;

    return {
      arkaId: arkaItem.arkaId || null,
      arkaElementoActaId: arkaItem.elementoActaId || null,
      arkaPlaca: arkaItem.placa || '',
      arkaSerie: arkaItem.serie || '',
      arkaNombre: arkaItem.nombre || '',
      arkaMarca: arkaItem.marca || '',
      arkaValor: arkaItem.valor ?? null,
      sourceIndex: arkaItem.sourceIndex,
      inventarioId: matchedItem?.inventarioId || null,
      ualId,
      inventarioPlaca: matchedItem?.placa || '',
      inventarioSerie: matchedItem?.serie || '',
      inventarioNombre: matchedItem?.nombre || '',
      matchType: match.matchType,
      status: match.status || (matchedItem ? 'coincide' : 'solo_arka'),
    };
  });

  inventoryItems.forEach((item) => {
    if (accountedInventoryIds.has(item.inventarioId)) return;
    details.push({
      arkaId: null,
      arkaElementoActaId: null,
      arkaPlaca: '',
      arkaSerie: '',
      arkaNombre: '',
      arkaMarca: '',
      arkaValor: null,
      sourceIndex: null,
      inventarioId: item.inventarioId,
      ualId: item.ualId,
      inventarioPlaca: item.placa || '',
      inventarioSerie: item.serie || '',
      inventarioNombre: item.nombre || '',
      matchType: null,
      status: 'solo_milab',
    });
  });

  details.forEach((detail) => {
    if (detail.status !== 'coincide') {
      detail.alertKey = buildAlertKey(detail);
    }
  });

  const summaryByUal = new Map();
  ualIds.forEach((ualId) => {
    const localTotal = inventoryItems.filter((item) => item.ualId === ualId).length;
    const matchedTotal = details.filter(
      (detail) => detail.ualId === ualId && detail.status === 'coincide'
    ).length;
    summaryByUal.set(ualId, {
      arkaTotal: arkaItems.length,
      milabTotal: localTotal,
      matchedTotal,
      unmatchedTotal: arkaItems.length - matchedTotal + localTotal - matchedTotal,
    });
  });

  return { details, summaryByUal };
}

module.exports = {
  buildAlertKey,
  buildReconciliationSnapshot,
};
