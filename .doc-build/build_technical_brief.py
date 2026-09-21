from docx import Document
from docx.shared import Inches, Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_LINE_SPACING
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.enum.section import WD_SECTION
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.text import WD_TAB_ALIGNMENT
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import os, textwrap

SOURCE = Path(__file__).resolve().parent
BUILD = Path(os.environ.get('SG_DOC_OUTPUT_DIR', str(SOURCE / 'output'))).expanduser().resolve()
BUILD.mkdir(parents=True, exist_ok=True)
OUT = BUILD / 'SG-Data-Pack-技术产品解说.docx'

NAVY = '16324F'
BLUE = '3A7CA5'
CYAN = 'DCEEF5'
LIGHT = 'F4F7F9'
DARK = '1E2933'
MUTED = '5F6B75'
CORAL = 'E76F51'
GREEN = '2A9D8F'
YELLOW = 'F4D35E'
WHITE = 'FFFFFF'
BORDER = 'CBD5DC'

FONT_CN = os.environ.get('SG_DOC_FONT_NAME', 'Noto Sans CJK SC')
FONT_EN = 'Helvetica Neue'
FONT_MONO = 'Courier New'

# ---------- image helpers ----------
def find_font(size=36, bold=False):
    explicit_font = os.environ.get('SG_DOC_FONT')
    if not explicit_font:
        raise RuntimeError(
            'Set SG_DOC_FONT to a licensed Chinese-capable TrueType/OpenType font; '
            'see .doc-build/README.md.'
        )
    # An invalid explicit font must fail rather than silently produce missing glyphs.
    return ImageFont.truetype(str(Path(explicit_font).expanduser()), size=size)

def rounded_box(draw, xy, fill, outline=None, radius=22, width=3):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

def arrow(draw, x1, y1, x2, y2, color='#3A7CA5', width=7):
    draw.line((x1,y1,x2,y2), fill=color, width=width)
    import math
    ang = math.atan2(y2-y1,x2-x1)
    L=22
    pts=[]
    for da in (2.6,-2.6):
        pts.append((x2+L*math.cos(ang+da), y2+L*math.sin(ang+da)))
    draw.polygon([(x2,y2),pts[0],pts[1]], fill=color)

def centered_text(draw, box, text, font, fill='#1E2933', spacing=7):
    x1,y1,x2,y2=box
    lines=[]
    for para in text.split('\n'):
        lines += textwrap.wrap(para, width=16) or ['']
    heights=[]; widths=[]
    for line in lines:
        b=draw.textbbox((0,0),line,font=font)
        widths.append(b[2]-b[0]); heights.append(b[3]-b[1])
    total=sum(heights)+spacing*(len(lines)-1)
    y=y1+(y2-y1-total)/2
    for line,w,h in zip(lines,widths,heights):
        draw.text((x1+(x2-x1-w)/2,y),line,font=font,fill=fill)
        y+=h+spacing

def make_architecture(path):
    W,H=1800,920
    im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
    title=find_font(46,True); f=find_font(30,False); small=find_font(24,False)
    d.text((70,45),'SG Data Pack：从遗留数据到可信变更链',font=title,fill='#16324F')
    boxes=[
        (70,190,340,360,'遗留组件库\nJS / HTML / JSON','#F4F7F9'),
        (410,190,680,360,'Extract\n定位 + AST 切片','#DCEEF5'),
        (750,190,1020,360,'buildPack\n实体 / 别名 / 关系','#DCEEF5'),
        (1090,170,1420,380,'Data Pack\ndata.json\n单一正式入口','#16324F'),
        (1490,190,1760,360,'Validate\nE1-E16 / W1-W8','#DCEEF5'),
    ]
    for x1,y1,x2,y2,t,c in boxes:
        rounded_box(d,(x1,y1,x2,y2),c,'#3A7CA5' if c!='#16324F' else '#16324F',20,4)
        centered_text(d,(x1,y1,x2,y2),t,f,'white' if c=='#16324F' else '#1E2933')
    for a,b in zip(boxes[:-1],boxes[1:]): arrow(d,a[2]+10,(a[1]+a[3])//2,b[0]-12,(b[1]+b[3])//2)
    # bottom branches
    lower=[
        (260,610,560,790,'兼容运行\n__fromPack → 旧 options','#F4F7F9'),
        (750,610,1050,790,'数据演化\nRecrawl → Review → Candidate','#F4F7F9'),
        (1240,610,1540,790,'工程交付\nDiff → Impact → Report','#F4F7F9'),
    ]
    for x1,y1,x2,y2,t,c in lower:
        rounded_box(d,(x1,y1,x2,y2),c,'#CBD5DC',20,3); centered_text(d,(x1,y1,x2,y2),t,f)
    arrow(d,1250,400,410,590,'#2A9D8F',6)
    arrow(d,1250,400,900,590,'#2A9D8F',6)
    arrow(d,1250,400,1390,590,'#2A9D8F',6)
    d.text((70,850),'设计重点：规范化不是终点；可验证、可审核、可解释的变更链才是产品核心。',font=small,fill='#5F6B75')
    im.save(path,quality=95)

def make_pack_anatomy(path):
    W,H=1700,980
    im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
    title=find_font(46,True); f=find_font(28); sm=find_font(22)
    d.text((65,42),'Data Pack 的分层结构',font=title,fill='#16324F')
    layers=[
        ('稳定身份层','entities · aliases · sameAs','解决“它是谁”','#16324F'),
        ('关系与上下文层','relationTypes · relations · stages · overlay','解决“它与谁有关、在何时成立”','#3A7CA5'),
        ('内容与领域层','contents · domain · attributeTypes','解决“展示什么业务内容”','#2A9D8F'),
        ('证据与影响层','assets · provenance · derivations','解决“从哪来、影响哪里”','#E76F51'),
    ]
    y=170
    for i,(name,fields,purpose,color) in enumerate(layers):
        x=105+i*45; right=1595-i*45; h=155
        rounded_box(d,(x,y,right,y+h),color,None,28,0)
        d.text((x+38,y+27),name,font=f,fill='white')
        d.text((x+360,y+27),fields,font=f,fill='white')
        d.text((x+360,y+84),purpose,font=sm,fill='#FFFFFF')
        y+=180
    d.text((85,905),'通用核心保持严格；组件库差异进入 domain，并由库级 schema / rules 补充。',font=sm,fill='#5F6B75')
    im.save(path,quality=95)

def make_assurance(path):
    W,H=1700,760
    im=Image.new('RGB',(W,H),'white'); d=ImageDraw.Draw(im)
    title=find_font(44,True); f=find_font(27); sm=find_font(22)
    d.text((65,40),'证据分层：每一层只证明它真正覆盖的范围',font=title,fill='#16324F')
    items=[
        ('结构契约','Schema + E1-E16','引用、枚举、范围、资产、来源'),
        ('数据无损','Extract Equivalence','声明 literal 的 round-trip 等价'),
        ('运行正确','Runtime Mount','真实初始化、DOM、控制台错误'),
        ('视觉正确','Visual Regression','布局、字体、动画关键帧、截图'),
        ('变更可信','Review + Digest + Audit','审核人与实际输入输出严格绑定'),
    ]
    x=80; y=180
    colors=['#16324F','#3A7CA5','#2A9D8F','#E76F51','#7B5EA7']
    width=292
    for i,(a,b,c) in enumerate(items):
        x1=x+i*320; x2=x1+width
        rounded_box(d,(x1,y,x2,y+410),colors[i],None,24,0)
        centered_text(d,(x1+18,y+30,x2-18,y+125),a,f,'white')
        centered_text(d,(x1+18,y+135,x2-18,y+230),b,sm,'white')
        d.line((x1+30,y+250,x2-30,y+250),fill='#FFFFFF',width=2)
        centered_text(d,(x1+22,y+270,x2-22,y+390),c,sm,'white')
        if i<len(items)-1: arrow(d,x2+5,y+205,x2+24,y+205,'#CBD5DC',5)
    d.text((80,655),'关键原则：不能用低层证据替代高层证据。JSON deepEqual 通过，不等于页面视觉已经验证。',font=sm,fill='#5F6B75')
    im.save(path,quality=95)

arch = BUILD/'architecture.png'
packimg = BUILD/'pack-anatomy.png'
assurance = BUILD/'assurance.png'
make_architecture(arch); make_pack_anatomy(packimg); make_assurance(assurance)

# ---------- docx helpers ----------
def set_cell_shading(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = tcPr.find(qn('w:shd'))
    if shd is None:
        shd = OxmlElement('w:shd'); tcPr.append(shd)
    shd.set(qn('w:fill'), fill)

def set_cell_border(cell, **kwargs):
    tc = cell._tc; tcPr = tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in('w:tcBorders')
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders'); tcPr.append(tcBorders)
    for edge in ('top','left','bottom','right','insideH','insideV'):
        if edge in kwargs:
            edge_data=kwargs.get(edge); tag='w:{}'.format(edge)
            element=tcBorders.find(qn(tag))
            if element is None: element=OxmlElement(tag); tcBorders.append(element)
            for key in ['val','sz','space','color']:
                if key in edge_data: element.set(qn('w:'+key),str(edge_data[key]))

def set_repeat_table_header(row):
    trPr = row._tr.get_or_add_trPr(); tblHeader = OxmlElement('w:tblHeader'); tblHeader.set(qn('w:val'),'true'); trPr.append(tblHeader)

def set_run_font(run, name=FONT_CN, size=None, bold=None, color=None):
    run.font.name=name
    run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),name)
    run._element.get_or_add_rPr().rFonts.set(qn('w:ascii'),FONT_EN if name==FONT_CN else name)
    run._element.get_or_add_rPr().rFonts.set(qn('w:hAnsi'),FONT_EN if name==FONT_CN else name)
    if size: run.font.size=Pt(size)
    if bold is not None: run.bold=bold
    if color: run.font.color.rgb=RGBColor.from_string(color)

