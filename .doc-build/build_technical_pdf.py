from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether, HRFlowable
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from pathlib import Path

OUT=Path('/Users/tangyaoyue/Desktop/SG-Data-Pack-技术产品解说.pdf')
BUILD=Path('/Users/tangyaoyue/DEV/sg-data-pack/.doc-build')
FONT='/System/Library/AssetsV2/com_apple_MobileAsset_Font7/eb257c12d1a51c8c661b89f30eec56cacf9b8987.asset/AssetData/STHEITI.ttf'
pdfmetrics.registerFont(TTFont('Heiti',FONT))

NAVY=HexColor('#16324F'); BLUE=HexColor('#3A7CA5'); CYAN=HexColor('#DCEEF5'); LIGHT=HexColor('#F4F7F9'); DARK=HexColor('#1E2933'); MUTED=HexColor('#5F6B75'); CORAL=HexColor('#E76F51'); GREEN=HexColor('#2A9D8F'); YELLOW=HexColor('#F4D35E'); BORDER=HexColor('#CBD5DC'); WHITE=colors.white

styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='CN',fontName='Heiti',fontSize=9.4,leading=14,textColor=DARK,spaceAfter=5))
styles.add(ParagraphStyle(name='Small',fontName='Heiti',fontSize=8,leading=11,textColor=MUTED))
styles.add(ParagraphStyle(name='H1CN',fontName='Heiti',fontSize=20,leading=25,textColor=NAVY,spaceBefore=3,spaceAfter=10,keepWithNext=True))
styles.add(ParagraphStyle(name='H2CN',fontName='Heiti',fontSize=13.2,leading=18,textColor=BLUE,spaceBefore=8,spaceAfter=6,keepWithNext=True))
styles.add(ParagraphStyle(name='H3CN',fontName='Heiti',fontSize=10.4,leading=14,textColor=DARK,spaceBefore=6,spaceAfter=4,keepWithNext=True))
styles.add(ParagraphStyle(name='Kicker',fontName='Helvetica-Bold',fontSize=7.5,leading=9,textColor=CORAL,spaceAfter=3))
styles.add(ParagraphStyle(name='BulletCN',fontName='Heiti',fontSize=9,leading=13,textColor=DARK,leftIndent=12,firstLineIndent=-8,spaceAfter=3,bulletIndent=0))
styles.add(ParagraphStyle(name='NumCN',fontName='Heiti',fontSize=9,leading=13,textColor=DARK,leftIndent=15,firstLineIndent=-12,spaceAfter=3))
styles.add(ParagraphStyle(name='CodeCN',fontName='Heiti',fontSize=7.7,leading=10.2,textColor=HexColor('#334155')))
styles.add(ParagraphStyle(name='TableHead',fontName='Heiti',fontSize=8,leading=10,textColor=WHITE))
styles.add(ParagraphStyle(name='TableCell',fontName='Heiti',fontSize=7.7,leading=10.2,textColor=DARK))
styles.add(ParagraphStyle(name='TableSmall',fontName='Heiti',fontSize=7.1,leading=9.2,textColor=DARK))
styles.add(ParagraphStyle(name='CallTitle',fontName='Heiti',fontSize=9.2,leading=12,textColor=BLUE,spaceAfter=3))
styles.add(ParagraphStyle(name='CallBody',fontName='Heiti',fontSize=8.6,leading=12,textColor=DARK))
styles.add(ParagraphStyle(name='CoverBig',fontName='Heiti',fontSize=29,leading=35,textColor=NAVY,spaceAfter=0))
styles.add(ParagraphStyle(name='CoverSub',fontName='Heiti',fontSize=16,leading=21,textColor=BLUE,spaceAfter=5))
styles.add(ParagraphStyle(name='Quote',fontName='Heiti',fontSize=13,leading=20,textColor=NAVY,alignment=TA_CENTER,spaceBefore=10,spaceAfter=8))

PAGE_W,PAGE_H=A4

def P(text, style='CN'): return Paragraph(text,styles[style])
def H1(text,kicker=None):
    out=[]
    if kicker: out.append(P(kicker.upper(),'Kicker'))
    out.append(P(text,'H1CN')); return out
def H2(text): return P(text,'H2CN')
def H3(text): return P(text,'H3CN')
def bullet(text): return Paragraph('• '+text,styles['BulletCN'])
def num(n,text): return Paragraph(f'{n}. {text}',styles['NumCN'])
def S(h=4): return Spacer(1,h*mm)

