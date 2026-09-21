# SG Data Pack 跨环境交接

交接日期：**2026-09-21（Asia/Shanghai）**。本文件是下一位开发者 / Agent 的接手入口，不依赖旧机器上的聊天记录、全局 Skill 安装或本地配置。

## 1. 使用哪个版本

- 远程：`https://github.com/SuTang-vain/sg-data-pack.git`
- 后续集成分支：`main`
- 固定交接快照：标签 `handoff-2026-09-21`
- 原功能分支：`codex/agent-task-experiments`，保留，不删除、不改写历史。

交接前，`main` 已有 Agent 实验代码，但缺少 `ebccd45` 中的 103 个文档产物；本次将两条历史合并，再补齐迁移说明与遗漏的证据文件。交接推送时两条分支指向同一提交。后续开发允许分支再次分叉；复现此次交接请使用标签，而不是假设分支永远不变。

## 2. 在新环境启动

基础需求：**Git + Node.js ≥ 18**。仓库 CI 配置为 Node 18 / 22；可选择 Node 22 与现有 CI 对齐。运行核心 CLI 不需要 Python、浏览器、Agent 登录或 API key，也没有 `package.json` / `npm install` 步骤；Acorn 已内置在 `scripts/vendor/`。

```bash
git clone https://github.com/SuTang-vain/sg-data-pack.git
cd sg-data-pack
git fetch --tags

# 从固定交接快照创建自己的开发分支；分支名可按需更换。
git switch -c codex/next-stage handoff-2026-09-21

node --version
git --version
node scripts/verify-handoff.js
git status --short
```

正常结果：验证器退出 `0` 并输出 `Handoff verification PASSED`，最后的 `git status --short` 为空。若要继续跟进主线而非固定快照，则使用 `git switch main && git pull --ff-only`。

验证器从自己的文件位置定位仓库，不依赖旧 checkout 的绝对路径，依次检查：

1. CLI 帮助入口；
2. 完整 Node 测试；
3. 冻结任务、30 个 TaskRun、188 个已列举制品的摘要、迁移审计与历史执行工具树；
4. 3 个 v1.3 pilot 的验证、差异影响、recrawl、模板字节等价和类型生成。

它不联网、不调用付费模型、不启动新浏览器实验、不安装依赖、不重建冻结 ID、不重写历史报告。**通过的是离线接手检查，不等于新机器的浏览器 / AI / 文档渲染已经验收。**

建议在 Linux/macOS 的工作目录中接手；原生 Windows 的完整测试与文件权限行为尚未验收。若用 WSL，优先在 Linux 文件系统中 clone，保留执行位、符号链接与原始字节，不要用编辑器批量转换换行。

## 3. 目录职责与阅读顺序

| 路径 | 内容与维护边界 |
| --- | --- |
| `HANDOFF.md`、`AGENTS.md` | 人和 Agent 的接手入口、开发约束 |
| `README.md` | 产品说明、安装与命令索引 |
| `SKILL.md`、`agents/openai.yaml` | 可安装的 Skill 工作流与 UI 元数据 |
| `scripts/sg-data-pack` | 核心 CLI 调度入口；无需常驻服务 |
| `scripts/sg-pack-*.js` | 各子命令的参数、输入输出与编排 |
| `scripts/lib/` | Loader、Schema、抽取、审核、报告、任务 / 实验实现 |
| `scripts/vendor/acorn.js` | 仓库内置的解析器，不另行 npm 安装 |
| `assets/extract.config.template.js` | 为外部组件库编写抽取配置的模板 |
| `references/` | 契约与方法文档；改实现时同步检查对应契约 |
| `tests/`、`tests/fixtures/` | 单测、集成测试与真实引擎夹具 |
| `research/fixtures/v1.3/` | 3 个可重复 pilot；不是生产业务数据 |
| `research/run-v1.3-pilots.js`、`research/results/` | pilot 执行器与历史结果；新运行结果只输出到 stdout |
| `research/agent-eval/tasks/`、`providers/` | 内容绑定的任务、grader 与 Agent 适配器 |
| `research/agent-eval/results/` | 冻结实验原始证据，包括当时实际执行的工具副本；不是待清理缓存 |
| `docs/` | README 插图与本次交接验证记录 |
| `.github/workflows/smoke.yml` | Node 18/22 smoke、完整测试与干净 checkout 的证据审计 |
| `.doc-build/` | 技术产品文档源脚本和已归档示意图；见该目录的 `README.md` |
| `.doc-render-v1/`、`.doc-render-v2/` | 历史 PDF 导出和逐页图 |
| `.pdf-render-v1/`、`.pdf-render-v2/`、`.font-render*` | 历史 PDF / 字体验证图，保留用于交接，不自动覆盖 |

推荐先读 `README.md` → `SKILL.md` → `references/data-pack-contract.md`。做业务演化再读 `review-candidate-contract.md` / `run-report-contract.md`；做 Agent 实验先读 `research/agent-eval/README.md` 和对应 task/evidence contracts。

本仓库是工具和 Skill，**不包含任意外部目标组件库的完整工作目录**。下一阶段若针对某个实际组件库，需要另行迁移其源码、抽取配置、资产、canonical `data.json` 和已审核材料。仓库中的试验夹具不能冒充那个业务库。