def set_para_spacing(p, before=0, after=6, line=1.35):
    pf=p.paragraph_format; pf.space_before=Pt(before); pf.space_after=Pt(after); pf.line_spacing=line

def add_text(p, text, bold=False, color=DARK, size=10.5, font=FONT_CN, italic=False):
    r=p.add_run(text); set_run_font(r,font,size,bold,color); r.italic=italic; return r

def add_bullet(doc, text, level=0, color=DARK):
    p=doc.add_paragraph(style='List Bullet' if level==0 else 'List Bullet 2'); add_text(p,text,color=color,size=10.2); set_para_spacing(p,after=3,line=1.3); return p

def add_number(doc, text, level=0):
    p=doc.add_paragraph(style='List Number' if level==0 else 'List Number 2'); add_text(p,text,size=10.2); set_para_spacing(p,after=3,line=1.3); return p

def add_heading(doc,text,level=1,kicker=None):
    if kicker:
        p=doc.add_paragraph(); set_para_spacing(p,before=8,after=2)
        add_text(p,kicker.upper(),bold=True,color=CORAL,size=8.5,font=FONT_EN)
    p=doc.add_heading(text,level=level)
    return p

def add_callout(doc,title,body,color=BLUE,icon=None):
    t=doc.add_table(rows=1,cols=1); t.alignment=WD_TABLE_ALIGNMENT.CENTER; t.autofit=False
    cell=t.cell(0,0); cell.width=Cm(16.5); set_cell_shading(cell, 'EFF6F8' if color==BLUE else 'FFF3EF')
    set_cell_border(cell,left={'val':'single','sz':'18','color':color},top={'val':'nil'},bottom={'val':'nil'},right={'val':'nil'})
    p=cell.paragraphs[0]; set_para_spacing(p,before=4,after=3)
    add_text(p,(icon+' ' if icon else '')+title,bold=True,color=color,size=10.5)
    p2=cell.add_paragraph(); set_para_spacing(p2,after=4,line=1.3); add_text(p2,body,size=9.8,color=DARK)
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
    return t

def add_code(doc, text):
    t=doc.add_table(rows=1,cols=1); t.alignment=WD_TABLE_ALIGNMENT.CENTER
    c=t.cell(0,0); set_cell_shading(c,'F3F5F7'); set_cell_border(c,top={'val':'single','sz':'4','color':'D8DEE4'},bottom={'val':'single','sz':'4','color':'D8DEE4'},left={'val':'single','sz':'4','color':'D8DEE4'},right={'val':'single','sz':'4','color':'D8DEE4'})
    p=c.paragraphs[0]; set_para_spacing(p,before=4,after=4,line=1.15)
    for idx,line in enumerate(text.splitlines()):
        if idx: p.add_run().add_break()
        add_text(p,line,size=8.6,font=FONT_MONO,color='334155')
    return t