def callout(title,body,color=BLUE):
    data=[[P(title,'CallTitle'),P(body,'CallBody')]]
    t=Table(data,colWidths=[31*mm,130*mm],hAlign='CENTER')
    t.setStyle(TableStyle([
        ('BACKGROUND',(0,0),(-1,-1),HexColor('#EFF6F8') if color==BLUE else HexColor('#FFF2EE')),
        ('LINEBEFORE',(0,0),(0,-1),4,color),('VALIGN',(0,0),(-1,-1),'TOP'),
        ('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7),
    ])); return t

def code(text):
    lines='<br/>'.join(x.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;') for x in text.splitlines())
    t=Table([[P(lines,'CodeCN')]],colWidths=[163*mm],hAlign='CENTER')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),HexColor('#F3F5F7')),('BOX',(0,0),(-1,-1),0.5,HexColor('#D8DEE4')),('LEFTPADDING',(0,0),(-1,-1),8),('RIGHTPADDING',(0,0),(-1,-1),8),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)])); return t

def table(headers,rows,widths,small=False):
    st='TableSmall' if small else 'TableCell'
    data=[[P(h,'TableHead') for h in headers]]+[[P(str(v),st) for v in r] for r in rows]
    t=Table(data,colWidths=[w*mm for w in widths],repeatRows=1,hAlign='CENTER')
    commands=[('BACKGROUND',(0,0),(-1,0),NAVY),('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),0.25,HexColor('#D8DEE4')),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]
    for i in range(1,len(data)):
        commands.append(('BACKGROUND',(0,i),(-1,i),HexColor('#F7F9FA') if i%2 else WHITE))
    t.setStyle(TableStyle(commands)); return t

def page_header_footer(c,doc):
    c.saveState()
    if doc.page>1:
        c.setStrokeColor(BORDER); c.setLineWidth(0.5); c.line(20*mm,PAGE_H-16*mm,PAGE_W-20*mm,PAGE_H-16*mm)
        c.setFont('Helvetica-Bold',7.5); c.setFillColor(NAVY); c.drawString(20*mm,PAGE_H-12.5*mm,'SG DATA PACK')
        c.setFont('Heiti',7.5); c.setFillColor(MUTED); c.drawString(48*mm,PAGE_H-12.5*mm,'/ 技术产品解说')
    c.setFillColor(MUTED); c.setFont('Heiti',7)
    c.drawRightString(PAGE_W-27*mm,10*mm,'内部技术说明 · 2026-08-06')
    c.setFont('Helvetica',8); c.setFillColor(NAVY); c.drawRightString(PAGE_W-20*mm,10*mm,str(doc.page))
    c.restoreState()

story=[]
# cover
story += [S(22),P('SG DATA PACK','Kicker'),S(4),P('组件库数据治理与','CoverBig'),P('可信变更链','CoverBig'),S(7),P('技术产品解说','CoverSub'),P('从散乱业务数据，到可验证、可审核、可解释的组件数据基础设施','CN'),S(14)]
cover_data=[]
for n,t,b,c in [('01','规范化','稳定实体 ID、别名、主关系和阶段引用',NAVY),('02','可验证','契约校验、无损等价、运行时与视觉证据',BLUE),('03','可演化','Recrawl、人工决策、Candidate 与影响分析',GREEN)]:
    cell=Table([[Paragraph(f'<font color="#F4D35E" size="11">{n}</font>',styles['CN'])],[Paragraph(f'<font color="white" size="14">{t}</font>',styles['CN'])],[Paragraph(f'<font color="white" size="8">{b}</font>',styles['CN'])]],colWidths=[53*mm],rowHeights=[11*mm,13*mm,26*mm])
    cell.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),c),('ALIGN',(0,0),(-1,-1),'CENTER'),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)])); cover_data.append(cell)
ct=Table([cover_data],colWidths=[53*mm]*3,hAlign='CENTER'); ct.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)])); story += [ct,S(15),P('<font color="#16324F">适用对象</font>　产品负责人 · 组件库维护者 · 数据工程师 · 技术架构师 · AI 工程负责人','Small'),S(2),P('<font color="#16324F">分析基线</font>　当前分支 codex/agent-task-experiments，提交 d76bb32','Small'),PageBreak()]

