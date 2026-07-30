// @ts-check
(function(global){
  'use strict';
  const TEMPLATE = `
<div id="sg-app-container" role="application" aria-label="秦始皇七大事件与人物关系">
<!-- 顶部：事件简介 -->
<div class="sg-event-intro" id="sg-eventIntro"></div>
<!-- 中部：人物关系图谱 -->
<div class="sg-graph-wrap" id="sg-graphWrap">
<div class="sg-graph-legend">
<div class="sg-legend-item">
<svg class="sg-lg-svg sg-family" height="8" width="26">
<line x1="1" x2="25" y1="4" y2="4"></line></svg>宗亲
          </div>
<div class="sg-legend-item">
<svg class="sg-lg-svg sg-ruler" height="8" width="26">
<line x1="1" x2="25" y1="4" y2="4"></line></svg>君臣
          </div>
<div class="sg-legend-item">
<svg class="sg-lg-svg sg-ally" height="8" width="26">
<line x1="1" x2="25" y1="4" y2="4"></line></svg>同僚
          </div>
<div class="sg-legend-item">
<svg class="sg-lg-svg sg-enemy" height="8" width="26">
<line x1="1" x2="25" y1="4" y2="4"></line></svg>对立
          </div>
</div>
<div class="sg-graph-canvas" id="sg-graphCanvas">
<svg class="sg-edges" id="sg-graphEdges"></svg>
</div>
<div class="sg-graph-hint" id="sg-graphHint">
<span class="sg-gh-dot"></span>点击头像查看人物详情，可拖动
        </div>
</div>
<!-- 底部：事件切换按钮 -->
<div class="sg-event-bar">
<button class="sg-bar-arrow" id="sg-barPrev" type="button" aria-label="上一个事件" title="上一个事件">‹</button>
<div class="sg-event-btns" id="sg-eventBtns"></div>
<button class="sg-bar-arrow" id="sg-barNext" type="button" aria-label="下一个事件" title="下一个事件">›</button>
<div aria-hidden="true" class="sg-swipe-hint" id="sg-swipeHint">›</div>
</div>
<!-- 人物详情弹窗 -->
<div class="sg-modal-overlay" id="sg-modalOverlay" role="dialog" aria-modal="true" aria-labelledby="sg-modalName">
<div class="sg-modal-content">
<button class="sg-modal-close" id="sg-modalClose" type="button" aria-label="关闭人物详情">✕</button>
<div class="sg-modal-head">
<img alt="" class="sg-modal-avatar" id="sg-modalAvatar"/>
<div class="sg-modal-head-info">
<div class="sg-modal-person-name" id="sg-modalName"></div>
<div class="sg-modal-person-role" id="sg-modalRole"></div>
<span class="sg-modal-rel-tag" id="sg-modalRelTag"></span>
</div>
</div>
<div class="sg-modal-body">
<div class="sg-modal-section">
<div class="sg-modal-section-title">在本事件中的作为</div>
<div class="sg-modal-section-text" id="sg-modalDeed"></div>
</div>
<div class="sg-modal-section">
<div class="sg-modal-section-title">影响</div>
<div class="sg-modal-section-text" id="sg-modalImpact"></div>
</div>
</div>
</div>
</div>
</div>

`;
  /* ============ SG Data Pack 支持 ============
   * options.data 为规范 Data Pack（见 lib/data/data.schema.json）时优先于内嵌默认数据。
   * pack 经 __fromPack 转换为旧版 options 形状后，复用既有 options.events 通路。
   * 引入 lib/src/sg-data-loader.js 后会在 mount 时强制校验，失败即抛错（不静默吞错）。
   */
  /** @type {(pack: import("./data-types").QinshihuangPack) => Record<string, unknown>} */

  /** @param {import("./data-types").QinshihuangPack} pack */

  function __fromPack(pack) {
    var entities = pack.entities || {};
    var byPair = {};
    (pack.relations || []).forEach(function (r) { byPair[r.a + '::' + r.b] = r; });
    var events = (pack.stages || []).map(function (s) {
      var people = (s.entities || []).map(function (id) {
        var ent = entities[id];
        var ov = (s.overlay && s.overlay[id]) || {};
        var p = { name: ent.name, role: ov.role, avatar: ov.avatar || ent.avatar };
        if (ov.big) p.big = true;
        if (ov.rel !== undefined) p.rel = ov.rel;
        p.deed = ov.deed;
        p.impact = ov.impact;
        return p;
      });
      var links = (s.relations || []).map(function (ref) {
        var r = byPair[ref.a + '::' + ref.b];
        return { a: entities[ref.a].name, b: entities[ref.b].name, type: r.type, label: r.label };
      });
      return {
        name: s.name,
        year: s.year,
        period: s.period,
        image: s.image,
        summary: s.summary,
        summaryShort: s.summaryShort,
        people: people,
        links: links
      };
    });
    return { events: events };
  }
  function __resolveDataOptions(options) {
    if (!options || !options.data) return options;
    if (typeof SGDataLoader !== 'undefined') {
      SGDataLoader.assertValid(options.data);
    } else if (typeof console !== 'undefined' && console.error) {
      console.error('[qinshihuang] options.data 未校验：请先引入 lib/src/sg-data-loader.js');
    }
    var d = __fromPack(options.data);
    var merged = {};
    Object.keys(options).forEach(function (k) { merged[k] = options[k]; });
    Object.keys(d).forEach(function (k) { if (d[k] !== undefined) merged[k] = d[k]; }); // pack 优先
    return merged;
  }
  /* ========== SG Data Pack 支持（结束） ========== */

  function mount(root, options) {
    options = __resolveDataOptions(options);
    if (!root) throw new Error('mount root is required');
    root.innerHTML = TEMPLATE;
    const IMG = '../assets/';

            /* ========= 关系类型 ========= */
            const REL = {
              family: { name: "宗亲", color: "var(--rel-family)" },
              ruler: { name: "君臣", color: "var(--rel-ruler)" },
              ally: { name: "同僚", color: "var(--rel-ally)" },
              enemy: { name: "对立", color: "var(--rel-enemy)" },
            };

            /* 无对应画像的人物用中性剪影，避免借用他人头像造成误导（全 %编码，无裸引号，可安全用于 url() 与 img.src） */
            const SILHOUETTE =
              "data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%20100%20100%22%3E%3Crect%20width=%22100%22%20height=%22100%22%20fill=%22%23dfe2ec%22/%3E%3Ccircle%20cx=%2250%22%20cy=%2240%22%20r=%2217%22%20fill=%22%23aab0c4%22/%3E%3Cpath%20d=%22M22%2085c0-16%2013-27%2028-27s28%2011%2028%2027z%22%20fill=%22%23aab0c4%22/%3E%3C/svg%3E";

            /* ========= 事件 + 人物关系数据 =========
               每个事件：中部展示以「秦始皇」为核心的人物关系图；
               点击人物头像 → 弹窗介绍其在该事件中的作为与影响。
               node.rel：该人物与核心（嬴政/秦始皇）的关系类型，用于连线配色
                         —— 臣属/将领=ruler(君臣)、子嗣=family(宗亲)、举兵反叛者=enemy(对立)。
               links：人物↔人物之间的额外关系（同僚/对立等）。 */
            const events = (options && Array.isArray(options.events) ? options.events : JSON.parse(document.getElementById("sg-event-data")?.textContent || "[]"));
            let currentIndex = 0;
            let modalOpenKey = null;
            const isMobile = () => isSmallCanvas();

            /* ===== 全端等比缩放（双基准） =====
               - 小基准 380×456，大基准 788×492
               - 用 transform: translate + scale 把画布等比缩放到窗口
               - 基准选择只看运行容器尺寸/比例（不用 UA/screen/触控）
               - 布局切换用 @media（真实视口）+ 挡位类（is-small/large/tiny-canvas） */
            const BASE_SMALL = { w: 380, h: 456 }; // 1:1.2
            const BASE_LARGE = { w: 788, h: 492 }; // ≈1.6:1
            // 图谱布局要在“未缩放”坐标空间内计算；getBoundingClientRect() 返回缩放后的
            // 视觉尺寸，需除以此值还原。applyScale() 会实时更新。
            let scaleFactor = 1;
            let currentBaseKey = "large";
            function isSmallCanvas() {
              return currentBaseKey === "small";
            }
            // 只用运行容器尺寸/比例判断：手机真实视口通常 <415 命中 isCompactCard；
            // 窄竖容器（w<=768 且竖向）命中 isNarrowMobileCard；宽屏走大基准。
            function shouldUseSmallBase(w, h) {
              const ratio = w / h;
              const isCompactCard = w < 415 || h < 456;
              const isNarrowMobileCard = w <= 768 && ratio < 1;
              return isCompactCard || isNarrowMobileCard;
            }
            function applyScale() {
              const app = document.getElementById("sg-app-container");
              if (!app) return;
              const w = window.innerWidth;
              const h = window.innerHeight;
              const base = shouldUseSmallBase(w, h) ? BASE_SMALL : BASE_LARGE;
              const scale = Math.min(w / base.w, h / base.h);
              scaleFactor = scale;
              currentBaseKey = base === BASE_SMALL ? "small" : "large";
              const offsetX = (w - base.w * scale) / 2;
              const offsetY = (h - base.h * scale) / 2;
              document.documentElement.classList.add("sg-is-scaled-canvas");
              root.classList.add("sg-is-scaled-canvas");
              app.classList.add("sg-is-scaled");
              app.classList.toggle("sg-is-small-canvas", currentBaseKey === "small");
              app.classList.toggle("sg-is-large-canvas", currentBaseKey === "large");
              app.classList.toggle("sg-is-tiny-canvas", w <= 330 || h <= 380);
              app.style.width = base.w + "px";
              app.style.height = base.h + "px";
              app.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
            }
            // 尽早执行一次，避免未缩放大画布闪现；load/DOMContentLoaded 再兜底（见下方 init 时序）
            applyScale();
            document.addEventListener("DOMContentLoaded", applyScale);

            const graphWrap = document.getElementById("sg-graphWrap");
            const graphCanvas = document.getElementById("sg-graphCanvas");
            const graphEdges = document.getElementById("sg-graphEdges");
            const SVGNS = "http://www.w3.org/2000/svg";

            let bounds = { w: 0, h: 0 };
            let nodeState = {}; // name -> {x,y,el,inner}
            let edgeEls = []; // {path, bg, text, a, b}
            const LABEL_H = 16; // 连线标签高度（含内边距）

            /* ===== 顶部事件简介 ===== */
            function renderIntro() {
              const e = events[currentIndex];
              // 不同端展示不同长度文案，保证完整显示、不省略
              const summary =
                isMobile() && e.summaryShort ? e.summaryShort : e.summary;
              document.getElementById("sg-eventIntro").innerHTML = `
                <img class="sg-intro-icon" src="${IMG + e.image}" alt="${e.name}" loading="lazy" />
                <div class="sg-intro-text">
                  <div class="sg-intro-title-line">
                    <span class="sg-intro-name">${e.name}</span>
                    <span class="sg-intro-period">${e.year} · ${e.period}</span>
                  </div>
                  <div class="sg-intro-summary">${summary}</div>
                </div>
                <div class="sg-intro-index"><b>${currentIndex + 1}</b>/${events.length}</div>`;
            }

            /* ===== 底部事件按钮 ===== */
            const eventBtns = document.getElementById("sg-eventBtns");
            const barPrev = document.getElementById("sg-barPrev");
            const barNext = document.getElementById("sg-barNext");
            const swipeHint = document.getElementById("sg-swipeHint");

            function renderEventBtns() {
              eventBtns.innerHTML = events
                .map(
                  (e, i) => `
                <button class="sg-event-btn ${i === currentIndex ?"sg-active" : ""}" data-i="${i}" title="查看：${e.name}">
                  <span class="sg-eb-name">${e.name}</span>
                  <span class="sg-eb-year">${e.year}</span>
                </button>`,
                )
                .join("");
              eventBtns.querySelectorAll(".sg-event-btn").forEach((b) => {
                b.addEventListener("click", () => goTo(+b.dataset.i));
              });
              requestAnimationFrame(() => {
                eventBtns
                  .querySelector(".event-btn.active")
                  ?.scrollIntoView?.({
                    inline: "center",
                    block: "nearest",
                    behavior: "smooth",
                  });
                updateArrows();
              });
            }
            function updateArrows() {
              const maxScroll = eventBtns.scrollWidth - eventBtns.clientWidth;
              const scrollable = maxScroll > 2;
              barPrev.disabled = !scrollable || eventBtns.scrollLeft <= 1;
              barNext.disabled = !scrollable || eventBtns.scrollLeft >= maxScroll - 1;
              // 移动端滑动提示：还能继续右滑时显示
              if (swipeHint) {
                const canRight = scrollable && eventBtns.scrollLeft < maxScroll - 4;
                swipeHint.classList.toggle("sg-hide", !canRight);
              }
            }
            barPrev.addEventListener("click", () =>
              eventBtns.scrollBy({ left: -180, behavior: "smooth" }),
            );
            barNext.addEventListener("click", () =>
              eventBtns.scrollBy({ left: 180, behavior: "smooth" }),
            );
            eventBtns.addEventListener("scroll", updateArrows, { passive: true });

            /* ===== 关系图谱 ===== */
            function avatarSizes() {
              const w = window.innerWidth,
                h = window.innerHeight;
              if (w <= 320 || h <= 365) return { av: 42, big: 54, nf: 10 };
              if (w <= 480 || h <= 480) return { av: 50, big: 64, nf: 11 };
              return { av: 66, big: 84, nf: 12 };
            }

            function measure() {
              const rect = graphWrap.getBoundingClientRect();
              // #app-container 被 transform 缩放，getBoundingClientRect 返回视觉尺寸；
              // 布局需在未缩放坐标空间进行，故除以当前 scaleFactor。
              const S = scaleFactor || 1;
              bounds = {
                w: Math.max(rect.width / S, 120),
                h: Math.max(rect.height / S, 120),
              };
            }

            function currentEdges() {
              const e = events[currentIndex];
              const core = e.people[0].name;
              // 核心↔他人：仅用连线颜色表达关系（图例已说明），不加标签以减少拥挤
              const es = e.people.slice(1).map((p) => ({
                a: core,
                b: p.name,
                type: p.rel || "ally",
                label: "",
              }));
              // 人物↔人物：额外关系，直线 + 文字标签点明
              (e.links || []).forEach((l) => es.push(l));
              return es;
            }

            /* 环形排序：暴力枚举所有排列（人数≤6，开销极小），
               选“连线交叉 + 跨越节点数”最小的顺序，让人物↔人物的直线尽量贴外缘、
               不穿过中心、不与放射线/彼此重合。 */
            function orderRing(others, links) {
              const names = others.map((p) => p.name);
              const n = names.length;
              if (n <= 2) return names;
              const rel = (links || []).filter(
                (l) => names.includes(l.a) && names.includes(l.b),
              );
              if (!rel.length) return names;

              // 两条弦 (a,b)(c,d) 在环上是否交叉（恰好一个端点落在另一条的弧内）
              const between = (x, a, b, n) => {
                // x 是否在从 a 顺时针到 b 的开区间内
                let i = (a + 1) % n;
                while (i !== b) {
                  if (i === x) return true;
                  i = (i + 1) % n;
                }
                return false;
              };
              function cost(order) {
                const pos = {};
                order.forEach((nm, i) => (pos[nm] = i));
                let c = 0;
                // 每条弦跨越的中间节点数（≈穿过的放射线数）
                rel.forEach((l) => {
                  const i = pos[l.a],
                    j = pos[l.b];
                  const d = Math.min(Math.abs(i - j), n - Math.abs(i - j));
                  c += (d - 1) * 2;
                });
                // 弦两两交叉
                for (let x = 0; x < rel.length; x++) {
                  for (let y = x + 1; y < rel.length; y++) {
                    const a = pos[rel[x].a],
                      b = pos[rel[x].b];
                    const c1 = pos[rel[y].a],
                      d1 = pos[rel[y].b];
                    if (a === c1 || a === d1 || b === c1 || b === d1) continue;
                    const cIn = between(c1, a, b, n),
                      dIn = between(d1, a, b, n);
                    if (cIn !== dIn) c += 3;
                  }
                }
                return c;
              }
              // 全排列（固定首元素消除旋转对称，降到 (n-1)!）
              let best = names.slice(),
                bestCost = Infinity;
              const first = names[0];
              const rest = names.slice(1);
              const permute = (arr, k) => {
                if (k === arr.length) {
                  const order = [first, ...arr];
                  const c = cost(order);
                  if (c < bestCost) {
                    bestCost = c;
                    best = order.slice();
                  }
                  return;
                }
                for (let i = k; i < arr.length; i++) {
                  [arr[k], arr[i]] = [arr[i], arr[k]];
                  permute(arr, k + 1);
                  [arr[k], arr[i]] = [arr[i], arr[k]];
                }
              };
              permute(rest, 0);
              return best;
            }

            function computeLayout() {
              measure();
              const mob = isMobile();
              const evt = events[currentIndex];
              const people = evt.people;
              const { av, big } = avatarSizes();
              const w = bounds.w,
                h = bounds.h;
              // 顶部给图例、底部给操作提示留白，避免头像/名字与它们相互遮挡
              const topSafe = mob ? 46 : 38;
              const botSafe = mob ? 30 : 40;
              const usableH = Math.max(h - topSafe - botSafe, 120);
              const cx = w * 0.5;
              const cy = topSafe + usableH * 0.5;
              const layout = {};
              layout[people[0].name] = [cx, cy];
              // 环形排序，使相连人物相邻
              const orderedNames = orderRing(people.slice(1), evt.links);
              const others = orderedNames.map((nm) =>
                people.find((p) => p.name === nm),
              );
              const n = others.length;
              // 半径尽量撑大，把头像推向容器边缘（靠 clamp 收回到安全边界内）
              const rx = Math.max(w * 0.5 - (mob ? 48 : 70), 96);
              const ry = Math.max(usableH * 0.5 - (mob ? 16 : 16), 74);
              // 从正上方起顺时针均布；偶数个时旋转半格，避开正上/正下与图例、提示条
              const start = -Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
              others.forEach((p, i) => {
                const a = start + (i / n) * Math.PI * 2;
                layout[p.name] = [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry];
              });

              // 估算包围盒（头像 + 名字宽度）并做分离迭代，避免头像/名字重叠
              const { nf } = avatarSizes();
              const keys = Object.keys(layout);
              const ext = {};
              keys.forEach((k) => {
                const p = people.find((pp) => pp.name === k);
                const aw = p.big ? big : av;
                const nameW = k.length * nf * 0.95 + 14;
                // 高度含头像 + 名字行；加大纵向留白，给连线标签腾出空间
                ext[k] = [Math.max(aw, nameW) / 2, (aw + nf + 12) / 2];
              });
              const clamp = (k) => {
                layout[k][0] = Math.max(
                  ext[k][0] + 4,
                  Math.min(w - ext[k][0] - 4, layout[k][0]),
                );
                layout[k][1] = Math.max(
                  ext[k][1] + topSafe,
                  Math.min(h - ext[k][1] - botSafe, layout[k][1]),
                );
              };
              // 更大的间距外扩，吸收浮动动画(±4px)并为标签让路
              const mX = mob ? 14 : 18,
                mY = mob ? 26 : 28;
              for (let it = 0; it < 120; it++) {
                let moved = false;
                for (let i = 0; i < keys.length; i++) {
                  for (let j = i + 1; j < keys.length; j++) {
                    const a = keys[i],
                      b = keys[j];
                    const dx = layout[b][0] - layout[a][0];
                    const dy = layout[b][1] - layout[a][1];
                    const ox = ext[a][0] + ext[b][0] + mX - Math.abs(dx);
                    const oy = ext[a][1] + ext[b][1] + mY - Math.abs(dy);
                    if (ox > 0 && oy > 0) {
                      moved = true;
                      if (ox <= oy) {
                        const s = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx);
                        layout[a][0] -= (ox / 2) * s;
                        layout[b][0] += (ox / 2) * s;
                      } else {
                        const s = dy === 0 ? (i % 2 ? 1 : -1) : Math.sign(dy);
                        layout[a][1] -= (oy / 2) * s;
                        layout[b][1] += (oy / 2) * s;
                      }
                      clamp(a);
                      clamp(b);
                    }
                  }
                }
                if (!moved) break;
              }
              keys.forEach(clamp);
              return layout;
            }

            function buildGraph() {
              graphCanvas.querySelectorAll(".sg-node").forEach((n) => n.remove());
              graphEdges.innerHTML = "";
              nodeState = {};
              edgeEls = [];
              const people = events[currentIndex].people;
              const layout = computeLayout();

              people.forEach((p) => {
                const [x, y] = layout[p.name];
                const el = document.createElement("div");
                el.className = "sg-node" + (p.big ? " sg-big" : "");
                el.dataset.key = p.name;
                el.innerHTML = `
                  <div class="sg-float-inner">
                    <div class="sg-avatar" style="background-image:url('${IMG + p.avatar}')"></div>
                    <div class="sg-name">${p.name}</div>
                    <div class="sg-role-chip">${p.role}</div>
                  </div>`;
                const inner = el.querySelector(".sg-float-inner");
                const dur = 6 + Math.random() * 4;
                inner.style.animationDuration = dur + "s";
                inner.style.animationDelay = -Math.random() * dur + "s";
                el.style.left = x + "px";
                el.style.top = y + "px";
                graphCanvas.appendChild(el);
                nodeState[p.name] = { x, y, el, inner };
                attachDrag(el, p.name);
                el.addEventListener("mouseenter", () => {
                  if (!modalOpenKey) highlightRelated(p.name);
                });
                el.addEventListener("mouseleave", () => {
                  if (!modalOpenKey) clearHighlight();
                });
                el.addEventListener("click", () => {
                  if (el.dataset.dragged) {
                    delete el.dataset.dragged;
                    return;
                  }
                  showPerson(p.name);
                });
              });

              // 连线：全部用直线（环形排序已让相连人物相邻，短弦不穿中心）
              currentEdges().forEach((e) => {
                const path = document.createElementNS(SVGNS, "path");
                path.setAttribute("class", "sg-edge sg-" + e.type);
                let bg = null,
                  text = null;
                if (e.label) {
                  bg = document.createElementNS(SVGNS, "rect");
                  bg.setAttribute("class", "sg-edge-label-bg");
                  bg.setAttribute("rx", "5");
                  text = document.createElementNS(SVGNS, "text");
                  text.setAttribute("class", "sg-edge-label");
                  text.setAttribute("text-anchor", "middle");
                  text.setAttribute("dominant-baseline", "central");
                  text.textContent = e.label;
                }
                graphEdges.appendChild(path);
                if (bg) graphEdges.appendChild(bg);
                if (text) graphEdges.appendChild(text);
                edgeEls.push({ path, bg, text, a: e.a, b: e.b });
              });
              updateEdgesFromDOM();
            }

            function updateEdgesFromDOM() {
              // getBoundingClientRect() 返回视觉像素(已被外层 transform:scale 放大/缩小)；
              // 但 SVG 内的坐标与 node.style.left 都在未缩放坐标空间，需除以 S 还原。
              const S = scaleFactor || 1;
              const cr = graphCanvas.getBoundingClientRect();
              // 障碍：头像圆 + 名字矩形，标签需避开它们
              const avCircles = [];
              const nameRects = [];
              Object.values(nodeState).forEach((s) => {
                const ar = s.el.querySelector(".sg-avatar").getBoundingClientRect();
                // 中心核心人物（big）给更大的避让半径，防止连线标签压到「始皇帝」等中心头像
                const isBig = s.el.classList.contains("sg-big");
                avCircles.push({
                  x: (ar.left + ar.width / 2 - cr.left) / S,
                  y: (ar.top + ar.height / 2 - cr.top) / S,
                  r: ar.width / 2 / S + (isBig ? 14 : 4),
                });
                const nm = s.el.querySelector(".sg-name");
                if (nm) {
                  const nr = nm.getBoundingClientRect();
                  nameRects.push({
                    cx: (nr.left + nr.width / 2 - cr.left) / S,
                    cy: (nr.top + nr.height / 2 - cr.top) / S,
                    hw: nr.width / 2 / S + 2,
                    hh: nr.height / 2 / S + 2,
                  });
                }
                // 职务标签（role-chip）也是障碍：避免连线标签压到「始皇帝」等职务文字
                // 移动端 role-chip 为 display:none（宽高为 0），跳过以免在左上角生成假障碍
                const rc = s.el.querySelector(".sg-role-chip");
                if (rc) {
                  const rr = rc.getBoundingClientRect();
                  if (rr.width > 0 && rr.height > 0) {
                    nameRects.push({
                      cx: (rr.left + rr.width / 2 - cr.left) / S,
                      cy: (rr.top + rr.height / 2 - cr.top) / S,
                      hw: rr.width / 2 / S + 2,
                      hh: rr.height / 2 / S + 2,
                    });
                  }
                }
              });
              const placed = []; // 已放置标签矩形 {cx,cy,hw,hh}

              // 候选点与所有障碍的“间隙”评分：越大越好（>=0 表示不重叠）
              function clearance(cx, cy, hw, hh) {
                let m = Infinity;
                for (const c of avCircles) {
                  const dx = Math.abs(cx - c.x) - hw;
                  const dy = Math.abs(cy - c.y) - hh;
                  // 标签矩形到圆心的近似间隙
                  const gap = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - c.r;
                  if (dx < 0 && dy < 0) {
                    m = Math.min(m, -(c.r + Math.min(hw + dx, hh + dy)));
                  } else {
                    m = Math.min(m, gap);
                  }
                }
                const rectGap = (r) => {
                  const ox = Math.abs(cx - r.cx) - (hw + r.hw);
                  const oy = Math.abs(cy - r.cy) - (hh + r.hh);
                  return Math.max(ox, oy);
                };
                for (const r of nameRects) m = Math.min(m, rectGap(r));
                for (const r of placed) m = Math.min(m, rectGap(r));
                return m;
              }

              edgeEls.forEach(({ path, bg, text, a, b }) => {
                const A = nodeState[a],
                  B = nodeState[b];
                if (!A || !B) return;
                const avA = A.el.querySelector(".sg-avatar").getBoundingClientRect();
                const avB = B.el.querySelector(".sg-avatar").getBoundingClientRect();
                const ax = (avA.left + avA.width / 2 - cr.left) / S;
                const ay = (avA.top + avA.height / 2 - cr.top) / S;
                const bx = (avB.left + avB.width / 2 - cr.left) / S;
                const by = (avB.top + avB.height / 2 - cr.top) / S;
                const dx = bx - ax,
                  dy = by - ay;
                const dist = Math.hypot(dx, dy) || 1;
                const ux = dx / dist,
                  uy = dy / dist;
                const nx = -uy,
                  ny = ux;
                const rA = avA.width / 2 / S + 3,
                  rB = avB.width / 2 / S + 3;
                const x1 = ax + ux * rA,
                  y1 = ay + uy * rA;
                const x2 = bx - ux * rB,
                  y2 = by - uy * rB;

                // 全部直线
                path.setAttribute("d", `M ${x1} ${y1} L ${x2} ${y2}`);

                if (!text || !bg) return;
                const measured = typeof text.getComputedTextLength === "function" ? text.getComputedTextLength() : 0;
                const tw =
                  (measured > 0 ? measured : text.textContent.length * 10) + 10;
                const th = LABEL_H;
                const hw = tw / 2,
                  hh = th / 2;

                // 候选锚点：沿直线参数 t，并附带法向偏移，避开头像/名字/其它标签
                const pointAt = (t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
                // 偏移方向偏向远离画布中心一侧，避开中心拥挤区
                const anchor0 = pointAt(0.5);
                const outX = anchor0[0] - bounds.w / 2,
                  outY = anchor0[1] - bounds.h / 2;
                const outSign = nx * outX + ny * outY >= 0 ? 1 : -1;
                const ts = [0.5, 0.58, 0.42, 0.66, 0.34, 0.72, 0.28];
                const mags = [0, 9, 16, 24, 32, 42, 54];
                const offs = [0];
                mags.forEach((m) => {
                  if (m === 0) return;
                  offs.push(m * outSign, -m * outSign);
                });
                let best = null;
                outer: for (const t of ts) {
                  const [px, py] = pointAt(t);
                  for (const o of offs) {
                    const cx = px + nx * o,
                      cy = py + ny * o;
                    if (cx - hw < 2 || cx + hw > bounds.w - 2) continue;
                    if (cy - hh < 2 || cy + hh > bounds.h - 2) continue;
                    const cl = clearance(cx, cy, hw, hh);
                    if (!best || cl > best.cl) best = { cx, cy, cl };
                    if (cl >= 1) break outer; // 找到无重叠点即可
                  }
                }
                // 没有任何不重叠的落点时，隐藏该标签（不硬塞造成遮挡）；
                // 用户把头像拖开、或换事件重排后腾出空位，会在下次刷新时重新显示。
                if (!best || best.cl < 0) {
                  bg.classList.add("sg-lbl-hide");
                  text.classList.add("sg-lbl-hide");
                  return;
                }
                bg.classList.remove("sg-lbl-hide");
                text.classList.remove("sg-lbl-hide");
                placed.push({ cx: best.cx, cy: best.cy, hw, hh });
                bg.setAttribute("x", best.cx - hw);
                bg.setAttribute("y", best.cy - hh);
                bg.setAttribute("width", tw);
                bg.setAttribute("height", th);
                text.setAttribute("x", best.cx);
                text.setAttribute("y", best.cy);
              });
            }

            /* 拖拽 */
            function attachDrag(el, key) {
              let startX = 0,
                startY = 0,
                origX = 0,
                origY = 0,
                moved = false;
              const st = () => nodeState[key];
              function onMove(cx, cy) {
                // 外层 transform:scale 会把鼠标位移放大/缩小，需还原到未缩放坐标
                const S = scaleFactor || 1;
                const dx = (cx - startX) / S,
                  dy = (cy - startY) / S;
                if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
                const nx = Math.max(24, Math.min(bounds.w - 24, origX + dx));
                const ny = Math.max(24, Math.min(bounds.h - 24, origY + dy));
                st().x = nx;
                st().y = ny;
                el.style.left = nx + "px";
                el.style.top = ny + "px";
                updateEdgesFromDOM();
              }
              function onUp() {
                el.classList.remove("sg-grabbing", "sg-dragging-now");
                if (moved) el.dataset.dragged = "1";
                document.removeEventListener("mousemove", mm);
                document.removeEventListener("mouseup", onUp);
                document.removeEventListener("touchmove", tm);
                document.removeEventListener("touchend", onUp);
              }
              const mm = (e) => onMove(e.clientX, e.clientY);
              const tm = (e) => {
                e.preventDefault();
                onMove(e.touches[0].clientX, e.touches[0].clientY);
              };
              function onDown(cx, cy) {
                moved = false;
                startX = cx;
                startY = cy;
                origX = st().x;
                origY = st().y;
                el.classList.add("sg-grabbing", "sg-dragging-now");
                document.addEventListener("mousemove", mm);
                document.addEventListener("mouseup", onUp);
                document.addEventListener("touchmove", tm, { passive: false });
                document.addEventListener("touchend", onUp);
              }
              el.addEventListener("mousedown", (e) => {
                e.preventDefault();
                onDown(e.clientX, e.clientY);
              });
              el.addEventListener(
                "touchstart",
                (e) => onDown(e.touches[0].clientX, e.touches[0].clientY),
                { passive: true },
              );
            }

            /* 摆动 + 连线跟随 */
            let reqId = null;
            function syncLoop() {
              updateEdgesFromDOM();
              reqId = requestAnimationFrame(syncLoop);
            }
            function startPhysics() {
              document
                .querySelectorAll(".sg-float-inner")
                .forEach((n) => (n.style.animationPlayState = "running"));
              if (!reqId) reqId = requestAnimationFrame(syncLoop);
            }

            /* 高亮相关 */
            function highlightRelated(k) {
              const related = new Set([k]);
              edgeEls.forEach((e) => {
                if (e.a === k) related.add(e.b);
                if (e.b === k) related.add(e.a);
              });
              Object.entries(nodeState).forEach(([key, s]) => {
                s.el.classList.toggle("sg-active", key === k);
                s.el.classList.toggle("sg-dim", !related.has(key));
              });
              edgeEls.forEach(({ path, bg, text, a, b }) => {
                const on = a === k || b === k;
                path.classList.toggle("sg-hl", on);
                path.classList.toggle("sg-dim", !on);
                if (bg) {
                  bg.classList.toggle("sg-hl", on);
                  bg.classList.toggle("sg-dim", !on);
                }
                if (text) {
                  text.classList.toggle("sg-hl", on);
                  text.classList.toggle("sg-dim", !on);
                }
              });
            }
            function clearHighlight() {
              Object.values(nodeState).forEach((s) =>
                s.el.classList.remove("sg-active", "sg-dim"),
              );
              edgeEls.forEach(({ path, bg, text }) => {
                path.classList.remove("sg-hl", "sg-dim");
                if (bg) bg.classList.remove("sg-hl", "sg-dim");
                if (text) text.classList.remove("sg-hl", "sg-dim");
              });
            }

            /* 人物弹窗 */
            const modalOverlay = document.getElementById("sg-modalOverlay");
            function showPerson(key) {
              const p = events[currentIndex].people.find((x) => x.name === key);
              if (!p) return;
              modalOpenKey = key;
              highlightRelated(key);
              document.getElementById("sg-modalAvatar").src = IMG + p.avatar;
              document.getElementById("sg-modalName").textContent = p.name;
              document.getElementById("sg-modalRole").textContent = p.role;
              const tag = document.getElementById("sg-modalRelTag");
              if (!p.rel) {
                tag.textContent = "核心人物 · 本人";
                tag.style.background =
                  "linear-gradient(135deg, var(--primary), #7b96f7)";
              } else {
                const core = events[currentIndex].people.find((x) => x.big);
                const coreName = core ? core.name : "核心";
                tag.textContent = "与" + coreName + "：" + REL[p.rel].name;
                tag.style.background = REL[p.rel].color;
              }
              document.getElementById("sg-modalDeed").textContent = p.deed;
              document.getElementById("sg-modalImpact").textContent = p.impact;
              modalOverlay.classList.add("sg-active");
            }
            function closeModal() {
              modalOverlay.classList.remove("sg-active");
              modalOpenKey = null;
              clearHighlight();
            }
            document
              .getElementById("sg-modalClose")
              .addEventListener("click", closeModal);
            modalOverlay.addEventListener("click", (e) => {
              if (e.target === modalOverlay) closeModal();
            });
            document.addEventListener("keydown", (e) => {
              if (e.key === "Escape") closeModal();
              else if (e.key === "ArrowLeft") goTo(currentIndex - 1);
              else if (e.key === "ArrowRight") goTo(currentIndex + 1);
            });

            /* 事件切换 */
            function goTo(index) {
              if (index < 0 || index >= events.length) return;
              currentIndex = index;
              if (modalOpenKey) closeModal();
              renderIntro();
              renderEventBtns();
              buildGraph();
              startPhysics();
            }

            /* resize 重排 */
            let rzT = null;
            window.addEventListener("resize", () => {
              // 先应用缩放（同步、成本低），再 debounce 重排图谱
              applyScale();
              clearTimeout(rzT);
              rzT = setTimeout(() => {
                renderIntro();
                buildGraph();
                updateArrows();
              }, 150);
            });

            /* 初始化 */
            const graphHint = document.getElementById("sg-graphHint");
            let hintDismissed = false;
            function dismissGraphHint() {
              if (hintDismissed) return;
              hintDismissed = true;
              graphHint?.classList.add("sg-hide");
            }
            graphWrap.addEventListener("pointerdown", dismissGraphHint, {
              passive: true,
            });

            function init() {
              applyScale();
              renderIntro();
              renderEventBtns();
              buildGraph();
              startPhysics();
              // 预热图片：事件配图 + 人物头像
              const preload = new Set();
              events.forEach((e) => {
                if (e.image) preload.add(IMG + e.image);
                e.people.forEach((p) => p.avatar && preload.add(IMG + p.avatar));
              });
              preload.forEach((src) => {
                const im = new Image();
                im.src = src;
              });
              // 操作提示条 6 秒后自动淡出（头像自身持续呼吸，无需额外首屏脉冲）
              setTimeout(dismissGraphHint, 6000);
            }
            if (document.readyState === "loading")
              window.addEventListener("load", init);
            else init();
            // 用最终视口尺寸再定一次基准，避免刷新后卡在错误基准/窄版（见等比缩放 Skill §5.9）
            window.addEventListener("load", applyScale);

  }
  function create(options) { const root = document.createElement('div'); mount(root, options); return root; }
  global.QinShihuangLibrary = { mount, create, __fromPack };
})(window);