def add_table(doc, headers, rows, widths=None, small=False):
    tbl=doc.add_table(rows=1,cols=len(headers)); tbl.alignment=WD_TABLE_ALIGNMENT.CENTER; tbl.autofit=False
    hdr=tbl.rows[0]; set_repeat_table_header(hdr)
    for i,h in enumerate(headers):
        c=hdr.cells[i]; set_cell_shading(c,NAVY); c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
        p=c.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.LEFT; set_para_spacing(p,before=3,after=3)
        add_text(p,h,bold=True,color=WHITE,size=8.8 if small else 9.2)
        if widths: c.width=Cm(widths[i])
    for ridx,row in enumerate(rows):
        cells=tbl.add_row().cells
        for i,v in enumerate(row):
            c=cells[i]; c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.TOP
            set_cell_shading(c,'F7F9FA' if ridx%2==0 else 'FFFFFF')
            set_cell_border(c,bottom={'val':'single','sz':'3','color':'D8DEE4'})
            p=c.paragraphs[0]; set_para_spacing(p,before=2,after=2,line=1.2)
            add_text(p,str(v),size=8.2 if small else 8.8,color=DARK)
            if widths: c.width=Cm(widths[i])
    doc.add_paragraph().paragraph_format.space_after=Pt(0)
    return tbl

def page_break(doc): doc.add_page_break()

def add_page_number(paragraph):
    paragraph.alignment=WD_ALIGN_PARAGRAPH.RIGHT
    run=paragraph.add_run(); set_run_font(run,FONT_EN,8.5,False,MUTED)
    fldChar1=OxmlElement('w:fldChar'); fldChar1.set(qn('w:fldCharType'),'begin')
    instrText=OxmlElement('w:instrText'); instrText.set(qn('xml:space'),'preserve'); instrText.text=' PAGE '
    fldChar2=OxmlElement('w:fldChar'); fldChar2.set(qn('w:fldCharType'),'end')
    run._r.append(fldChar1); run._r.append(instrText); run._r.append(fldChar2)

# ---------- document ----------
doc=Document()
sec=doc.sections[0]
sec.page_height=Cm(29.7); sec.page_width=Cm(21.0)
sec.top_margin=Cm(1.75); sec.bottom_margin=Cm(1.65); sec.left_margin=Cm(2.0); sec.right_margin=Cm(2.0)

styles=doc.styles
normal=styles['Normal']; normal.font.name=FONT_CN; normal._element.rPr.rFonts.set(qn('w:eastAsia'),FONT_CN); normal.font.size=Pt(10.5); normal.font.color.rgb=RGBColor.from_string(DARK)
normal.paragraph_format.line_spacing=1.35; normal.paragraph_format.space_after=Pt(6)
for name,size,color,space_before,space_after in [('Heading 1',21,NAVY,16,8),('Heading 2',15,BLUE,12,6),('Heading 3',11.5,DARK,9,4)]:
    st=styles[name]; st.font.name=FONT_CN; st._element.rPr.rFonts.set(qn('w:eastAsia'),FONT_CN); st.font.size=Pt(size); st.font.bold=True; st.font.color.rgb=RGBColor.from_string(color)
    st.paragraph_format.space_before=Pt(space_before); st.paragraph_format.space_after=Pt(space_after); st.paragraph_format.keep_with_next=True

# header/footer
header=sec.header
hp=header.paragraphs[0]; hp.alignment=WD_ALIGN_PARAGRAPH.LEFT
add_text(hp,'SG DATA PACK',bold=True,color=NAVY,size=8.5,font=FONT_EN); add_text(hp,'  /  技术产品解说',color=MUTED,size=8.5)
hp.paragraph_format.space_after=Pt(2)
# bottom border header
pPr=hp._p.get_or_add_pPr(); pbdr=OxmlElement('w:pBdr'); bot=OxmlElement('w:bottom'); bot.set(qn('w:val'),'single'); bot.set(qn('w:sz'),'6'); bot.set(qn('w:space'),'4'); bot.set(qn('w:color'),BORDER); pbdr.append(bot); pPr.append(pbdr)
fp=sec.footer.paragraphs[0]; add_text(fp,'内部技术说明 · 2026-08-06',color=MUTED,size=8.2); add_text(fp,' '*8,color=MUTED,size=8.2); add_page_number(fp)

# cover
p=doc.add_paragraph(); p.paragraph_format.space_before=Pt(38); p.paragraph_format.space_after=Pt(10)
add_text(p,'SG DATA PACK',bold=True,color=CORAL,size=11,font=FONT_EN)
p=doc.add_paragraph(); set_para_spacing(p,after=4,line=1.0)
add_text(p,'组件库数据治理与',bold=True,color=NAVY,size=31)
p=doc.add_paragraph(); set_para_spacing(p,after=18,line=1.0)
add_text(p,'可信变更链',bold=True,color=NAVY,size=31)
p=doc.add_paragraph(); set_para_spacing(p,after=26,line=1.5)
add_text(p,'技术产品解说',bold=True,color=BLUE,size=18)
add_text(p,'  |  ',color=BORDER,size=18)
add_text(p,'从散乱业务数据，到可验证、可审核、可解释的组件数据基础设施',color=MUTED,size=12)

cover_tbl=doc.add_table(rows=1,cols=3); cover_tbl.alignment=WD_TABLE_ALIGNMENT.CENTER; cover_tbl.autofit=False
cards=[('01','规范化','稳定实体 ID、别名、主关系和阶段引用'),('02','可验证','契约校验、无损等价、运行时与视觉证据'),('03','可演化','Recrawl、人工决策、Candidate 与影响分析')]
for i,(n,t,b) in enumerate(cards):
    c=cover_tbl.cell(0,i); c.width=Cm(5.3); set_cell_shading(c,[NAVY,BLUE,GREEN][i]); c.vertical_alignment=WD_CELL_VERTICAL_ALIGNMENT.CENTER
    p=c.paragraphs[0]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER; set_para_spacing(p,before=10,after=4); add_text(p,n,bold=True,color=YELLOW,size=11,font=FONT_EN)
    p=c.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; set_para_spacing(p,after=6); add_text(p,t,bold=True,color=WHITE,size=14)
    p=c.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; set_para_spacing(p,after=10,line=1.25); add_text(p,b,color=WHITE,size=8.8)

p=doc.add_paragraph(); p.paragraph_format.space_before=Pt(28); p.paragraph_format.space_after=Pt(8)
add_text(p,'适用对象',bold=True,color=NAVY,size=10)
add_text(p,'  产品负责人 · 组件库维护者 · 数据工程师 · 技术架构师 · AI 工程负责人',color=MUTED,size=10)
p=doc.add_paragraph(); set_para_spacing(p,after=0)
add_text(p,'分析基线',bold=True,color=NAVY,size=10)
add_text(p,'  当前分支 codex/agent-task-experiments，提交 d76bb32',color=MUTED,size=10)
page_break(doc)