# 1 exec
story += H1('执行摘要','Executive Overview')
story += [callout('一句话定位','SG Data Pack 是一套面向遗留组件库的数据层标准化与变更治理工具链。它把散落在 JavaScript 默认值、HTML 模板、外部 JSON 和阶段副本中的业务数据，转化为统一 Data Pack，并用校验、等价性、审核、影响分析和证据报告保证变更可信。'),S(5),H2('它解决的不是“JSON 放在哪里”，而是四个工程问题'),table(['问题','传统表现','SG Data Pack 的回答'],[
('身份不稳定','名称、中文别名、数组下标混用','稳定 slug ID + aliases + sameAs'),('关系易漂移','多阶段重复人物和边，局部修改不同步','主关系只存一次，stage 只引用并保存 overlay'),('抓取会静默污染','爬取结果直接覆盖，错误关系不报错','E1-E16 fail loudly + Review Decisions'),('验证结论被夸大','JSON 正确被等同于页面正确','结构、等价、运行、视觉、审核五层证据')],[29,55,79]),S(5),H2('产品本质'),P('它不是单一抽取脚本，而是由三层产品能力组成：'),num(1,'Data Pack 契约与迁移：定义统一数据模型，并保持旧渲染引擎兼容。'),num(2,'数据演化与工程交付：把 recrawl 观察转化为可审核 Candidate 和统一报告。'),num(3,'Agent 任务评测：验证 AI 是否能够在受约束条件下完成真实修改，而不是只验证数据文件。'),S(4),callout('核心判断','项目最有价值的能力是“可信变更链”，而不是“抽取数据”。规范化只是起点；真正的产品壁垒是来源、审核、影响和验证能够被同一套机制串联。',CORAL),PageBreak()]

# 2 context
story += H1('01  产品背景与使用场景','Product Context')
story += [H2('遗留组件库的数据为什么特别难治理'),P('从完整 HTML 案例页拆解出的组件库，通常继承了页面级代码的所有偶然性。业务数据不是一个明确的数据层，而是分散在：')]
for x in ['引擎 IIFE 或 UMD 中的 options fallback；','模板字符串中的长文、时间线和高亮引用；','示例 HTML 的 &lt;script type="application/json"&gt;；','以中文名称或数组序号表达的关系；','每个历史阶段各自复制的一套人物、布局和边；','图片路径、颜色枚举和展示规则等隐式常量。']: story.append(bullet(x))
story += [S(4),H2('典型风险'),table(['风险','发生方式','最终后果'],[
('重复实体','同一人物在不同阶段保存完整副本','一个阶段已更新，其他阶段继续展示旧数据'),('悬空关系','爬虫名称变化、别名未解析','关系图缺边，但渲染器可能静默忽略'),('默认值漂移','engine fallback 和外部数据分别修改','测试环境和生产注入产生不同结果'),('来源丢失','只保留最终字段值','无法解释是谁、何时、依据什么修改'),('影响未知','数据被引擎排序、复制、投影','小字段变化导致多个展示区域变化')],[29,61,73]),S(4),H2('适合与不适合'),table(['适合','不适合'],[
('关系图、时间线、人物卡片、作品集合等数据驱动组件','完全由现代 API 和强类型模型驱动的新项目'),('需要持续补数、recrawl、人工复核的组件库','需要直接执行不可信第三方代码的在线服务'),('不能大幅重写渲染器，但需要治理数据的遗留系统','超大规模、需要分片和流式加载的数据集'),('希望让 AI 修改组件，但要求可审计证据','只追求一次性快速迁移、不维护长期契约的项目')],[81.5,81.5]),PageBreak()]

# 3 architecture
story += H1('02  产品架构：可信数据变更链','Architecture')
story += [Image(str(BUILD/'architecture.png'),width=164*mm,height=83.8*mm),S(3),H2('三条主链路'),table(['链路','输入','输出','主要保证'],[
('迁移链','引擎字面量、HTML、JSON script','规范化 Data Pack','声明范围内无损、旧引擎兼容'),('演化链','Baseline + crawl records + 人工 Decisions','Candidate + Audit','不自动猜测身份，不允许静默覆盖'),('交付链','Validation + Rules + Diff + Evidence','RunReport','人和 CI 共享同一结论模型')],[23,46,43,51]),S(4),H2('架构思想')]
for x in ['反腐层：Data Pack 不直接侵入旧 renderer，而由 __fromPack 还原旧 options。','Fail closed：输入不完整、来源漂移、审核缺失或引用不唯一时拒绝继续。','内容寻址：关键输入输出使用 SHA-256 绑定，确保“审核的就是最终应用的”。','证据分层：数据契约、无损等价、运行时和视觉验证互不替代。','严格核心、开放领域：统一身份与引用规则，业务差异进入 domain。']: story.append(bullet(x))
story.append(PageBreak())

