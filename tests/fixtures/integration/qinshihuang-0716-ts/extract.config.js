'use strict';

const LIB_DIR = __dirname;
const ID_BY_NAME = {
  '嬴政': 'yingzheng',
  '吕不韦': 'lvbuwei',
  '嫪毐': 'laoai',
  '李斯': 'lisi',
  '王翦': 'wangjian',
  '秦始皇': 'qinshihuang',
  '蒙恬': 'mengtian',
  '冯去疾': 'fengquji',
  '王绾': 'wangwan',
  '程邈': 'chengmiao',
  '任嚣': 'renxiao',
  '扶苏': 'fusu',
  '淳于越': 'chunyuyue',
  '赵高': 'zhaogao',
  '胡亥': 'huhai',
};

const STAGE_KEY_BY_NAME = {
  '平定内乱': 'pingdingneiluan',
  '一统天下': 'yitongtianxia',
  '创立帝制': 'chuanglidizhi',
  '书同文': 'shutongwen',
  '北击匈奴': 'beijixiongnu',
  '焚书坑儒': 'fenshukengru',
  '沙丘之变': 'shaqiuzhibian',
};

const PAIRWISE_TYPES = {
  family: { label: '宗亲', color: 'var(--rel-family)', dimension: 'pairwise' },
  ruler: { label: '君臣', color: 'var(--rel-ruler)', dimension: 'pairwise' },
  ally: { label: '同僚', color: 'var(--rel-ally)', dimension: 'pairwise' },
  enemy: { label: '对立', color: 'var(--rel-enemy)', dimension: 'pairwise' },
};

const HERO_TYPES = {
  ruler: { label: '君臣', color: 'var(--rel-ruler)', dimension: 'hero-radial' },
  family: { label: '宗亲', color: 'var(--rel-family)', dimension: 'hero-radial' },
  enemy: { label: '对立', color: 'var(--rel-enemy)', dimension: 'hero-radial' },
};

function idFor(name) {
  const id = ID_BY_NAME[name];
  if (!id) throw new Error(`Qinshihuang fixture has no stable id for ${JSON.stringify(name)}`);
  return id;
}

function provenance(origin, fetchedAt, note) {
  return {
    origin,
    sourceUrl: null,
    fetchedAt,
    confidence: 1,
    note,
  };
}

function buildPack(defaults) {
  const events = defaults.events;
  if (!Array.isArray(events) || events.length !== 7) {
    throw new Error(`Expected 7 event defaults, got ${Array.isArray(events) ? events.length : 'non-array'}`);
  }

  const entities = {};
  const aliases = {};
  const relations = [];
  const relationKeys = new Set();
  const stages = [];

  for (const event of events) {
    const stageEntities = [];
    const overlay = {};
    const stageRelations = [];

    for (const person of event.people || []) {
      const id = idFor(person.name);
      if (!entities[id]) {
        entities[id] = { name: person.name, kind: 'person', avatar: person.avatar };
      } else if (entities[id].avatar !== person.avatar) {
        throw new Error(`Avatar changed for ${id}: ${entities[id].avatar} -> ${person.avatar}`);
      }
      aliases[person.name] = id;
      stageEntities.push(id);

      const current = {
        role: person.role,
        deed: person.deed,
        impact: person.impact,
      };
      if (person.big === true) current.big = true;
      if (person.rel !== undefined) current.rel = person.rel;
      overlay[id] = current;
    }

    for (const link of event.links || []) {
      const a = idFor(link.a);
      const b = idFor(link.b);
      const relationKey = [a, b, link.type, link.label || ''].join('::');
      if (!relationKeys.has(relationKey)) {
        relationKeys.add(relationKey);
        relations.push({ a, b, type: link.type, label: link.label });
      }
      stageRelations.push({ a, b });
    }

    const stageKey = STAGE_KEY_BY_NAME[event.name];
    if (!stageKey) throw new Error(`Qinshihuang fixture has no stable stage key for ${JSON.stringify(event.name)}`);
    stages.push({
      key: stageKey,
      name: event.name,
      year: event.year,
      period: event.period,
      summary: event.summary,
      summaryShort: event.summaryShort,
      image: event.image,
      entities: stageEntities,
      relations: stageRelations,
      overlay,
    });
  }

  const fetchedAt = '2026-07-27';
  const baselineNote = 'Baseline extracted from the authorized example HTML fixture';
  const pack = {
    entities,
    aliases,
    relationTypes: PAIRWISE_TYPES,
    heroRelTypes: HERO_TYPES,
    relations,
    stages,
    domain: {},
    sameAs: [['yingzheng', 'qinshihuang']],
    derivations: {
      eventsNameLookupRebuild: {
        kind: 'lookup-rebuild',
        source: 'entities.*.name',
        consumers: ['__fromPack'],
        note: 'Stages reference stable ids; __fromPack restores the legacy Chinese-name event shape from entities and overlays.',
      },
    },
    provenance: {
      entities: Object.fromEntries(Object.keys(entities).map((id) => [
        id,
        provenance('template-html-contents', fetchedAt, baselineNote),
      ])),
      relations: Object.fromEntries(relations.map((relation) => [
        `${relation.a}::${relation.b}::${relation.type}::scope=*`,
        provenance('template-html-contents', fetchedAt, baselineNote),
      ])),
    },
  };

  return pack;
}