# executive summary
add_heading(doc,'执行摘要',1,'Executive Overview')
add_callout(doc,'一句话定位','SG Data Pack 是一套面向遗留组件库的数据层标准化与变更治理工具链。它把散落在 JavaScript 默认值、HTML 模板、外部 JSON 和阶段副本中的业务数据，转化为统一 Data Pack，并用校验、等价性、审核、影响分析和证据报告保证变更可信。',BLUE)

add_heading(doc,'它解决的不是“JSON 放在哪里”，而是四个工程问题',2)
add_table(doc,['问题','传统表现','SG Data Pack 的回答'],[
    ('身份不稳定','名称、中文别名、数组下标混用','稳定 slug ID + aliases + sameAs'),
    ('关系易漂移','多阶段重复人物和边，局部修改不同步','主关系只存一次，stage 只引用并保存 overlay'),
    ('抓取会静默污染','爬取结果直接覆盖，错误关系不报错','E1-E16 fail loudly + Review Decisions'),
    ('验证结论被夸大','JSON 正确被等同于页面正确','结构、等价、运行、视觉、审核五层证据'),
],widths=[3.2,5.6,7.4])

add_heading(doc,'产品本质',2)
p=doc.add_paragraph(); add_text(p,'它不是单一抽取脚本，而是由三层产品能力组成：',size=10.5)
add_number(doc,'Data Pack 契约与迁移：定义统一数据模型，并保持旧渲染引擎兼容。')
add_number(doc,'数据演化与工程交付：把 recrawl 观察转化为可审核 Candidate 和统一报告。')
add_number(doc,'Agent 任务评测：验证 AI 是否能够在受约束条件下完成真实修改，而不是只验证数据文件。')
add_callout(doc,'核心判断','项目最有价值的能力是“可信变更链”，而不是“抽取数据”。规范化只是起点；真正的产品壁垒是来源、审核、影响和验证能够被同一套机制串联。',CORAL)
page_break(doc)

# product context
add_heading(doc,'01  产品背景与使用场景',1,'Product Context')
add_heading(doc,'遗留组件库的数据为什么特别难治理',2)
p=doc.add_paragraph(); add_text(p,'从完整 HTML 案例页拆解出的组件库，通常继承了页面级代码的所有偶然性。业务数据不是一个明确的数据层，而是分散在：')
for x in ['引擎 IIFE 或 UMD 中的 options fallback；','模板字符串中的长文、时间线和高亮引用；','示例 HTML 的 <script type="application/json">；','以中文名称或数组序号表达的关系；','每个历史阶段各自复制的一套人物、布局和边；','图片路径、颜色枚举和展示规则等隐式常量。']:
    add_bullet(doc,x)

add_heading(doc,'典型风险',2)
add_table(doc,['风险','发生方式','最终后果'],[
    ('重复实体','同一人物在不同阶段保存完整副本','一个阶段已更新，其他阶段继续展示旧数据'),
    ('悬空关系','爬虫名称变化、别名未解析','关系图缺边，但渲染器可能静默忽略'),
    ('默认值漂移','engine fallback 和外部数据分别修改','测试环境和生产注入产生不同结果'),
    ('来源丢失','只保留最终字段值','无法解释是谁、何时、依据什么修改'),
    ('影响未知','数据被引擎排序、复制、投影','小字段变化导致多个展示区域变化'),
],widths=[3,6.2,7])

add_heading(doc,'适合与不适合',2)
add_table(doc,['适合','不适合'],[
    ('关系图、时间线、人物卡片、作品集合等数据驱动组件','完全由现代 API 和强类型模型驱动的新项目'),
    ('需要持续补数、recrawl、人工复核的组件库','需要直接执行不可信第三方代码的在线服务'),
    ('不能大幅重写渲染器，但需要治理数据的遗留系统','超大规模、需要分片和流式加载的数据集'),
    ('希望让 AI 修改组件，但要求可审计证据','只追求一次性快速迁移、不维护长期契约的项目'),
],widths=[8.1,8.1])
page_break(doc)

# architecture
add_heading(doc,'02  产品架构：可信数据变更链',1,'Architecture')
doc.add_picture(str(arch),width=Cm(17.0))
p=doc.paragraphs[-1]; p.alignment=WD_ALIGN_PARAGRAPH.CENTER; set_para_spacing(p,after=6)

add_heading(doc,'三条主链路',2)
add_table(doc,['链路','输入','输出','主要保证'],[
    ('迁移链','引擎字面量、HTML、JSON script','规范化 Data Pack','声明范围内无损、旧引擎兼容'),
    ('演化链','Baseline + crawl records + 人工 Decisions','Candidate + Audit','不自动猜测身份，不允许静默覆盖'),
    ('交付链','Validation + Rules + Diff + Evidence','RunReport','人和 CI 共享同一结论模型'),
],widths=[2.5,4.7,4.5,4.5])

add_heading(doc,'架构思想',2)
add_bullet(doc,'反腐层：Data Pack 不直接侵入旧 renderer，而由 __fromPack 还原旧 options。')
add_bullet(doc,'Fail closed：输入不完整、来源漂移、审核缺失或引用不唯一时拒绝继续。')
add_bullet(doc,'内容寻址：关键输入输出使用 SHA-256 绑定，确保“审核的就是最终应用的”。')
add_bullet(doc,'证据分层：数据契约、无损等价、运行时和视觉验证互不替代。')
add_bullet(doc,'严格核心、开放领域：统一身份与引用规则，业务差异进入 domain。')
page_break(doc)

# Pack model
add_heading(doc,'03  Data Pack：统一数据契约',1,'Data Model')
doc.add_picture(str(packimg),width=Cm(16.9)); doc.paragraphs[-1].alignment=WD_ALIGN_PARAGRAPH.CENTER

add_heading(doc,'核心字段与职责',2)
add_table(doc,['区域','作用','设计价值'],[
    ('entities','以稳定 ID 保存唯一实体','显示名可变，关系和来源保持稳定'),
    ('aliases','外部名称到 canonical ID 的入口','隔离抓取名称和内部主键'),
    ('relationTypes / relations','关系枚举与 master edge','边只保存一次，可验证、可复用'),
    ('stages / overlay','阶段成员、布局、关系引用和上下文覆盖','共享事实不复制，阶段差异不污染实体'),
    ('contents / domain','长文内容与库级业务扩展','通用契约不膨胀'),
    ('assets','资源存在性、大小与 hash','资源成为可验证数据的一部分'),
    ('provenance','记录级和字段级来源','支持审核、置信度和追责'),
    ('derivations','数据到展示的非平凡推导','把隐藏在引擎中的影响面显式化'),
],widths=[3.7,6.1,6.1],small=True)
page_break(doc)