# 4 pack
story += H1('03  Data Pack：统一数据契约','Data Model')
story += [Image(str(BUILD/'pack-anatomy.png'),width=164*mm,height=94.5*mm),S(2),H2('核心字段与职责'),table(['区域','作用','设计价值'],[
('entities','以稳定 ID 保存唯一实体','显示名可变，关系和来源保持稳定'),('aliases','外部名称到 canonical ID 的入口','隔离抓取名称和内部主键'),('relationTypes / relations','关系枚举与 master edge','边只保存一次，可验证、可复用'),('stages / overlay','阶段成员、布局、关系引用和上下文覆盖','共享事实不复制，阶段差异不污染实体'),('contents / domain','长文内容与库级业务扩展','通用契约不膨胀'),('assets','资源存在性、大小与 hash','资源成为可验证数据的一部分'),('provenance','记录级和字段级来源','支持审核、置信度和追责'),('derivations','数据到展示的非平凡推导','把隐藏在引擎中的影响面显式化')],[36,62,65],True),PageBreak()]

# 5 identity
story += H1('04  关键设计一：稳定身份与引用关系','Identity & Relations')
story += [H2('为什么不能直接用名称做引用'),code('entities.chengbing = { kind: "person", name: "程兵" }\naliases["程 兵"] = "chengbing"\nrelations[0] = { a: "chengbing", b: "wangdayong", type: "rival" }'),S(3),P('名称属于展示和外部输入，ID 才属于关系。这样名称、空格、繁简体或展示字段变化，不会迫使全图重写。'),H2('主关系 + 阶段引用'),code('relations: [\n  { id: "a-b-advisor", a: "a", b: "b", type: "advisor", scope: ["stage-1"] }\n]\n\nstages: [\n  { key: "stage-1", entities: ["a", "b"],\n    relations: [{ a: "a", b: "b", id: "a-b-advisor" }],\n    overlay: { a: { role: "阶段身份" } } }\n]'),S(3),H2('设计优势')]
for x in ['同一实体跨阶段共享，避免副本漂移；','关系枚举、端点、scope 和 stage ref 可以统一校验；','阶段上下文进入 overlay，不会污染实体的长期事实；','Diff 可以精确识别实体、关系、阶段顺序和字段变化。']: story.append(bullet(x))
story += [H2('当前限制'),table(['限制','影响'],[
('contextual alias 只保存 context，解析时仍直接取 id','不能真正解决同名实体的多语境映射'),('关系默认按 a → b 有方向组织','无向关系需要组件库自行约定 canonical ordering'),('relation identity 可能来自复合字符串','修改 type/scope 时 provenance key 也可能变化'),('缺少正式 ID rename/migration','早期主键选择错误会形成长期迁移成本')],[69,94]),PageBreak()]

# 6 migration
story += H1('05  关键设计二：低风险迁移与旧引擎兼容','Migration Strategy')
story += [H2('为什么保留 __fromPack'),P('项目没有要求旧渲染器立即理解新模型，而是把 Data Pack 还原为原 options 结构，再走原来的渲染路径。这是典型的 Branch by Abstraction：先替换数据来源，再逐步演进渲染器。'),table(['方案','迁移风险','验证难度','项目选择'],[
('直接重写 renderer 读取 Data Pack','高：数据和渲染同时变化','高：失败来源难定位','否'),('只生成新 JSON，renderer 自行适配','中高：每个库适配方式不同','中高','否'),('Data Pack → __fromPack → 旧 options','低：保留原代码路径','可用 deep equivalence 证明映射','是')],[53,41,46,23]),S(4),H2('抽取机制')]
for i,x in enumerate(['配置正则定位字面量表达式起点。','Acorn parseExpressionAt 确定嵌套表达式边界。','buildPack 将源结构转换为 entities、aliases、relations 和 domain。','__fromPack 重新构造旧数据结构，并与源 defaults deep-equal。','通过后生成 data.json、data.js 和 data.schema.json。'],1): story.append(num(i,x))
story += [S(3),callout('重要边界','等价性只证明 extraction config 明确声明的 literal 映射，不证明真实 DOM mount、动画和视觉效果。项目对此边界表达清晰，这是设计优势。'),S(4),H2('代价与风险')]
for x in ['正式 Data Pack 和 engine fallback 仍然物理共存；单一真源依赖流程纪律，而非完全消除副本。','正则定位和 ctx 注入对复杂、压缩或运行时计算的数据较脆弱。','new Function、require config 和 require engine 都是可信代码执行，不是安全沙箱。','如果 CI 不持续执行 compile --check / compare-existing，fallback 可能逐步漂移。']: story.append(bullet(x))
story.append(PageBreak())

