(function (global) {
  'use strict';
  function __fromPack(pack) {
    var order = pack.domain && pack.domain.cardOrder || [];
    return {
      cards: order.map(function (id) {
        var entity = pack.entities[id];
        if (!entity) throw new Error('Missing card entity: ' + id);
        return { id: id, title: entity.title, color: entity.color };
      })
    };
  }
  function mount(root, options) {
    var data = options && options.data ? __fromPack(options.data) : { cards: [] };
    root.innerHTML = '<div class="grid">' + data.cards.map(function (card) {
      return '<article class="card" data-card-id="' + card.id + '" style="--accent:' + card.color + '"><span>' + card.title + '</span></article>';
    }).join('') + '</div>';
    var expected = ['Alpha Card', 'Beta Card', 'Gamma Card'];
    var actual = Array.prototype.map.call(root.querySelectorAll('.card span'), function (item) { return item.textContent; });
    document.body.dataset.runtimeStatus = JSON.stringify(actual) === JSON.stringify(expected) ? 'passed' : 'failed';
    var first = root.querySelector('.card');
    var style = first ? getComputedStyle(first) : null;
    document.body.dataset.computedStyleScore = style && style.display === 'flex' && style.borderRadius === '14px' ? '1' : '0';
  }
  global.PatternCCards = { mount: mount, __fromPack: __fromPack };
}(globalThis));