# identity and relation detailed
add_heading(doc,'04  关键设计一：稳定身份与引用关系',1,'Identity & Relations')
add_heading(doc,'为什么不能直接用名称做引用',2)
add_code(doc,'entities.chengbing = { kind: "person", name: "程兵" }\naliases["程 兵"] = "chengbing"\nrelations[0] = { a: "chengbing", b: "wangdayong", type: "rival" }')
p=doc.add_paragraph(); add_text(p,'名称属于展示和外部输入，ID 才属于关系。这样名称、空格、繁简体或展示字段变化，不会迫使全图重写。')

add_heading(doc,'主关系 + 阶段引用',2)
add_code(doc,'relations: [\n  { id: "a-b-advisor", a: "a", b: "b", type: "advisor", scope: ["stage-1"] }\n]\n\nstages: [\n  { key: "stage-1", entities: ["a", "b"],\n    relations: [{ a: "a", b: "b", id: "a-b-advisor" }],\n    overlay: { a: { role: "阶段身份" } } }\n]')

add_heading(doc,'设计优势',2)
for x in ['同一实体跨阶段共享，避免副本漂移；','关系枚举、端点、scope 和 stage ref 可以统一校验；','阶段上下文进入 overlay，不会污染实体的长期事实；','Diff 可以精确识别实体、关系、阶段顺序和字段变化。']:
    add_bullet(doc,x)

add_heading(doc,'当前限制',2)
add_table(doc,['限制','影响'],[
    ('contextual alias 只保存 context，解析时仍直接取 id','不能真正解决同名实体的多语境映射'),
    ('关系默认按 a → b 有方向组织','无向关系需要组件库自行约定 canonical ordering'),
    ('relation identity 可能来自复合字符串','修改 type/scope 时 provenance key 也可能变化'),
    ('缺少正式 ID rename/migration','早期主键选择错误会形成长期迁移成本'),
],widths=[7,9.2])
page_break(doc)

# migration
add_heading(doc,'05  关键设计二：低风险迁移与旧引擎兼容',1,'Migration Strategy')
add_heading(doc,'为什么保留 __fromPack',2)
p=doc.add_paragraph(); add_text(p,'项目没有要求旧渲染器立即理解新模型，而是把 Data Pack 还原为原 options 结构，再走原来的渲染路径。这是典型的 Branch by Abstraction：先替换数据来源，再逐步演进渲染器。')

add_table(doc,['方案','迁移风险','验证难度','项目选择'],[
    ('直接重写 renderer 读取 Data Pack','高：数据和渲染同时变化','高：失败来源难定位','否'),
    ('只生成新 JSON，renderer 自行适配','中高：每个库适配方式不同','中高','否'),
    ('Data Pack → __fromPack → 旧 options','低：保留原代码路径','可用 deep equivalence 证明映射','是'),
],widths=[5.4,4.2,4.4,2.2])

add_heading(doc,'抽取机制',2)
add_number(doc,'配置正则定位字面量表达式起点。')
add_number(doc,'Acorn parseExpressionAt 确定嵌套表达式边界。')
add_number(doc,'buildPack 将源结构转换为 entities、aliases、relations 和 domain。')
add_number(doc,'__fromPack 重新构造旧数据结构，并与源 defaults deep-equal。')
add_number(doc,'通过后生成 data.json、data.js 和 data.schema.json。')

add_callout(doc,'重要边界','等价性只证明 extraction config 明确声明的 literal 映射，不证明真实 DOM mount、动画和视觉效果。项目对此边界表达清晰，这是设计优势。',BLUE)

add_heading(doc,'代价与风险',2)
add_bullet(doc,'正式 Data Pack 和 engine fallback 仍然物理共存；单一真源依赖流程纪律，而非完全消除副本。')
add_bullet(doc,'正则定位和 ctx 注入对复杂、压缩或运行时计算的数据较脆弱。')
add_bullet(doc,'new Function、require config 和 require engine 都是可信代码执行，不是安全沙箱。')
add_bullet(doc,'如果 CI 不持续执行 compile --check / compare-existing，fallback 可能逐步漂移。')
page_break(doc)

# validation
add_heading(doc,'06  关键设计三：Fail Loudly 的运行时契约',1,'Validation')
add_heading(doc,'两层验证',2)
add_table(doc,['层级','负责内容','典型示例'],[
    ('JSON Schema','字段形状、必填项、基础类型','schemaVersion、meta、relation item 结构'),
    ('SGDataLoader','跨记录语义与引用完整性','悬空边、stage 消歧、provenance 指向、derivation path'),
],widths=[3.2,6.3,7.1])

add_heading(doc,'E1-E16 覆盖的主要风险',2)
add_table(doc,['类别','关键检查'],[
    ('版本与元信息','schemaVersion、meta.id、meta.title、置信度阈值'),
    ('实体与别名','稳定 slug、显示字段、alias target、ID 冲突'),
    ('关系与阶段','端点、类型注册、scope、唯一 stage edge resolution、布局范围'),
    ('内容与资产','高亮引用、资源登记、资源 hash'),
    ('来源与身份','sameAs、record/field provenance、sourceUrl、confidence'),
    ('影响声明','derivation kind、source、alsoTouches、consumers 和 affects'),
],widths=[4.2,12.4])

add_heading(doc,'优势与代价',2)
add_table(doc,['优势','代价'],[
    ('错误在 mount 或 CI 中被聚合抛出，不会变成静默缺图','生产运行时遇到错误可能导致整个组件不可用'),
    ('语义验证远强于纯 JSON Schema','运行时 loader 需要维护大量手工规则'),
    ('Warnings 保留不确定性，不强行把所有问题变成阻断','strict/non-strict 的使用需要团队统一'),
    ('支持浏览器和 Node 的零依赖 UMD','validate 函数已成为 500+ 行的复杂度热点'),
],widths=[8.2,8.4])
page_break(doc)

# provenance and derivations
add_heading(doc,'07  来源、影响与证据设计',1,'Provenance & Impact')
add_heading(doc,'为什么 provenance 独立于实体',2)
p=doc.add_paragraph(); add_text(p,'来源信息放在平行 provenance 区域，而不是直接嵌入业务实体。这样旧引擎不需要识别审计字段，业务模型和治理模型保持解耦。')
add_code(doc,'provenance.entities.alice = {\n  origin: "crawl:reviewed",\n  sourceUrl: "https://example.test/source",\n  confidence: 0.95,\n  fieldOrigins: { occupation: { origin: "crawl:reviewed", confidence: 0.95 } }\n}')