# 7 validation
story += H1('06  关键设计三：Fail Loudly 的运行时契约','Validation')
story += [H2('两层验证'),table(['层级','负责内容','典型示例'],[
('JSON Schema','字段形状、必填项、基础类型','schemaVersion、meta、relation item 结构'),('SGDataLoader','跨记录语义与引用完整性','悬空边、stage 消歧、provenance 指向、derivation path')],[31,63,69]),S(4),H2('E1-E16 覆盖的主要风险'),table(['类别','关键检查'],[
('版本与元信息','schemaVersion、meta.id、meta.title、置信度阈值'),('实体与别名','稳定 slug、显示字段、alias target、ID 冲突'),('关系与阶段','端点、类型注册、scope、唯一 stage edge resolution、布局范围'),('内容与资产','高亮引用、资源登记、资源 hash'),('来源与身份','sameAs、record/field provenance、sourceUrl、confidence'),('影响声明','derivation kind、source、alsoTouches、consumers 和 affects')],[41,122]),S(4),H2('优势与代价'),table(['优势','代价'],[
('错误在 mount 或 CI 中被聚合抛出，不会变成静默缺图','生产运行时遇到错误可能导致整个组件不可用'),('语义验证远强于纯 JSON Schema','运行时 loader 需要维护大量手工规则'),('Warnings 保留不确定性，不强行把所有问题变成阻断','strict/non-strict 的使用需要团队统一'),('支持浏览器和 Node 的零依赖 UMD','validate 函数已成为 500+ 行的复杂度热点')],[81.5,81.5]),PageBreak()]

# 8 provenance
story += H1('07  来源、影响与证据设计','Provenance & Impact')
story += [H2('为什么 provenance 独立于实体'),P('来源信息放在平行 provenance 区域，而不是直接嵌入业务实体。这样旧引擎不需要识别审计字段，业务模型和治理模型保持解耦。'),code('provenance.entities.alice = {\n  origin: "crawl:reviewed",\n  sourceUrl: "https://example.test/source",\n  confidence: 0.95,\n  fieldOrigins: { occupation: { origin: "crawl:reviewed", confidence: 0.95 } }\n}'),S(4),H2('derivations：把隐式影响面显式化'),code('derivations.carouselTrack = {\n  kind: "repeat",\n  source: "domain.carouselTrack.entityIds",\n  alsoTouches: ["entities.*"],\n  consumers: ["components/carousel-item.js"],\n  affects: [".carousel-track"],\n  note: "数据会为无限循环重复渲染两份"\n}'),S(4),table(['设计','价值','局限'],[
('平行 provenance','不污染旧引擎；支持记录级和字段级来源','编辑值时需要同步维护来源'),('confidence + threshold','把不确定性显式进入 review 列表','置信度仍依赖来源和人工判断'),('derivation source','Diff 可以定位受影响的消费者','声明不是可执行依赖，可能陈旧'),('affects / consumers','把技术影响翻译成回归范围','通用 validator 不检查文件和 selector 是否真实存在')],[39,63,61]),PageBreak()]

# 9 assurance
story += H1('08  验证策略：不夸大任何一层证据','Assurance Model')
story += [Image(str(BUILD/'assurance.png'),width=164*mm,height=73.3*mm),S(3),H2('为什么这种分层很重要'),P('数据驱动组件最常见的错误结论，是把“JSON 可解析”“Schema 通过”或“字段 deepEqual”直接等价为“页面正确”。SG Data Pack 把结论拆成独立 assurances，并允许未评估状态存在。'),H2('当前项目的验证事实'),table(['验证项','本次结果','说明'],[
('完整测试套件','188 / 188 通过','0 failed，执行约 5.88 秒'),('三类 v1.3 Pilot','全部 0 error / 0 warning','ID-based、中文名称、Collection'),('演化影响','成功识别 entity + asset + derivation','work-beta.cover 案例'),('模板化','byte-exact 通过','重复 HTML 实例可重建'),('覆盖率','行 70.01%，分支 66.56%，函数 71.06%','整体受 6333 行 vendored Acorn 拉低')],[39,48,76]),S(4),callout('验证成熟度判断','核心 library 模块的行覆盖率多数在约 78%–100%；但覆盖率不能替代真实生产组件的 runtime/visual 场景。Pilot 主要证明契约能覆盖三种数据形态，不等于证明任意组件库都可自动迁移。',CORAL),PageBreak()]

