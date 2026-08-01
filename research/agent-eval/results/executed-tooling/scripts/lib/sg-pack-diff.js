'use strict';

/* Pure structural diff and derivation-impact helpers. */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function changedPaths(a, b, prefix = '') {
  const out = [];
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (!isObject(a) || !isObject(b)) {
    out.push(prefix || '(value)');
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(a, key)) out.push(`${current} (added)`);
    else if (!Object.prototype.hasOwnProperty.call(b, key)) out.push(`${current} (removed)`);
    else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      if (isObject(a[key]) && isObject(b[key])) out.push(...changedPaths(a[key], b[key], current));
      else out.push(current);
    }
  }
  return out;
}

function diffRecordMap(oldMap, newMap) {
  const oldValue = oldMap || {};
  const newValue = newMap || {};
  const oldKeys = Object.keys(oldValue);
  const newKeys = Object.keys(newValue);
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const added = newKeys.filter((key) => !has(oldValue, key));
  const removed = oldKeys.filter((key) => !has(newValue, key));
  const changed = [];
  for (const key of newKeys) {
    if (!Object.prototype.hasOwnProperty.call(oldValue, key)) continue;
    const fields = changedPaths(oldValue[key], newValue[key]);
    if (fields.length) changed.push({ id: key, fields });
  }
  return { added, removed, changed };
}

function relationKey(relation) {
  if (relation && typeof relation.id === 'string' && relation.id) return `id:${relation.id}`;
  const scope = Array.isArray(relation && relation.scope) ? [...new Set(relation.scope)].sort().join('|') : '*';
  return `${relation && relation.a}::${relation && relation.b}::${relation && relation.type}::scope=${scope}`;
}

function recordMapWithOccurrences(records, keyOf) {
  const out = new Map();
  const seen = new Map();
  for (const record of records || []) {
    const base = keyOf(record);
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    out.set(occurrence === 1 ? base : `${base}#${occurrence}`, record);
  }
  return out;
}

function diffRelations(oldRelations, newRelations) {
  const oldMap = recordMapWithOccurrences(oldRelations, relationKey);
  const newMap = recordMapWithOccurrences(newRelations, relationKey);
  const added = [...newMap.keys()].filter((key) => !oldMap.has(key));
  const removed = [...oldMap.keys()].filter((key) => !newMap.has(key));
  const changed = [];
  for (const key of newMap.keys()) {
    if (!oldMap.has(key)) continue;
    const fields = changedPaths(oldMap.get(key), newMap.get(key));
    if (fields.length) changed.push({ id: key, fields });
  }
  return { added, removed, changed };
}

function stageMap(stages) {
  const out = Object.create(null);
  const seen = Object.create(null);
  (stages || []).forEach((stage, index) => {
    const base = stage && (stage.key || stage.id) || `#${index}`;
    seen[base] = (seen[base] || 0) + 1;
    const key = seen[base] === 1 ? base : `${base}#${seen[base]}`;
    out[key] = stage;
  });
  return out;
}

function stageOrder(stages) {
  return (stages || []).map((stage, index) => stage && (stage.key || stage.id) || `#${index}`);
}

function stageOrderChanged(oldStages, newStages) {
  const oldOrder = stageOrder(oldStages);
  const newOrder = stageOrder(newStages);
  if (oldOrder.length !== newOrder.length) return false;
  if (JSON.stringify([...oldOrder].sort()) !== JSON.stringify([...newOrder].sort())) return false;
  return oldOrder.some((key, index) => key !== newOrder[index]);
}

function diffPairs(oldPairs, newPairs) {
  const normalize = (pairs) => new Set((pairs || []).map((pair) => JSON.stringify([...pair].sort())));
  const oldSet = normalize(oldPairs);
  const newSet = normalize(newPairs);
  return {
    added: [...newSet].filter((value) => !oldSet.has(value)),
    removed: [...oldSet].filter((value) => !newSet.has(value)),
  };
}

function count(section) {
  return (section.added ? section.added.length : 0) +
    (section.removed ? section.removed.length : 0) +
    (section.changed ? section.changed.length : 0);
}

function matchSegments(sourceSegments, changedSegments) {
  if (changedSegments.length < sourceSegments.length) {
    for (let index = 0; index < changedSegments.length; index += 1) {
      if (sourceSegments[index] !== '*' && sourceSegments[index] !== changedSegments[index]) return false;
    }
    return true;
  }
  for (let index = 0; index < sourceSegments.length; index += 1) {
    if (sourceSegments[index] !== '*' && sourceSegments[index] !== changedSegments[index]) return false;
  }
  return true;
}

function sourceMatches(sourcePath, section, id, field) {
  const segments = String(sourcePath || '').split('.');
  if (segments[0] !== section) return false;
  if (segments.length === 1) return true;
  const changed = [];
  if (id !== undefined && id !== null) changed.push(String(id));
  if (field) changed.push(...String(field).split('.'));
  return matchSegments(segments.slice(1), changed);
}

function impactedDerivations(pack, section, id, field) {
  const hits = [];
  for (const [name, derivation] of Object.entries((pack && pack.derivations) || {})) {
    const sources = [derivation.source].concat(derivation.alsoTouches || []);
    if (sources.some((source) => sourceMatches(source, section, id, field))) hits.push({ name, ...derivation });
  }
  return hits;
}