add_heading(doc,'derivations：把隐式影响面显式化',2)
add_code(doc,'derivations.carouselTrack = {\n  kind: "repeat",\n  source: "domain.carouselTrack.entityIds",\n  alsoTouches: ["entities.*"],\n  consumers: ["components/carousel-item.js"],\n  affects: [".carousel-track"],\n  note: "数据会为无限循环重复渲染两份"\n}')

add_table(doc,['设计','价值','局限'],[
    ('平行 provenance','不污染旧引擎；支持记录级和字段级来源','编辑值时需要同步维护来源'),
    ('confidence + threshold','把不确定性显式进入 review 列表','置信度仍依赖来源和人工判断'),
    ('derivation source','Diff 可以定位受影响的消费者','声明不是可执行依赖，可能陈旧'),
    ('affects / consumers','把技术影响翻译成回归范围','通用 validator 不检查文件和 selector 是否真实存在'),
],widths=[4,6.5,6.1])
page_break(doc)

# evidence
add_heading(doc,'08  验证策略：不夸大任何一层证据',1,'Assurance Model')
doc.add_picture(str(assurance),width=Cm(16.9)); doc.paragraphs[-1].alignment=WD_ALIGN_PARAGRAPH.CENTER

add_heading(doc,'为什么这种分层很重要',2)
p=doc.add_paragraph(); add_text(p,'数据驱动组件最常见的错误结论，是把“JSON 可解析”“Schema 通过”或“字段 deepEqual”直接等价为“页面正确”。SG Data Pack 把结论拆成独立 assurances，并允许未评估状态存在。')

add_heading(doc,'当前项目的验证事实',2)
add_table(doc,['验证项','本次结果','说明'],[
    ('完整测试套件','188 / 188 通过','0 failed，执行约 5.88 秒'),
    ('三类 v1.3 Pilot','全部 0 error / 0 warning','ID-based、中文名称、Collection'),
    ('演化影响','成功识别 entity + asset + derivation','work-beta.cover 案例'),
    ('模板化','byte-exact 通过','重复 HTML 实例可重建'),
    ('覆盖率','行 70.01%，分支 66.56%，函数 71.06%','整体受 6333 行 vendored Acorn 拉低'),
],widths=[4.1,4.8,7.7])

add_callout(doc,'验证成熟度判断','核心 library 模块的行覆盖率多数在约 78%–100%；但覆盖率不能替代真实生产组件的 runtime/visual 场景。Pilot 主要证明契约能覆盖三种数据形态，不等于证明任意组件库都可自动迁移。',CORAL)
page_break(doc)

# recrawl candidate
add_heading(doc,'09  Recrawl 与 Candidate：受控的数据演化',1,'Reviewed Evolution')
add_heading(doc,'为什么不能让爬虫直接写入正式 Data Pack',2)
p=doc.add_paragraph(); add_text(p,'爬取观察存在身份误判、字段冲突、空值覆盖和来源不完整等风险。因此项目把观察、判断和正式修改拆成不同制品。')
add_code(doc,'records.json\n   ↓ cross-check\nagree / gap / conflict / unsupported / identity miss\n   ↓ explicit decisions\napply / keep / map-alias / reject\n   ↓ candidate validation\ncandidate.json + candidate-audit.json')

add_heading(doc,'安全机制',2)
for x in ['Review Report 与 baseline/records 的精确 bytes digest 绑定；','Candidate 会重新执行 cross-check，拒绝被篡改或过期报告；','每个 review item 必须有且仅有一个 decision；','不同观察对同一字段提出不同值时拒绝，不采用 last-write-wins；','所有变更在内存中完成验证后，才原子写入输出；','Audit 记录 before、after、reviewer、confidence、diff 和 derivation impact。']:
    add_bullet(doc,x)

add_heading(doc,'当前功能边界',2)
add_table(doc,['允许','暂不允许'],[
    ('现有实体直接字符串字段','创建、删除、重命名实体'),
    ('新增 alias','修改或删除既有 alias'),
    ('field-level provenance','nested value、数组、数字、布尔值'),
    ('apply / keep / map-alias / reject','relations、stages、contents、domain、assets、derivations'),
],widths=[7.2,9.4])
add_callout(doc,'产品权衡','Candidate 的高安全性主要来自操作范围收缩。它已经适合补充人物字段和审核别名，但还没有覆盖 Data Pack 最核心的关系与阶段演化。',CORAL)
page_break(doc)

# report
add_heading(doc,'10  Library Evolution Report：把工具结果变成工程交付',1,'Product Reporting')
add_heading(doc,'固定五段式输出',2)
add_table(doc,['章节','回答的问题'],[
    ('发现的问题','当前有什么错误、警告或待审核项？'),
    ('已修改 / 已完善','这次实际改变了什么？'),
    ('验证范围','哪些检查确实执行并通过？'),
    ('剩余风险','什么仍未验证或仍有暴露面？'),
    ('下一步','谁应该执行什么，完成条件是什么？'),
],widths=[5.2,11.4])

add_heading(doc,'设计价值',2)
add_bullet(doc,'终端、JSON 和 Markdown 都是同一 RunReport 的投影，结论不会各自计算。')
add_bullet(doc,'Outcome 区分 ready、blocked、review-required 和 input-error，并绑定退出码。')
add_bullet(doc,'Maturity 不只看 errors，还看 extraction、runtime 和 visual 是否真正评估。')
add_bullet(doc,'下一步由 findings、assurances 和 impacts 自动推导，便于责任交接。')

add_heading(doc,'维护问题',2)
p=doc.add_paragraph(); add_text(p,'当前 collectReport 已承担输入读取、校验、digest、规则执行、review/audit 绑定、diff、风险判断和报告组装。随着证据类型继续增加，它会成为第二个 validate() 式的中心复杂度热点。')
add_callout(doc,'建议','将报告拆成 PackCollector、RulesCollector、ExtractionCollector、ReviewCollector、CandidateAuditCollector 和 DiffCollector；每个 collector 只返回标准 findings / assurances / risks / artifacts。',BLUE)
page_break(doc)

# agent layer
add_heading(doc,'11  Agent 评测层：验证“AI 能否正确修改”',1,'Agent Evaluation')
add_heading(doc,'为什么数据契约通过还不够',2)
p=doc.add_paragraph(); add_text(p,'即使 Data Pack 契约成熟，也不能证明 AI Agent 能正确理解任务、只修改允许文件、生成可应用 patch，并通过真实运行与视觉检查。因此当前分支新增了独立的 AgentTaskManifest → TaskRun → ExperimentReport 链路。')