# 10 candidate
story += H1('09  Recrawl 与 Candidate：受控的数据演化','Reviewed Evolution')
story += [H2('为什么不能让爬虫直接写入正式 Data Pack'),P('爬取观察存在身份误判、字段冲突、空值覆盖和来源不完整等风险。因此项目把观察、判断和正式修改拆成不同制品。'),code('records.json\n   ↓ cross-check\nagree / gap / conflict / unsupported / identity miss\n   ↓ explicit decisions\napply / keep / map-alias / reject\n   ↓ candidate validation\ncandidate.json + candidate-audit.json'),S(4),H2('安全机制')]
for x in ['Review Report 与 baseline/records 的精确 bytes digest 绑定；','Candidate 会重新执行 cross-check，拒绝被篡改或过期报告；','每个 review item 必须有且仅有一个 decision；','不同观察对同一字段提出不同值时拒绝，不采用 last-write-wins；','所有变更在内存中完成验证后，才原子写入输出；','Audit 记录 before、after、reviewer、confidence、diff 和 derivation impact。']: story.append(bullet(x))
story += [S(3),H2('当前功能边界'),table(['允许','暂不允许'],[
('现有实体直接字符串字段','创建、删除、重命名实体'),('新增 alias','修改或删除既有 alias'),('field-level provenance','nested value、数组、数字、布尔值'),('apply / keep / map-alias / reject','relations、stages、contents、domain、assets、derivations')],[70,93]),S(3),callout('产品权衡','Candidate 的高安全性主要来自操作范围收缩。它已经适合补充人物字段和审核别名，但还没有覆盖 Data Pack 最核心的关系与阶段演化。',CORAL),PageBreak()]

# 11 report
story += H1('10  Library Evolution Report：把工具结果变成工程交付','Product Reporting')
story += [H2('固定五段式输出'),table(['章节','回答的问题'],[
('发现的问题','当前有什么错误、警告或待审核项？'),('已修改 / 已完善','这次实际改变了什么？'),('验证范围','哪些检查确实执行并通过？'),('剩余风险','什么仍未验证或仍有暴露面？'),('下一步','谁应该执行什么，完成条件是什么？')],[51,112]),S(5),H2('设计价值')]
for x in ['终端、JSON 和 Markdown 都是同一 RunReport 的投影，结论不会各自计算。','Outcome 区分 ready、blocked、review-required 和 input-error，并绑定退出码。','Maturity 不只看 errors，还看 extraction、runtime 和 visual 是否真正评估。','下一步由 findings、assurances 和 impacts 自动推导，便于责任交接。']: story.append(bullet(x))
story += [S(5),H2('维护问题'),P('当前 collectReport 已承担输入读取、校验、digest、规则执行、review/audit 绑定、diff、风险判断和报告组装。随着证据类型继续增加，它会成为第二个 validate() 式的中心复杂度热点。'),S(3),callout('建议','将报告拆成 PackCollector、RulesCollector、ExtractionCollector、ReviewCollector、CandidateAuditCollector 和 DiffCollector；每个 collector 只返回标准 findings / assurances / risks / artifacts。'),PageBreak()]

# 12 agent
story += H1('11  Agent 评测层：验证“AI 能否正确修改”','Agent Evaluation')
story += [H2('为什么数据契约通过还不够'),P('即使 Data Pack 契约成熟，也不能证明 AI Agent 能正确理解任务、只修改允许文件、生成可应用 patch，并通过真实运行与视觉检查。因此当前分支新增了独立的 AgentTaskManifest → TaskRun → ExperimentReport 链路。'),table(['阶段','主要控制'],[
('Manifest','绑定 instructions、source tree、input bytes、file policy、grader 和 evidence'),('Agent','只允许输出 patch，不直接接管正式源目录'),('Patch apply','临时工作区、精确 apply、前后树快照、路径 allow/deny'),('Grading','digest-verified grader staging、contract/rules/command/runtime/visual checks'),('Experiment','重复试验、有效分母、Wilson 95% 区间、失败分类和成本记录')],[34,129]),S(4),H2('值得肯定的安全表达'),P('系统没有把临时目录包装成“安全沙箱”，而是明确记录缺少 OS sandbox、文件系统隔离、网络隔离、进程隔离，以及针对恶意 Agent 的 grader secrecy。'),S(4),H2('架构风险'),table(['风险','判断'],[
('职责扩张','Agent benchmark 已接近独立产品，不再只是 Data Pack 辅助命令'),('仓库噪声','当前 tracked files 中 263 个来自 research/agent-eval/results'),('安全误解','worker/subprocess 提供故障与输出隔离，但不是不可信代码沙箱'),('维护成本','patch parser、path policy、tree snapshot、grader、experiment 都由项目自行维护')],[40,123]),PageBreak()]