function domainChecks(pack) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (Object.keys(pack.entities || {}).length !== 15) fail('expected 15 entities');
  if ((pack.relations || []).length !== 11) fail('expected 11 master relations');
  if ((pack.stages || []).length !== 7) fail('expected 7 stages');
  if (Object.keys(pack.assets || {}).length !== 21) fail('expected 21 registered assets');

  const relationKeys = new Set((pack.relations || []).map((r) => `${r.a}::${r.b}`));
  for (const stage of pack.stages || []) {
    const members = new Set(stage.entities || []);
    for (const ref of stage.relations || []) {
      if (!relationKeys.has(`${ref.a}::${ref.b}`)) fail(`${stage.key}: stage relation is not in master relations`);
      if (!members.has(ref.a) || !members.has(ref.b)) fail(`${stage.key}: stage relation endpoint is outside stage entities`);
    }
    const big = Object.values(stage.overlay || {}).filter((value) => value.big === true);
    if (big.length !== 1) fail(`${stage.key}: expected exactly one big entity`);
    for (const [id, value] of Object.entries(stage.overlay || {})) {
      if (!value.big && !Object.prototype.hasOwnProperty.call(pack.heroRelTypes || {}, value.rel)) {
        fail(`${stage.key}.${id}: overlay.rel is not registered in heroRelTypes`);
      }
    }
  }
  for (const [pathName, asset] of Object.entries(pack.assets || {})) {
    if (!asset.exists || !asset.hash) fail(`${pathName}: asset must exist and have a hash`);
  }

  return { errors, warnings: [] };
}

module.exports = {
  libId: 'qinshihuang-0716-ts',
  libDir: LIB_DIR,
  engineFile: 'lib/src/qinshihuang.js',
  globalName: 'QinShihuangLibrary',
  literals: [{
    key: 'events',
    file: 'lib/examples/qinshihuang.html',
    pattern: /<script id="sg-event-data" type="application\/json">/,
    json: true,
  }],
  meta: {
    title: '秦始皇 · 七大事件与人物关系',
    hero: 'yingzheng',
    source: 'Authorized example HTML fixture (#sg-event-data)',
    fetchedAt: '2026-07-27',
    assetBase: '../assets/',
  },
  buildPack,
  equivalence: [{ lit: 'events', from: 'events' }],
  domainChecks,
  domainSchema: {
    type: 'object',
    description: 'This library has no additional domain collections; event data is normalized into stages.',
    additionalProperties: true,
  },
};