add_table(doc,['阶段','主要控制'],[
    ('Manifest','绑定 instructions、source tree、input bytes、file policy、grader 和 evidence'),
    ('Agent','只允许输出 patch，不直接接管正式源目录'),
    ('Patch apply','临时工作区、精确 apply、前后树快照、路径 allow/deny'),
    ('Grading','digest-verified grader staging、contract/rules/command/runtime/visual checks'),
    ('Experiment','重复试验、有效分母、Wilson 95% 区间、失败分类和成本记录'),
],widths=[3.4,13.2])

add_heading(doc,'值得肯定的安全表达',2)
p=doc.add_paragraph(); add_text(p,'系统没有把临时目录包装成“安全沙箱”，而是明确记录缺少以下能力：')
for x in ['OS sandbox；','文件系统隔离；','网络隔离；','进程隔离；','针对恶意 Agent 的 grader secrecy。']:
    add_bullet(doc,x)

add_heading(doc,'架构风险',2)
add_table(doc,['风险','判断'],[
    ('职责扩张','Agent benchmark 已接近独立产品，不再只是 Data Pack 辅助命令'),
    ('仓库噪声','当前 tracked files 中 263 个来自 research/agent-eval/results'),
    ('安全误解','worker/subprocess 提供故障与输出隔离，但不是不可信代码沙箱'),
    ('维护成本','patch parser、path policy、tree snapshot、grader、experiment 都由项目自行维护'),
],widths=[4.2,12.4])
page_break(doc)

# strengths
add_heading(doc,'12  设计优势总结',1,'Design Strengths')
add_table(doc,['优势','为什么有效','业务价值'],[
    ('稳定身份模型','ID 与显示名解耦，alias 处理外部脏名称','持续补数时不破坏关系图'),
    ('Reference, never duplicate','实体和边只存一次，stage 保存引用与 overlay','降低多阶段数据漂移'),
    ('低风险迁移','__fromPack 保留原渲染路径','不重写 DOM/动画即可替换数据层'),
    ('Fail loudly','跨记录引用错误在 mount/CI 聚合暴露','避免静默缺边和错误关系'),
    ('显式证据边界','等价、运行、视觉和审核互不替代','报告结论可信，不夸大验证范围'),
    ('来源与影响可追溯','provenance + derivations + diff','数据变化可解释、可回归'),
    ('受控演化','crawl 观察必须经过 Decisions 和 Candidate','避免自动覆盖正式数据'),
    ('确定性输出','稳定 JSON、hash、ID、原子写入','适合 CI、审计和复现实验'),
    ('零依赖部署','Node 18+ 即可运行，loader 可直接复制','适合 Agent skill 和遗留库接入'),
],widths=[3.7,7,5.9],small=True)

add_heading(doc,'最具产品差异化的三点',2)
add_number(doc,'不是只定义数据模型，而是定义从原始源到正式数据的无损迁移证明。')
add_number(doc,'不是只验证字段，而是把来源、审核、影响面和后续回归统一到一条链路。')
add_number(doc,'不是只接受 AI 自报成功，而是通过 patch、policy、grader 和 evidence 独立判断。')
page_break(doc)

# weaknesses
add_heading(doc,'13  设计缺点与技术债务',1,'Trade-offs & Debt')
add_table(doc,['问题','根因','影响'],[
    ('契约多份实现','Schema、loader、types、docs、Candidate 分别手写','版本升级容易发生语义漂移'),
    ('核心函数过大','validate、collectReport、runTask 承担过多分支','修改风险和理解成本持续上升'),
    ('单一真源不彻底','正式 pack 与 embedded fallback 共存','流程检查缺失时可能漂移'),
    ('抽取器可信代码前提','new Function + require config/engine','不能用于不可信在线输入'),
    ('启发式资产识别','递归扫描图片扩展名字符串','字体/视频会漏检，普通字符串可能误判'),
    ('domain 过于自由','通用契约避免膨胀','跨库工具无法深入理解业务结构'),
    ('路径 DSL 较弱','简单 dot path + wildcard','特殊 key、复杂选择和重构支持有限'),
    ('Candidate 能力偏窄','为了安全限制操作类型','关系和阶段问题仍需人工修改'),
    ('Agent 层侵蚀内聚性','通用评测框架进入同一 CLI','产品定位和发布边界变模糊'),
    ('零依赖成本内部化','路径、glob、CLI、diff、patch 全部自研','安全和跨平台维护责任更重'),
],widths=[4.1,6.4,6.1],small=True)

add_heading(doc,'一个关键矛盾',2)
add_callout(doc,'正确但越来越难修改','项目通过不断增加校验、报告和安全门槛提高了正确性；但这些能力主要集中在少数大型函数和手写契约副本中。如果继续横向增加命令，系统可能演化成“行为可靠、内部难改”的大型零依赖脚本集合。',CORAL)
page_break(doc)

# roadmap
add_heading(doc,'14  推荐演进路线',1,'Roadmap')
add_heading(doc,'P0：先控制复杂度和契约漂移',2)
add_table(doc,['动作','目标','完成标准'],[
    ('拆分 SGDataLoader.validate','按 meta/entities/relations/stages/assets/provenance/derivations 模块化','每个规则可独立执行和测试'),
    ('建立 Contract Registry','集中版本、枚举、字段策略和规则元信息','Schema/TS/docs 的公共部分由 registry 生成'),
    ('拆分报告 collectors','取消 collectReport 中央编排堆积','新增 evidence 不修改单一巨型函数'),
    ('隔离 Agent Eval','拆为 packages/agent-eval 或独立 CLI','Data Pack 用户可独立安装和发布 core'),
    ('明确可信执行边界','统一文档和代码措辞','不再把 worker/process isolation 称为 sandbox'),
],widths=[4.1,6.2,6.3],small=True)

add_heading(doc,'P1：补齐数据治理能力',2)
add_bullet(doc,'实现真正基于 context 的 alias resolution，并支持一名多实体。')
add_bullet(doc,'增加 entity ID rename/migration，自动更新 relations、stages、sameAs 和 provenance。')
add_bullet(doc,'为 Candidate 增加类型化 relation/stage 操作，继续使用 precondition + allow-listed diff。')
add_bullet(doc,'将 derivation/attributeSources 路径升级为可转义的标准格式，例如 JSON Pointer 子集。')
add_bullet(doc,'资产 hash 统一为 SHA-256，并允许显式配置 asset source paths 与资源类型。')