# 13 strengths
story += H1('12  设计优势总结','Design Strengths')
story += [table(['优势','为什么有效','业务价值'],[
('稳定身份模型','ID 与显示名解耦，alias 处理外部脏名称','持续补数时不破坏关系图'),('Reference, never duplicate','实体和边只存一次，stage 保存引用与 overlay','降低多阶段数据漂移'),('低风险迁移','__fromPack 保留原渲染路径','不重写 DOM/动画即可替换数据层'),('Fail loudly','跨记录引用错误在 mount/CI 聚合暴露','避免静默缺边和错误关系'),('显式证据边界','等价、运行、视觉和审核互不替代','报告结论可信，不夸大验证范围'),('来源与影响可追溯','provenance + derivations + diff','数据变化可解释、可回归'),('受控演化','crawl 观察必须经过 Decisions 和 Candidate','避免自动覆盖正式数据'),('确定性输出','稳定 JSON、hash、ID、原子写入','适合 CI、审计和复现实验'),('零依赖部署','Node 18+ 即可运行，loader 可直接复制','适合 Agent skill 和遗留库接入')],[36,69,58],True),S(7),H2('最具产品差异化的三点'),num(1,'不是只定义数据模型，而是定义从原始源到正式数据的无损迁移证明。'),num(2,'不是只验证字段，而是把来源、审核、影响面和后续回归统一到一条链路。'),num(3,'不是只接受 AI 自报成功，而是通过 patch、policy、grader 和 evidence 独立判断。'),PageBreak()]

# 14 debt
story += H1('13  设计缺点与技术债务','Trade-offs & Debt')
story += [table(['问题','根因','影响'],[
('契约多份实现','Schema、loader、types、docs、Candidate 分别手写','版本升级容易发生语义漂移'),('核心函数过大','validate、collectReport、runTask 承担过多分支','修改风险和理解成本持续上升'),('单一真源不彻底','正式 pack 与 embedded fallback 共存','流程检查缺失时可能漂移'),('抽取器可信代码前提','new Function + require config/engine','不能用于不可信在线输入'),('启发式资产识别','递归扫描图片扩展名字符串','字体/视频会漏检，普通字符串可能误判'),('domain 过于自由','通用契约避免膨胀','跨库工具无法深入理解业务结构'),('路径 DSL 较弱','简单 dot path + wildcard','特殊 key、复杂选择和重构支持有限'),('Candidate 能力偏窄','为了安全限制操作类型','关系和阶段问题仍需人工修改'),('Agent 层侵蚀内聚性','通用评测框架进入同一 CLI','产品定位和发布边界变模糊'),('零依赖成本内部化','路径、glob、CLI、diff、patch 全部自研','安全和跨平台维护责任更重')],[40,63,60],True),S(7),H2('一个关键矛盾'),callout('正确但越来越难修改','项目通过不断增加校验、报告和安全门槛提高了正确性；但这些能力主要集中在少数大型函数和手写契约副本中。如果继续横向增加命令，系统可能演化成“行为可靠、内部难改”的大型零依赖脚本集合。',CORAL),PageBreak()]

# 15 roadmap
story += H1('14  推荐演进路线','Roadmap')
story += [H2('P0：先控制复杂度和契约漂移'),table(['动作','目标','完成标准'],[
('拆分 SGDataLoader.validate','按 meta/entities/relations/stages/assets/provenance/derivations 模块化','每个规则可独立执行和测试'),('建立 Contract Registry','集中版本、枚举、字段策略和规则元信息','Schema/TS/docs 的公共部分由 registry 生成'),('拆分报告 collectors','取消 collectReport 中央编排堆积','新增 evidence 不修改单一巨型函数'),('隔离 Agent Eval','拆为 packages/agent-eval 或独立 CLI','Data Pack 用户可独立安装和发布 core'),('明确可信执行边界','统一文档和代码措辞','不再把 worker/process isolation 称为 sandbox')],[39,61,63],True),S(5),H2('P1：补齐数据治理能力')]
for x in ['实现真正基于 context 的 alias resolution，并支持一名多实体。','增加 entity ID rename/migration，自动更新 relations、stages、sameAs 和 provenance。','为 Candidate 增加类型化 relation/stage 操作，继续使用 precondition + allow-listed diff。','将 derivation/attributeSources 路径升级为可转义的标准格式，例如 JSON Pointer 子集。','资产 hash 统一为 SHA-256，并允许显式配置 asset source paths 与资源类型。']: story.append(bullet(x))
story += [S(4),H2('P2：改善交付与生态')]
for x in ['增加最小 package.json、bin、engines 和版本信息，同时保持运行时零依赖。','增加 macOS/Windows CI，并设置排除 vendor 后的核心覆盖率门槛。','将大规模 Agent trial 结果移入 release artifact，仓库只保留摘要、索引和 digest。','为大型 Data Pack 提供逻辑分片与编译聚合，降低单文件 merge conflict。']: story.append(bullet(x))
story.append(PageBreak())

