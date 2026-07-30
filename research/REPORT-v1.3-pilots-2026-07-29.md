# Data Pack v1.3 三类 Pilot 可复现实验报告

- 实验日期：2026-07-29
- 实验入口：`node research/run-v1.3-pilots.js`
- 机器结果：`research/results/v1.3-pilot-results.json`
- 自动回归：`node --test tests/*.test.js`

## 1. 研究问题

本轮实验验证四个问题：

1. ID-based、中文名称引用、collection/monolith 三类数据形态能否使用同一份 v1.3 契约；
2. contextual alias、稳定 relation id 和 stage relation 消歧能否同时通过运行时校验；
3. 数据变更能否通过 derivations 传播到受影响消费者；
4. recrawl 字段映射、模板化和 TypeScript 声明生成能否形成可重复执行的 CLI 链路。

## 2. Pilot 设计

| Pilot | 重点 | Fixture |
|---|---|---|
| ID-based graph | 稳定实体 ID、scoped relation、relation id、stage 引用 | `research/fixtures/v1.3/id-based/data.json` |
| Chinese-name graph | 中文 alias、`{id,context}`、旧引擎名称重建、recrawl 字段映射 | `research/fixtures/v1.3/chinese-name/` |
| Collection | `kindNameFields`、资产、重复卡片、derivation blast radius | `research/fixtures/v1.3/collection/` |

所有 fixture 均为仓库内可公开复现的合成最小样本，不代表真实站点爬取准确率。

## 3. 方法

```bash
# 三类 pack 的统一实验
node research/run-v1.3-pilots.js

# 完整回归
node --test tests/*.test.js

# 可单独复核
node scripts/sg-data-pack validate research/fixtures/v1.3/id-based/data.json
node scripts/sg-data-pack validate research/fixtures/v1.3/chinese-name/data.json
node scripts/sg-data-pack validate research/fixtures/v1.3/collection/data.json
node scripts/sg-data-pack diff research/fixtures/v1.3/collection/data.json research/fixtures/v1.3/collection/data-v2.json --json
node scripts/sg-data-pack recrawl-skeleton research/fixtures/v1.3/chinese-name/data.json research/fixtures/v1.3/chinese-name/records.json --out /tmp/sg-recrawl
node scripts/sg-data-pack templatize research/fixtures/v1.3/collection/instances.json
```

## 4. 结果

### 4.1 统一契约

| Pilot | Entities | Relations | Stages | Derivations | Errors | Warnings |
|---|---:|---:|---:|---:|---:|---:|
| ID-based | 3 | 2 | 2 | 1 | 0 | 0 |
| Chinese-name | 2 | 1 | 1 | 1 | 0 | 0 |
| Collection | 3 | 0 | 1 | 1 | 0 | 0 |

三类样本均通过 `SGDataLoader.validate`，说明 v1.3 最小契约能够覆盖这三种数据形态。

### 4.2 数据演化与 blast radius

Collection v2 将 `work-beta.cover` 从 `beta.png` 修改为 `beta-v2.png`。diff 结果同时检测到：

- `entities.work-beta.cover` 变化；
- 旧资产移除；
- 新资产加入；
- `carouselItems` derivation 被触发；
- 消费者 `components.carouselItem` 进入回归范围。

这验证了“数据字段 → derivation → consumer”的最小闭环。

### 4.3 中文名称 recrawl

输入 2 条记录：

- alias 命中：2；
- miss：0；
- conflict：0；
- 人工审核：0；
- `birthDate -> birth` 显式字段映射命中。

本轮同时修复了“缺失 birth 字段错误回退到 actor/role，导致假冲突”的问题。

### 4.4 Collection 模板化

- 输入实例：3；
- 推导 slot：3；
- byte-exact：通过。

当前算法保证可逆，但 slot 边界仍可能包含闭合标签。因此 byte-exact 已验证，语义 slot 命名仍需人工复核。

### 4.5 类型生成

Collection pilot 成功生成 2179 bytes 的 `.d.ts`，并包含 `CollectionPilotWorkEntity`。contextual alias、relation id 和 `alsoTouches` 已进入生成类型。

## 5. 本轮得到的工程结论

1. relation 的 `scope` 必须进入 diff identity，否则同 `(a,b,type)` 多边会被 Map 覆盖；
2. 推荐为多边关系设置稳定 `relation.id`，并用它作为 provenance 和 stage ref 的首选键；
3. `affects` 是选择器/呈现区域，不是 pack path；只有 `source` 和 `alsoTouches` 应执行路径解析；
4. recrawl 跨字段比较必须使用显式 `meta.recrawlFieldMap`，不能进行无条件 actor/role fallback；
5. domain、attributeTypes、relationTypes 等顶层变化必须计入 diff 退出码，不能只产生旁路提示。

## 6. 局限

- 三类 fixture 是合成最小样本，尚未构成真实网页 benchmark；
- JSON Schema 仍主要是契约产物，CLI 的权威执行层仍是 `SGDataLoader`；
- templatize 只验证 byte-exact，没有自动判断 slot 的业务语义；
- alias 候选尚无 precision/recall 标注集；
- extract equivalence 目前已接入一个真实组件库引擎（秦始皇事件图谱 fixture），仍需至少两个不同形态的真实组件库引擎。

## 7. 下一实验

1. 将第二、第三类真实组件库匿名 fixture 接入 extraction/equivalence（首个真实 Qinshihuang fixture 已纳入 `tests/extract-integration.test.js`）；
2. 为 alias-candidates 建立人工标注名称集并计算 Top-1/Top-3 命中率；
3. 为 templatize 增加可选节点、嵌套标签和异质项拒绝实验；
4. 增加 JSON Schema/runtime parity 自动检查；
5. 在结果稳定后再发布首个带 tag 的版本。