add_heading(doc,'P2：改善交付与生态',2)
add_bullet(doc,'增加最小 package.json、bin、engines 和版本信息，同时保持运行时零依赖。')
add_bullet(doc,'增加 macOS/Windows CI，并设置排除 vendor 后的核心覆盖率门槛。')
add_bullet(doc,'将大规模 Agent trial 结果移入 release artifact，仓库只保留摘要、索引和 digest。')
add_bullet(doc,'为大型 Data Pack 提供逻辑分片与编译聚合，降低单文件 merge conflict。')
page_break(doc)

# product positioning
add_heading(doc,'15  产品化定位建议',1,'Product Positioning')
add_heading(doc,'推荐定位',2)
add_callout(doc,'组件库数据治理与可信变更工具链','面向从网页案例、遗留组件和 AI 生成代码中提取出来的数据驱动组件，提供统一数据契约、低风险迁移、来源审核、影响分析和多层验证。',BLUE)

add_heading(doc,'推荐的产品模块',2)
add_table(doc,['模块','面向用户','核心命令/能力'],[
    ('Core Contract','组件库开发者','validate、compile、loader、types'),
    ('Migration Kit','迁移工程师','extract、templatize、engine integration'),
    ('Evolution Workflow','数据维护者/审核人','recrawl-skeleton、candidate、diff、report'),
    ('Library Rules','组件负责人','rules、domain schema、DATA-GUIDE'),
    ('Agent Evaluation','AI 工程团队','task、grade、evidence、experiment'),
],widths=[4.1,4.7,7.8])

add_heading(doc,'推荐产品叙事',2)
p=doc.add_paragraph(); add_text(p,'不要把产品只描述成“把数据抽到 data.json”。更准确的叙事是：')
add_code(doc,'把组件库中不可治理的数据，\n转化为一个可以被引用、验证、审核、演化和解释的正式数据资产。')

add_heading(doc,'竞争壁垒',2)
add_bullet(doc,'能够适配遗留数据形态，而不是只服务理想的新项目；')
add_bullet(doc,'能够证明迁移范围内的无损性；')
add_bullet(doc,'把数据来源和渲染影响放入同一契约；')
add_bullet(doc,'把人工审核和 AI 修改变成可复现的工程制品。')
page_break(doc)

# final conclusion
add_heading(doc,'结论',1,'Conclusion')
add_callout(doc,'总体判断','SG Data Pack 的方向是正确且具有明显工程价值的。其核心 Data Pack 模型、旧引擎兼容策略、Fail Loudly 校验、Review Candidate 和证据分层已经形成相对完整的产品逻辑。',BLUE)

add_heading(doc,'最准确的技术评价',2)
p=doc.add_paragraph(); set_para_spacing(p,before=8,after=12,line=1.5)
add_text(p,'Data Pack 核心已经扎实；下一阶段的重点不应该是继续增加更多命令，而应该是统一契约来源、拆解大型验证与编排函数，并把 Agent 评测层从核心产品边界中隔离出来。',bold=True,color=NAVY,size=14)

add_heading(doc,'如果不重构',2)
add_bullet(doc,'项目会继续保持高正确性，但新增规则的成本和回归风险会快速上升；')
add_bullet(doc,'契约、类型、文档和运行时验证之间的同步压力会增大；')
add_bullet(doc,'Agent benchmark 会逐步遮蔽 Data Pack 的原始产品定位。')

add_heading(doc,'如果完成重构',2)
add_bullet(doc,'Core 可以成为稳定、可复制的组件数据契约；')
add_bullet(doc,'Evolution 可以成为正式的数据审核与交付产品；')
add_bullet(doc,'Agent Eval 可以独立成为通用的可审计 AI 修改基准框架。')

p=doc.add_paragraph(); p.paragraph_format.space_before=Pt(30); p.alignment=WD_ALIGN_PARAGRAPH.CENTER
add_text(p,'规范化不是终点。',bold=True,color=CORAL,size=17)
p=doc.add_paragraph(); p.alignment=WD_ALIGN_PARAGRAPH.CENTER; set_para_spacing(p,after=0)
add_text(p,'可验证、可审核、可解释的持续演化，才是 SG Data Pack 的真正产品价值。',bold=True,color=NAVY,size=14)
page_break(doc)

# appendix
add_heading(doc,'附录 A  代码与文档导航',1,'Appendix')
base=''  # Repository-relative paths remain meaningful after moving the checkout.
add_table(doc,['主题','路径'],[
    ('项目入口',base+'README.md'),
    ('Agent Skill',base+'SKILL.md'),
    ('Data Pack 契约',base+'references/data-pack-contract.md'),
    ('引擎适配规范',base+'references/engine-integration.md'),
    ('抽取配置规范',base+'references/extraction-config.md'),
    ('运行时验证器',base+'scripts/lib/sg-data-loader.js'),
    ('抽取与等价性',base+'scripts/lib/sg-pack-extract-core.js'),
    ('Recrawl Review',base+'scripts/lib/sg-recrawl-review.js'),
    ('Candidate',base+'scripts/lib/sg-pack-candidate.js'),
    ('统一报告',base+'scripts/sg-pack-report.js'),
    ('Agent Task Runner',base+'scripts/lib/sg-task-runner.js'),
    ('完整测试',base+'tests/'),
],widths=[4.3,12.3],small=True)

add_heading(doc,'附录 B  设计评分（主观评估）',2)
add_table(doc,['维度','评分','说明'],[
    ('数据模型','9 / 10','稳定身份、引用优先、阶段 overlay 设计成熟'),
    ('遗留迁移策略','9 / 10','反腐适配层显著降低渲染回归风险'),
    ('正确性与审计','9 / 10','Fail closed、digest binding 和 evidence 边界清晰'),
    ('扩展性','7 / 10','domain 灵活，但跨库语义较弱'),
    ('可维护性','6.5 / 10','大型函数与多份契约实现形成压力'),
    ('安全隔离','6 / 10','边界表达诚实，但没有 OS 级 sandbox'),
    ('产品内聚性','6.5 / 10','Agent Eval 扩张后边界需要重新拆分'),
],widths=[4.2,2.7,9.7])

# metadata/core props
props=doc.core_properties
props.title='SG Data Pack：组件库数据治理与可信变更链——技术产品解说'
props.subject='项目设计、产品定位、架构优势、设计权衡与演进路线'
props.author='Codex'
props.keywords='SG Data Pack, Data Pack, 组件库, 数据治理, 技术架构, 产品解说'
props.comments='基于 2026-08-06 当前工作区分析生成。'

# prevent awkward splitting for most tables and paragraphs
for table in doc.tables:
    for row in table.rows:
        trPr=row._tr.get_or_add_trPr(); cant=OxmlElement('w:cantSplit'); trPr.append(cant)

OUT.parent.mkdir(parents=True,exist_ok=True)
doc.save(OUT)
print(OUT)