# 16 position
story += H1('15  产品化定位建议','Product Positioning')
story += [H2('推荐定位'),callout('组件库数据治理与可信变更工具链','面向从网页案例、遗留组件和 AI 生成代码中提取出来的数据驱动组件，提供统一数据契约、低风险迁移、来源审核、影响分析和多层验证。'),S(5),H2('推荐的产品模块'),table(['模块','面向用户','核心命令/能力'],[
('Core Contract','组件库开发者','validate、compile、loader、types'),('Migration Kit','迁移工程师','extract、templatize、engine integration'),('Evolution Workflow','数据维护者/审核人','recrawl-skeleton、candidate、diff、report'),('Library Rules','组件负责人','rules、domain schema、DATA-GUIDE'),('Agent Evaluation','AI 工程团队','task、grade、evidence、experiment')],[41,46,76]),S(5),H2('推荐产品叙事'),P('不要把产品只描述成“把数据抽到 data.json”。更准确的叙事是：'),S(2),code('把组件库中不可治理的数据，\n转化为一个可以被引用、验证、审核、演化和解释的正式数据资产。'),S(5),H2('竞争壁垒')]
for x in ['能够适配遗留数据形态，而不是只服务理想的新项目；','能够证明迁移范围内的无损性；','把数据来源和渲染影响放入同一契约；','把人工审核和 AI 修改变成可复现的工程制品。']: story.append(bullet(x))
story.append(PageBreak())

# conclusion + appendix
story += H1('结论','Conclusion')
story += [callout('总体判断','SG Data Pack 的方向是正确且具有明显工程价值的。其核心 Data Pack 模型、旧引擎兼容策略、Fail Loudly 校验、Review Candidate 和证据分层已经形成相对完整的产品逻辑。'),S(6),H2('最准确的技术评价'),P('<font size="14" color="#16324F">Data Pack 核心已经扎实；下一阶段的重点不应该是继续增加更多命令，而应该是统一契约来源、拆解大型验证与编排函数，并把 Agent 评测层从核心产品边界中隔离出来。</font>'),S(5),H2('如果不重构')]
for x in ['项目会继续保持高正确性，但新增规则的成本和回归风险会快速上升；','契约、类型、文档和运行时验证之间的同步压力会增大；','Agent benchmark 会逐步遮蔽 Data Pack 的原始产品定位。']: story.append(bullet(x))
story += [S(4),H2('如果完成重构')]
for x in ['Core 可以成为稳定、可复制的组件数据契约；','Evolution 可以成为正式的数据审核与交付产品；','Agent Eval 可以独立成为通用的可审计 AI 修改基准框架。']: story.append(bullet(x))
story += [S(12),P('规范化不是终点。','Quote'),P('可验证、可审核、可解释的持续演化，才是 SG Data Pack 的真正产品价值。','Quote'),PageBreak()]

story += H1('附录  代码导航与设计评分','Appendix')
base='/Users/tangyaoyue/DEV/sg-data-pack/'
story += [table(['主题','路径'],[
('项目入口',base+'README.md'),('Agent Skill',base+'SKILL.md'),('Data Pack 契约',base+'references/data-pack-contract.md'),('引擎适配规范',base+'references/engine-integration.md'),('运行时验证器',base+'scripts/lib/sg-data-loader.js'),('抽取与等价性',base+'scripts/lib/sg-pack-extract-core.js'),('Candidate',base+'scripts/lib/sg-pack-candidate.js'),('统一报告',base+'scripts/sg-pack-report.js'),('Agent Task Runner',base+'scripts/lib/sg-task-runner.js')],[39,124],True),S(6),H2('设计评分（主观评估）'),table(['维度','评分','说明'],[
('数据模型','9 / 10','稳定身份、引用优先、阶段 overlay 设计成熟'),('遗留迁移策略','9 / 10','反腐适配层显著降低渲染回归风险'),('正确性与审计','9 / 10','Fail closed、digest binding 和 evidence 边界清晰'),('扩展性','7 / 10','domain 灵活，但跨库语义较弱'),('可维护性','6.5 / 10','大型函数与多份契约实现形成压力'),('安全隔离','6 / 10','边界表达诚实，但没有 OS 级 sandbox'),('产品内聚性','6.5 / 10','Agent Eval 扩张后边界需要重新拆分')],[40,27,96])]

doc=SimpleDocTemplate(str(OUT),pagesize=A4,rightMargin=20*mm,leftMargin=20*mm,topMargin=21*mm,bottomMargin=17*mm,title='SG Data Pack：组件库数据治理与可信变更链——技术产品解说',author='Codex',subject='项目设计、产品定位、架构优势、设计权衡与演进路线')
doc.build(story,onFirstPage=page_header_footer,onLaterPages=page_header_footer)
print(OUT)
