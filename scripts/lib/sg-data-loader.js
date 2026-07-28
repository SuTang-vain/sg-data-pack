/*
 * sg-data-loader.js — SG Data Pack runtime validator (zero-dependency UMD) v1.2
 *
 * Responsibilities:
 *   1. validate(pack)  -> { errors: [], warnings: [] }  structural Data Pack validation
 *   2. assertValid(pack) -> throws an aggregated error on failure (called by engines on mount — fails loudly, never silently)
 *   3. resolveAlias(pack, name) / resolveId(pack, idOrName)  alias normalization (crawled name -> canonical id)
 *
 * Validation rules (mirrors data-pack.schema.json):
 *   E1  schemaVersion must be "1.0", "1.1", "1.2", or "1.3"
 *   E2  meta.id / meta.title must be non-empty strings
 *   E3  entities must be an object; each entity needs a name (or the kind's nameField) and a kind
 *   E4  alias targets must exist in entities; alias keys must not collide with entity ids
 *   E5  relations[].a/b must exist in entities after alias normalization (dangling ref = error)
 *   E6  relations[].type must be registered in relationTypes (illegal enum = error)
 *   E7  references in stages[].entities/layout/overlay/relations must exist
 *   E8  layout coordinates must be within [0,1]
 *   E9  (reserved: alias disambiguation context)
 *   E10 attribute-pair labels in attributeSources collections must be registered in attributeTypes (v1.1)
 *   E11 local assets referenced by entities/contents must be registered in the assets manifest (v1.1)
 *   E12 relations[].scope stage keys must exist; ambiguous stage edge refs must be resolvable via scope/type (v1.1)
 *   E13 contents[].highlights[].ref must resolve to an entity/alias or domain.notes key (v1.1)
 *   E14 both sides of a sameAs pair must exist (v1.2)
 *   E15 provenance keys must point at existing entities/relations/contents (v1.2)
 *   E16 derivations entries: valid kind enum + source path resolvable within the pack (v1.3)
 *   W1  entity never referenced by any stage/relation
 *   W2  asset marked exists:false
 *   W3  relation missing label
 *   W4  local asset exists but lacks a hash (incomplete provenance)
 *   W5  provenance confidence below threshold (default 0.7, tunable via meta.confidenceThreshold) (v1.2)
 *   W6  entity names collide after normalization without a sameAs declaration (suspected duplicate, v1.2)
 */