function collectImpacts(pack, report, oldPack, newPack) {
  const impacts = new Map();
  const add = (derivation, trigger) => {
    if (!impacts.has(derivation.name)) {
      impacts.set(derivation.name, {
        name: derivation.name,
        kind: derivation.kind,
        note: derivation.note,
        consumers: derivation.consumers,
        triggers: new Set(),
      });
    }
    impacts.get(derivation.name).triggers.add(trigger);
  };
  const feedRecordSection = (section, label) => {
    for (const id of report[section].added) {
      for (const derivation of impactedDerivations(pack, section, id)) add(derivation, `+${label} ${id}`);
    }
    for (const id of report[section].removed) {
      for (const derivation of impactedDerivations(pack, section, id)) add(derivation, `-${label} ${id}`);
    }
    for (const change of report[section].changed) {
      const fields = change.fields.map((field) => field.replace(/ \(added\)| \(removed\)/g, ''));
      for (const field of [...new Set(fields)]) {
        for (const derivation of impactedDerivations(pack, section, change.id, field)) {
          add(derivation, `~${label} ${change.id}.${field}`);
        }
      }
    }
  };

  feedRecordSection('entities', 'entity');
  feedRecordSection('aliases', 'alias');
  if (count(report.relations)) for (const derivation of impactedDerivations(pack, 'relations')) add(derivation, 'relations changed');
  feedRecordSection('contents', 'content');
  if (count(report.stages) || report.stages.orderChanged) {
    for (const derivation of impactedDerivations(pack, 'stages')) add(derivation, report.stages.orderChanged ? 'stages order changed' : 'stages changed');
  }

  const oldDomain = oldPack.domain || {};
  const newDomain = newPack.domain || {};
  if (JSON.stringify(oldDomain) !== JSON.stringify(newDomain)) {
    const paths = changedPaths(oldDomain, newDomain).map((field) => field.replace(/ \(added\)| \(removed\)/g, ''));
    for (const field of paths) {
      for (const derivation of impactedDerivations(pack, 'domain', undefined, field)) add(derivation, `~domain.${field}`);
    }
  }

  for (const change of report.derivations.changed) {
    add({ name: change.id, kind: 'meta', note: 'derivation definition changed', consumers: [] }, `~derivation ${change.id}`);
  }
  for (const section of ['assets', 'provenance', 'attributeTypes', 'relationTypes', 'heroRelTypes', 'kindNameFields', 'meta']) {
    if (count(report[section])) {
      for (const derivation of impactedDerivations(pack, section)) add(derivation, `${section} changed`);
    }
  }
  return [...impacts.values()].map((impact) => ({ ...impact, triggers: [...impact.triggers] }));
}

function buildDiff(oldPack, newPack, labels = {}) {
  const report = {
    old: labels.old || 'old',
    new: labels.new || 'new',
    entities: diffRecordMap(oldPack.entities, newPack.entities),
    relations: diffRelations(oldPack.relations, newPack.relations),
    aliases: diffRecordMap(oldPack.aliases, newPack.aliases),
    contents: diffRecordMap(oldPack.contents, newPack.contents),
    stages: diffRecordMap(stageMap(oldPack.stages), stageMap(newPack.stages)),
    sameAs: diffPairs(oldPack.sameAs, newPack.sameAs),
    derivations: diffRecordMap(oldPack.derivations, newPack.derivations),
    assets: diffRecordMap(oldPack.assets, newPack.assets),
    provenance: diffRecordMap(oldPack.provenance, newPack.provenance),
    attributeTypes: diffRecordMap(oldPack.attributeTypes, newPack.attributeTypes),
    relationTypes: diffRecordMap(oldPack.relationTypes, newPack.relationTypes),
    heroRelTypes: diffRecordMap(oldPack.heroRelTypes, newPack.heroRelTypes),
    kindNameFields: diffRecordMap(oldPack.kindNameFields, newPack.kindNameFields),
    domain: diffRecordMap(oldPack.domain, newPack.domain),
    meta: diffRecordMap(isObject(oldPack.meta) ? oldPack.meta : {}, isObject(newPack.meta) ? newPack.meta : {}),
  };
  const orderChanged = stageOrderChanged(oldPack.stages, newPack.stages);
  if (orderChanged) report.stages.orderChanged = true;
  report.derivationsImpacted = collectImpacts(newPack, report, oldPack, newPack);
  report.total = count(report.entities) + count(report.relations) + count(report.aliases) +
    count(report.contents) + count(report.stages) + (orderChanged ? 1 : 0) + report.sameAs.added.length + report.sameAs.removed.length +
    count(report.derivations) + count(report.assets) + count(report.provenance) +
    count(report.attributeTypes) + count(report.relationTypes) + count(report.heroRelTypes) +
    count(report.kindNameFields) + count(report.domain) + count(report.meta);
  return report;
}

module.exports = {
  isObject,
  changedPaths,
  diffRecordMap,
  diffRelations,
  diffPairs,
  count,
  sourceMatches,
  impactedDerivations,
  buildDiff,
};