## 4. 日常使用与可选 Skill 安装

在仓库根目录运行，无需全局安装：

```bash
node scripts/sg-data-pack --help
node --test tests/*.test.js
node research/agent-eval/audit-results.js
node research/run-v1.3-pilots.js
```

`verify-handoff.js` 会显式枚举测试文件，避免不同 shell 的通配符行为差异；不要使用 `node --test tests` 代替上述完整命令。

如果新环境确实需要安装为 Skill，可把新 clone 目录链接到该工具的 skills 目录；**不要复制旧机器的绝对路径或覆盖已有安装**。例如（先确认目标不存在）：

```bash
mkdir -p "$HOME/.codex/skills"
ln -s "$PWD" "$HOME/.codex/skills/sg-data-pack"
```

Claude Code / ZCode 按各自 skills 目录处理；仅使用 CLI 则无需这些步骤。

## 5. 可选能力与依赖

| 场景 | 额外需求 | 本次默认验收是否执行 |
| --- | --- | --- |
| 核心 CLI、测试、历史证据审计 | Git、Node | 是 |
| 新的 scripted Pattern C 实验 | Chrome/Chromium 可执行程序、PATH 上的 `python3` 和 Pillow | 否 |
| 新的真实 Agent 实验 | 相应 `claude` / `codex` CLI、授权、网络、模型权限 / 额度；含 Pattern C 时还需浏览器依赖 | 否 |
| 重建技术 Word 文档 | Python、python-docx、Pillow、中文字体 | 不属于离线验收 |
| 重建技术 PDF | Python、ReportLab、兼容的中文 TrueType 字体 | 不属于离线验收 |

浏览器 grader 探测 macOS 应用路径及 PATH 中的 `google-chrome` / `chromium` 等命令。不要为了迁移直接改冻结 grader 字节：先检查执行环境；如确需修改，按新实验版本处理并重新绑定 ID。

文档脚本已去除旧仓库 / Desktop 的硬编码路径；输出默认写入忽略的 `.doc-build/output/`。用 `SG_DOC_OUTPUT_DIR` 指定输出目录，`SG_DOC_FONT` 指定本机已授权的字体文件；Word 的字体名称用 `SG_DOC_FONT_NAME` 配置。详细命令见 `.doc-build/README.md`。字体文件本身、字体授权和 Python 环境不随仓库迁移。

现有 PDF/PNG 原样归档；文档源描述的是 2026-08-06 的分析，重建不会自动更新里面的历史统计。完整正式 DOCX 不在仓库中，需从源脚本重建；已提交的 `font-test.docx` 只是字体样张。原脚本指向的 Desktop 最终文件在交接时不在该位置，不能声称已备份这些仓库外文件。

## 6. 证据、凭证与本机文件边界

- 历史实验 JSON / 日志中的旧绝对路径是**执行元数据**，不是新机器需要创建的目录。审计使用报告中的相对 artifact 路径；不要全局替换那些字符串，否则会破坏内容 ID / 摘要。
- 原来 `*.log` 把 18 个有摘要绑定的 `*.chrome.log` 排除在版本控制外。本次加入这些原始文件及精准 ignore 例外，修复“本机能通过，新 clone 缺文件”。历史报告、模型结论和证据 ID 未因此重算。
- `.gitattributes` 保持普通文本为 LF；冻结任务 / 结果 / 夹具不做换行转换，避免跨环境 hash 漂移。
- `.DS_Store`、普通运行日志、`node_modules/`、虚拟环境、缓存和新生成文档不必迁移。空的 `.doc-render/` 没有内容，Git 不会记录它。
- `.env`、API key、SSH key、Git 凭证、Agent 登录态、全局用户配置**不上传、不复制进仓库**。新环境单独授权；`.gitignore` 不是密钥扫描的替代品。
- 不要把新实验写回已冻结的 `results/`；输出到新的外部目录，保留原始失败记录。

## 7. 接手后优先事项 / 禁止误判

1. 先跑离线验收并保存新环境版本信息；如果 hash / mode 漂移，查换行转换、文件权限、漏文件，而不是直接执行 `build-fixtures.js`。
2. 明确下一阶段针对核心数据契约、审核报告还是 Agent 评测，以及是否另有目标组件库；本次只做交接，不擅自制定新的功能需求。
3. 如需新的 runtime/visual 结论，在新环境独立安装并验收浏览器、字体和 Pillow，再运行新实验；不能把历史截图等同于新机器测试通过。
4. 如需真实 Agent，先确认预算和授权。scripted 的 15/15 只证明 harness；历史真实实验是 7/14 有效试验通过，`ai-static-contract-only`，不代表通用自治修改能力。
5. portable runner 没有 OS / filesystem / network / process 隔离，也不能对恶意本地进程隐藏 grader。需要强隔离时应在新环境另建安全执行边界。
6. 保留 Data Pack 的稳定 ID、引用优先、严格校验、人工 Review Decisions、canonical `data.json` 及分层证据要求。不要把 `NOT_ASSESSED` 改成通过。

本次验证范围和已知限制见 `docs/handoff-2026-09-21.md`。今后每次交接均应重新 fetch、检查分支 ahead/behind、提交并推送有效文件，并在干净 clone 中复跑验收；工作区干净本身不保证所有被引用文件已上传。
