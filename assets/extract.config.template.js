'use strict';
/*
 * SG Data Pack extraction config template
 * Usage: node scripts/sg-data-pack extract <path/to/this.config.js>
 * Full guide: references/extraction-config.md
 */

const LIB_DIR = '/absolute/path/to/your-lib-ts'; // ← change to the library root

// const edgeKey = (e) => e.a + '::' + e.b + '::' + e.type + '::' + (e.label || '');

module.exports = {
  libId: 'your-lib-ts',
  libDir: LIB_DIR,
  engineFile: 'lib/src/your-lib.js',
  globalName: 'YourLibrary', // engine global name (global.X = {mount, create})

  // Default-data literal slicing (losslessness baseline). Pattern match end = expression start.
  literals: [
    { key: 'chars', pattern: /var chars = \(options && options\.chars\) \|\|/, ctx: { IMG: '../assets/' } },
    // { key: 'edges', pattern: /var edges = \(options && options\.edges\) \|\|/ },
    // { key: 'events', file: 'lib/examples/your.html', pattern: /<script id="sg-data" type="application\/json">/, json: true },
  ],

  meta: {
    title: 'Your library title',
    hero: 'core-entity-id (optional)',
    source: 'Embedded data from original case page (decomposition export)',
    fetchedAt: new Date().toISOString().slice(0, 10)
  },

  buildPack(defaults) {
    // ① Entity table (add kind; for Chinese-name-reference libraries, convert via a hand-written idMap first)
    const entities = {};
    for (const [id, c] of Object.entries(defaults.chars)) {
      entities[id] = Object.assign({ kind: 'person' }, c);
    }

    // ② Alias table: display name -> id (crawl-normalization entry point)
    const aliases = {};
    for (const [id, c] of Object.entries(defaults.chars)) aliases[c.name] = id;

    // ③ Relationship-type registry (fill label/color from the engine's actual enums)
    const relationTypes = {
      // family: { label: '血缘', color: '#d94b4b' },
    };

    // ④ Master edge list (multi-stage libraries: union of per-stage edges, deduped;
    //    multiple edges on the same (a,b) pair need `scope`)
    const relations = [
      // { a: 'idA', b: 'idB', type: 'family', label: '…' },
    ];

    // ⑤ Stages (reference, never duplicate) — omit the stages key for single-graph libraries
    const stages = [
      // { key: 'stage1', name: 'Stage One', entities: [...], layout: {...},
      //   relations: [{ a: 'idA', b: 'idB' }], overlay: {...} },
    ];

    const pack = {
      entities,
      aliases,
      relationTypes,
      relations,
      // stages,
      domain: {
        // library-specific data: works/questions/heroRel/...
      }
    };

    // ⑥ Provenance stamping (mandatory in v1.2, generic stamp function)
    const stamp = (origin) => ({
      origin, sourceUrl: null, fetchedAt: new Date().toISOString().slice(0, 10),
      confidence: 1.0, note: 'Baseline data (embedded in original case page); original sourceUrl lost'
    });
    pack.provenance = {
      entities: Object.fromEntries(Object.keys(pack.entities).map(id => [id, stamp('engine-embedded-defaults')])),
      relations: Object.fromEntries(pack.relations.map(r => [r.a + '::' + r.b, stamp('engine-embedded-defaults')]))
    };

    return pack;
  },

  // Losslessness check: fromPack(pack)[from] deep-equals defaults[lit]
  equivalence: [
    { lit: 'chars', from: 'chars' },
    // { lit: 'edges', from: 'allEdges' },
  ],

  // sortKeys: { edges: (x, y) => edgeKey(x).localeCompare(edgeKey(y)) },

  // domainChecks(pack) { return { errors: [], warnings: [] }; },

  domainSchema: {
    type: 'object',
    description: 'Library-specific data collections',
    additionalProperties: true
  }
};