(function (global) {
  'use strict';

  var SCHEMA_VERSIONS = ['1.0', '1.1', '1.2', '1.3'];
  var IMG_EXT = /\.(png|jpe?g|webp|gif|svg)$/i;

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function resolveAlias(pack, name) {
    if (pack && isObj(pack.aliases) && Object.prototype.hasOwnProperty.call(pack.aliases, name)) {
      return pack.aliases[name];
    }
    return null;
  }

  /* crawled name / alias / canonical id -> canonical id; null when unresolvable */
  function resolveId(pack, idOrName) {
    if (!pack || !isObj(pack.entities)) return null;
    if (Object.prototype.hasOwnProperty.call(pack.entities, idOrName)) return idOrName;
    var via = resolveAlias(pack, idOrName);
    if (via && Object.prototype.hasOwnProperty.call(pack.entities, via)) return via;
    return null;
  }

  /* contents highlight ref: entity/alias, or a domain.notes annotation key */
  function resolveContentRef(pack, ref) {
    if (resolveId(pack, ref)) return ref;
    if (isObj(pack.domain) && isObj(pack.domain.notes) &&
        Object.prototype.hasOwnProperty.call(pack.domain.notes, ref)) return ref;
    return null;
  }

  /* Resolve attributeSources paths: supports "entities.*.relations" and "domain.facts" forms */
  function resolveAttrSource(pack, pathExpr) {
    var out = [];
    var m;
    if ((m = /^entities\.\*\.(\w+)$/.exec(pathExpr))) {
      var field = m[1];
      Object.keys(pack.entities || {}).forEach(function (id) {
        var v = pack.entities[id][field];
        if (Array.isArray(v)) out.push({ at: 'entities.' + id + '.' + field, pairs: v });
      });
    } else if ((m = /^domain\.(\w+(?:\.\w+)*)$/.exec(pathExpr))) {
      var segs = m[1].split('.');
      var v = pack.domain;
      for (var i = 0; i < segs.length && v !== undefined; i++) v = v[segs[i]];
      if (Array.isArray(v)) out.push({ at: 'domain.' + segs.join('.'), pairs: v });
      else if (isObj(v)) Object.keys(v).forEach(function (k) {
        if (Array.isArray(v[k])) out.push({ at: 'domain.' + segs.join('.') + '.' + k, pairs: v[k] });
      });
    }
    return out;
  }

  /* Collect all local asset references in entities/contents (value-shape heuristic) */
  function collectAssetRefs(pack) {
    var refs = [];
    function walk(v) {
      if (typeof v === 'string') {
        if (IMG_EXT.test(v) && !/^https?:\/\//i.test(v) && !/^data:/.test(v)) refs.push(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (isObj(v)) Object.keys(v).forEach(function (k) { walk(v[k]); });
    }
    walk(pack.entities || {});
    walk(pack.contents || {});
    return refs;
  }

  function validate(pack) {
    var errors = [];
    var warnings = [];

    if (!isObj(pack)) {
      return { errors: ['pack must be an object'], warnings: warnings };
    }

    /* E1 */
    if (SCHEMA_VERSIONS.indexOf(pack.schemaVersion) === -1) {
      errors.push('E1: schemaVersion must be ' + SCHEMA_VERSIONS.map(function (s) { return '"' + s + '"'; }).join(' or ') +
        ', got ' + JSON.stringify(pack.schemaVersion));
    }

    /* E2 */
    if (!isObj(pack.meta) || typeof pack.meta.id !== 'string' || !pack.meta.id) {
      errors.push('E2: meta.id must be a non-empty string');
    }
    if (!isObj(pack.meta) || typeof pack.meta.title !== 'string' || !pack.meta.title) {
      errors.push('E2: meta.title must be a non-empty string');
    }

    /* E3 */
    var entities = pack.entities;
    if (!isObj(entities) || Object.keys(entities).length === 0) {
      errors.push('E3: entities must be a non-empty object');
      entities = {};
    }
    var nameFields = isObj(pack.kindNameFields) ? pack.kindNameFields : {};
    Object.keys(entities).forEach(function (id) {
      var e = entities[id];
      if (!isObj(e)) { errors.push('E3: entities.' + id + ' must be an object'); return; }
      var nf = nameFields[e.kind] || 'name';
      if (typeof e[nf] !== 'string' || !e[nf]) {
        errors.push('E3: entities.' + id + '.' + nf + ' must be a non-empty string' + (nf !== 'name' ? ' (nameField of kind:' + e.kind + ')' : ''));
      }
      if (typeof e.kind !== 'string' || !e.kind) errors.push('E3: entities.' + id + '.kind must be a non-empty string');
    });

    /* E4 */
    var aliases = pack.aliases || {};
    if (!isObj(aliases)) {
      errors.push('E4: aliases must be an object');
      aliases = {};
    }
    Object.keys(aliases).forEach(function (alias) {
      if (Object.prototype.hasOwnProperty.call(entities, alias)) {
        errors.push('E4: alias "' + alias + '" collides with an entity id');
      }
      var target = aliases[alias];
      if (isObj(target)) target = target.id; // {id, context} disambiguation form (E9 reserved)
      if (!Object.prototype.hasOwnProperty.call(entities, target)) {
        errors.push('E4: alias "' + alias + '" points to non-existent entity "' + target + '"');
      }
    });

    /* relationTypes registry */
    var relationTypes = isObj(pack.relationTypes) ? pack.relationTypes : {};

    /* stages pre-scan (E12 needs the stage-key set) */
    var stages = Array.isArray(pack.stages) ? pack.stages : [];
    if (pack.stages !== undefined && !Array.isArray(pack.stages)) {
      errors.push('E7: stages must be an array');
    }
    var stageKeys = {};
    stages.forEach(function (s) { if (isObj(s) && typeof s.key === 'string') stageKeys[s.key] = true; });

    /* E5/E6/E12/W3 */
    var relations = Array.isArray(pack.relations) ? pack.relations : [];
    if (pack.relations !== undefined && !Array.isArray(pack.relations)) {
      errors.push('E5: relations must be an array');
    }
    var referenced = {};
    relations.forEach(function (r, i) {
      if (!isObj(r)) { errors.push('E5: relations[' + i + '] must be an object'); return; }
      ['a', 'b'].forEach(function (end) {
        var id = resolveId(pack, r[end]);
        if (!id) errors.push('E5: relations[' + i + '].' + end + ' dangling reference "' + r[end] + '"');
        else referenced[id] = true;
      });
      if (typeof r.type !== 'string' || !Object.prototype.hasOwnProperty.call(relationTypes, r.type)) {
        errors.push('E6: relations[' + i + '].type "' + r.type + '" is not registered in relationTypes');
      }
      if (r.label === undefined || r.label === '') {
        warnings.push('W3: relations[' + i + '] (' + r.a + ' -> ' + r.b + ') missing label');
      }
      /* E12: scope stage keys must exist */
      if (r.scope !== undefined) {
        if (!Array.isArray(r.scope) || !r.scope.length) {
          errors.push('E12: relations[' + i + '].scope must be a non-empty array of stage keys');
        } else r.scope.forEach(function (k) {
          if (!stageKeys[k]) errors.push('E12: relations[' + i + '].scope references non-existent stage "' + k + '"');
        });
      }
    });

    /* E7/E8 + E12 reference-disambiguation */
    stages.forEach(function (s, i) {
      if (!isObj(s)) { errors.push('E7: stages[' + i + '] must be an object'); return; }
      if (typeof s.key !== 'string' || !s.key) errors.push('E7: stages[' + i + '].key must be a non-empty string');
      else {
        var dup = stages.some(function (o, j) { return j !== i && isObj(o) && o.key === s.key; });
        if (dup) errors.push('E7: stages[' + i + '].key "' + s.key + '" is duplicated');
      }
      if (typeof s.name !== 'string' || !s.name) errors.push('E7: stages[' + i + '].name must be a non-empty string');

      var memberSet = {};
      (Array.isArray(s.entities) ? s.entities : []).forEach(function (id) {
        var rid = resolveId(pack, id);
        if (!rid) errors.push('E7: stages[' + i + '].entities dangling reference "' + id + '"');
        else { memberSet[rid] = true; referenced[rid] = true; }
      });

      if (s.layout !== undefined) {
        if (!isObj(s.layout)) errors.push('E7: stages[' + i + '].layout must be an object');
        else Object.keys(s.layout).forEach(function (id) {
          var rid = resolveId(pack, id);
          if (!rid) { errors.push('E7: stages[' + i + '].layout dangling reference "' + id + '"'); return; }
          if (!memberSet[rid]) errors.push('E7: stages[' + i + '].layout."' + id + '" is not in this stage\'s entities');
          var xy = s.layout[id];
          if (!Array.isArray(xy) || xy.length !== 2 || typeof xy[0] !== 'number' || typeof xy[1] !== 'number') {
            errors.push('E8: stages[' + i + '].layout."' + id + '" must be a numeric [x, y] pair');
          } else if (xy[0] < 0 || xy[0] > 1 || xy[1] < 0 || xy[1] > 1) {
            errors.push('E8: stages[' + i + '].layout."' + id + '" coordinates out of range [' + xy + '] (must be within [0,1])');
          }
        });
      }

      if (s.relations !== undefined) {
        if (!Array.isArray(s.relations)) errors.push('E7: stages[' + i + '].relations must be an array');
        else s.relations.forEach(function (ref, j) {
          if (!isObj(ref)) { errors.push('E7: stages[' + i + '].relations[' + j + '] must be an {a,b} reference'); return; }
          var at = 'stages[' + i + '].relations[' + j + ']';
          var okA = resolveId(pack, ref.a), okB = resolveId(pack, ref.b);
          if (!okA) errors.push('E7: ' + at + '.a dangling reference "' + ref.a + '"');
          if (!okB) errors.push('E7: ' + at + '.b dangling reference "' + ref.b + '"');
          if (!okA || !okB) return;
          /* E12: when (a,b) matches multiple master edges, it must resolve to one via type or scope */
          var cands = relations.filter(function (r) { return r.a === ref.a && r.b === ref.b; });
          if (cands.length > 1 && ref.type) {
            cands = cands.filter(function (r) { return r.type === ref.type; });
          }
          if (cands.length > 1) {
            var scoped = cands.filter(function (r) {
              return Array.isArray(r.scope) && r.scope.indexOf(s.key) !== -1;
            });
            if (scoped.length === 1) cands = scoped;
          }
          if (cands.length === 0) {
            errors.push('E7: ' + at + ' {' + ref.a + ',' + ref.b + '} does not exist in master relations');
          } else if (cands.length > 1) {
            errors.push('E12: ' + at + ' {' + ref.a + ',' + ref.b + '} matches ' + cands.length +
              ' master edges and cannot be resolved via type/scope (stage "' + s.key + '")');
          }
        });
      }

      if (s.overlay !== undefined) {
        if (!isObj(s.overlay)) errors.push('E7: stages[' + i + '].overlay must be an object');
        else Object.keys(s.overlay).forEach(function (id) {
          if (!resolveId(pack, id)) errors.push('E7: stages[' + i + '].overlay dangling reference "' + id + '"');
        });
      }
    });

    /* E10: attributeTypes / attributeSources */
    if (pack.attributeTypes !== undefined && !isObj(pack.attributeTypes)) {
      errors.push('E10: attributeTypes must be an object');
    }
    if (pack.attributeSources !== undefined) {
      if (!Array.isArray(pack.attributeSources)) {
        errors.push('E10: attributeSources must be an array of path strings');
      } else if (!isObj(pack.attributeTypes) || Object.keys(pack.attributeTypes).length === 0) {
        errors.push('E10: attributeSources declared but attributeTypes is empty');
      } else {
        pack.attributeSources.forEach(function (pathExpr) {
          var sources = resolveAttrSource(pack, pathExpr);
          if (!sources.length) {
            warnings.push('E10: attributeSources path "' + pathExpr + '" matched no attribute-pair collection');
            return;
          }
          sources.forEach(function (src) {
            src.pairs.forEach(function (pair, i) {
              var label = Array.isArray(pair) ? pair[0] : (isObj(pair) ? pair.label : undefined);
              if (typeof label !== 'string' || !Object.prototype.hasOwnProperty.call(pack.attributeTypes, label)) {
                errors.push('E10: ' + src.at + '[' + i + '] attribute label ' + JSON.stringify(label) + ' is not registered in attributeTypes');
              }
            });
          });
        });
      }
    }

    /* E11: local asset references must be registered in the assets manifest */
    if (pack.assets !== undefined && !isObj(pack.assets)) {
      errors.push('assets must be an object');
    }
    var assets = isObj(pack.assets) ? pack.assets : {};
    var assetBase = (isObj(pack.meta) && typeof pack.meta.assetBase === 'string') ? pack.meta.assetBase : '';
    collectAssetRefs(pack).forEach(function (v) {
      var key = assetBase && v.indexOf('assets/') === -1 ? assetBase + v : v;
      if (!Object.prototype.hasOwnProperty.call(assets, key)) {
        errors.push('E11: asset reference "' + v + '" (resolved as "' + key + '") is not registered in the assets manifest');
      }
    });

    /* E13: contents highlight refs */
    if (pack.contents !== undefined) {
      if (!isObj(pack.contents)) {
        errors.push('E13: contents must be an object');
      } else Object.keys(pack.contents).forEach(function (cid) {
        var c = pack.contents[cid];
        if (!isObj(c)) { errors.push('E13: contents.' + cid + ' must be an object'); return; }
        if (typeof c.kind !== 'string' || !c.kind) errors.push('E13: contents.' + cid + '.kind must be a non-empty string');
        if (c.body !== undefined && typeof c.body !== 'string') errors.push('E13: contents.' + cid + '.body must be a string');
        if (c.highlights !== undefined) {
          if (!Array.isArray(c.highlights)) errors.push('E13: contents.' + cid + '.highlights must be an array');
          else c.highlights.forEach(function (h, i) {
            if (!isObj(h) || typeof h.ref !== 'string') {
              errors.push('E13: contents.' + cid + '.highlights[' + i + '] must contain a ref string');
              return;
            }
            if (!resolveContentRef(pack, h.ref)) {
              errors.push('E13: contents.' + cid + '.highlights[' + i + '].ref "' + h.ref + '" cannot be resolved (not an entity/alias/annotation key)');
            }
          });
        }
      });
    }

    /* W1 */
    Object.keys(entities).forEach(function (id) {
      if (!referenced[id]) warnings.push('W1: entity "' + id + '" (' + (entities[id].name || entities[id].title || id) + ') is not referenced by any relation/stage');
    });

    /* E14: sameAs entity-identity pairs (v1.2) */
    var sameAsPairs = [];
    if (pack.sameAs !== undefined) {
      if (!Array.isArray(pack.sameAs)) {
        errors.push('E14: sameAs must be an array of [idA, idB] pairs');
      } else pack.sameAs.forEach(function (pair, i) {
        if (!Array.isArray(pair) || pair.length !== 2) {
          errors.push('E14: sameAs[' + i + '] must be a two-element [idA, idB] array');
          return;
        }
        pair.forEach(function (id) {
          if (!resolveId(pack, id)) errors.push('E14: sameAs[' + i + '] references non-existent entity "' + id + '"');
        });
        if (pair[0] === pair[1]) errors.push('E14: sameAs[' + i + '] has the same entity on both sides');
        sameAsPairs.push(pair);
      });
    }

    /* E15/W5: provenance record-level provenance (v1.2) */
    if (pack.provenance !== undefined) {
      if (!isObj(pack.provenance)) {
        errors.push('E15: provenance must be an object');
      } else {
        var threshold = (isObj(pack.meta) && typeof pack.meta.confidenceThreshold === 'number')
          ? pack.meta.confidenceThreshold : 0.7;
        var checkProv = function (group, exists, describe) {
          var g = pack.provenance[group];
          if (g === undefined) return;
          if (!isObj(g)) { errors.push('E15: provenance.' + group + ' must be an object'); return; }
          Object.keys(g).forEach(function (key) {
            if (!exists(key)) { errors.push('E15: provenance.' + group + '."' + key + '" ' + describe); return; }
            var p = g[key];
            if (isObj(p) && typeof p.confidence === 'number' && p.confidence < threshold) {
              warnings.push('W5: ' + group + '."' + key + '" confidence=' + p.confidence + ' is below threshold ' + threshold + ' (low-confidence data; manual review advised)');
            }
          });
        };
        checkProv('entities', function (id) { return Object.prototype.hasOwnProperty.call(entities, id); }, 'points to a non-existent entity');
        checkProv('relations', function (key) {
          return relations.some(function (r) { return (r.a + '::' + r.b) === key; });
        }, 'points to a non-existent relation (key format "a::b")');
        checkProv('contents', function (key) {
          return isObj(pack.contents) && Object.prototype.hasOwnProperty.call(pack.contents, key);
        }, 'points to a non-existent contents entry');

      }
    }

    /* E16: derivations declaration consistency (v1.3) */
    if (pack.derivations !== undefined) {
      var DERIV_KINDS = ['repeat', 'insertion-order', 'lookup-rebuild', 'scope-resolution', 'projection', 'reference-only'];
      var resolvePath = function (expr) {
        // dotted path with optional '*' wildcard: walk pack sections
        var segs = String(expr).split('.');
        var roots = { entities: 1, relations: 1, stages: 1, contents: 1, domain: 1, aliases: 1, attributeTypes: 1, meta: 1, sameAs: 1, provenance: 1 };
        if (!roots[segs[0]]) return { rootOk: false, resolved: false };
        var nodes = [pack];
        for (var i = 0; i < segs.length; i++) {
          var next = [];
          for (var j = 0; j < nodes.length; j++) {
            var node = nodes[j];
            if (!isObj(node) && !Array.isArray(node)) continue;
            if (segs[i] === '*') {
              Object.keys(node).forEach(function (k) { next.push(node[k]); });
            } else if (Object.prototype.hasOwnProperty.call(node, segs[i])) {
              next.push(node[segs[i]]);
            }
          }
          nodes = next;
          if (!nodes.length) return { rootOk: true, resolved: false };
        }
        return { rootOk: true, resolved: nodes.length > 0 };
      };
      if (!isObj(pack.derivations)) {
        errors.push('E16: derivations must be an object');
      } else {
        Object.keys(pack.derivations).forEach(function (dk) {
          var d = pack.derivations[dk];
          var at = 'derivations.' + dk;
          if (!isObj(d)) { errors.push('E16: ' + at + ' must be an object'); return; }
          if (DERIV_KINDS.indexOf(d.kind) === -1) {
            errors.push('E16: ' + at + '.kind ' + JSON.stringify(d.kind) + ' is not a valid derivation kind (' + DERIV_KINDS.join('/') + ')');
          }
          if (typeof d.source !== 'string' || !d.source) {
            errors.push('E16: ' + at + '.source must be a non-empty pack path string');
          } else {
            var r = resolvePath(d.source);
            if (!r.rootOk) errors.push('E16: ' + at + '.source "' + d.source + '" has an invalid root section');
            else if (!r.resolved) warnings.push('E16: ' + at + '.source "' + d.source + '" resolves to nothing in this pack');
          }
          if (!Array.isArray(d.consumers) || !d.consumers.length || d.consumers.some(function (c) { return typeof c !== 'string' || !c; })) {
            errors.push('E16: ' + at + '.consumers must be a non-empty array of strings');
          }
          if (typeof d.note !== 'string' || !d.note) {
            errors.push('E16: ' + at + '.note must be a non-empty string');
          }
        });
      }
    }

    /* W6: entity names collide after normalization without sameAs (v1.2) */
    var normName = function (s) {
      return String(s == null ? '' : s).replace(/[\s·・（）()《》〈〉\-—_]+/g, '').toLowerCase();
    };
    var byNorm = {};
    Object.keys(entities).forEach(function (id) {
      var e = entities[id];
      var n = normName(e.name || e.title || '');
      if (!n) return;
      if (!byNorm[n]) byNorm[n] = [];
      byNorm[n].push(id);
    });
    Object.keys(byNorm).forEach(function (n) {
      var ids = byNorm[n];
      if (ids.length < 2) return;
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
        var linked = sameAsPairs.some(function (p) {
          return (p[0] === ids[i] && p[1] === ids[j]) || (p[0] === ids[j] && p[1] === ids[i]);
        });
        if (!linked) {
          warnings.push('W6: entities "' + ids[i] + '" and "' + ids[j] + '" have identical normalized names (' + n + '); suspected duplicates — declare sameAs if they are the same subject');
        }
      }
    });

    /* W2/W4 */
    Object.keys(assets).forEach(function (p) {
      var a = assets[p];
      if (isObj(a) && a.exists === false) warnings.push('W2: missing asset ' + p);
      if (isObj(a) && a.exists === true && !a.hash && !/^https?:\/\//i.test(p)) {
        warnings.push('W4: asset missing hash (incomplete provenance) ' + p);
      }
    });

    /* domain is free-form, governed by library-level domainChecks/schema */
    if (pack.domain !== undefined && !isObj(pack.domain)) {
      errors.push('domain must be an object');
    }

    return { errors: errors, warnings: warnings };
  }

  function assertValid(pack) {
    var r = validate(pack);
    if (r.errors.length) {
      var id = (pack && pack.meta && pack.meta.id) || '(unknown)';
      throw new Error('[SGDataLoader] Data Pack "' + id + '" validation failed (' + r.errors.length + ' error(s)):\n - ' + r.errors.join('\n - '));
    }
    return r;
  }

  global.SGDataLoader = {
    SCHEMA_VERSIONS: SCHEMA_VERSIONS,
    validate: validate,
    assertValid: assertValid,
    resolveAlias: resolveAlias,
    resolveId: resolveId,
    resolveContentRef: resolveContentRef
  };
})(typeof window !== 'undefined' ? window : globalThis);
