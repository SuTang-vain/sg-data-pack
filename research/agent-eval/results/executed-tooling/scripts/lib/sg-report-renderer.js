'use strict';

/* Render a RunReport; never performs checks or filesystem writes. */

function statusMark(status) {
  return { passed: '✓', failed: '✖', 'not-assessed': '○', 'not-applicable': '—', 'review-required': '!' }[status] || '•';
}

function outcomeLabel(outcome) {
  return {
    ready: 'DATA-VALID',
    'issues-found': 'ISSUES-FOUND',
    'review-required': 'REVIEW-REQUIRED',
    blocked: 'BLOCKED',
    'input-error': 'INPUT-ERROR',
  }[outcome] || String(outcome || 'UNKNOWN').toUpperCase();
}

function short(value, max = 240) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function renderJson(report) {
  return JSON.stringify(report, null, 2) + '\n';
}

function renderTerminalSummary(report, options = {}) {
  const lines = [];
  lines.push(`SG Data Pack — ${report.run.libId}`);
  lines.push(`状态：${outcomeLabel(report.run.outcome)}  | 成熟度：${report.run.maturity}`);
  lines.push(`摘要：${report.summary.findings} findings / ${report.summary.changes} changes / ${report.summary.notAssessed} 项未评估`);
  lines.push('');

  const section = (title, entries, formatter, emptyText) => {
    lines.push(title);
    if (!entries.length) lines.push(`  ${emptyText}`);
    else entries.slice(0, options.limit || 20).forEach((entry, index) => lines.push(formatter(entry, index)));
    if (entries.length > (options.limit || 20)) lines.push(`  … 其余 ${entries.length - (options.limit || 20)} 项见完整报告`);
    lines.push('');
  };

  section('发现的问题', report.findings.filter((item) => ['open', 'review-required'].includes(item.status)), (item) => {
    const subject = item.subject ? ` [${item.subject}]` : '';
    const hint = item.repairHint ? `；建议：${short(item.repairHint, 150)}` : '';
    return `  ${item.severity === 'error' ? '✖' : item.status === 'review-required' ? '!' : '⚠'} ${item.code}${subject}：${short(item.message)}${hint}`;
  }, '未发现开放问题');

  section('已修改 / 已完善', report.changes, (item) => {
    const subject = item.subject ? ` [${item.subject}]` : '';
    const transition = item.before !== null || item.after !== null
      ? `：${short(item.before, 100)} → ${short(item.after, 100)}`
      : '';
    return `  • ${item.title || item.id}${subject}${transition}`;
  }, '本次没有可比较的变更');

  section('验证范围', report.assurances, (item) => {
    const evidence = item.evidence ? ` — ${short(item.evidence, 160)}` : '';
    return `  ${statusMark(item.status)} ${item.title}${evidence}`;
  }, '没有验证项');

  section('剩余风险', report.risks, (item) => {
    const reason = item.reason || item.message || item.title || '';
    return `  ⚠ ${item.title || item.id}：${short(reason)}`;
  }, '没有额外风险记录');

  section('下一步', report.nextSteps, (item, index) => {
    const command = item.command ? `\n     命令：${item.command}` : '';
    const doneWhen = item.doneWhen ? `\n     完成条件：${item.doneWhen}` : '';
    return `  ${index + 1}. [${item.priority || 'P2'}] ${item.title}${command}${doneWhen}`;
  }, '没有自动生成的下一步');

  if (report.operations.length) {
    lines.push(`审核操作：${report.operations.length} 项；derivation 影响：${report.impacts.length} 项`);
    lines.push('');
  }
  if (options.reportPath) lines.push(`完整报告：${options.reportPath}`);
  return lines.join('\n') + '\n';
}

function renderMarkdown(report, options = {}) {
  const lines = [];
  lines.push(`# SG Data Pack 报告：${report.run.libId}`);
  lines.push('');
  lines.push(`- **状态**：${outcomeLabel(report.run.outcome)}`);
  lines.push(`- **成熟度**：${report.run.maturity}`);
  lines.push(`- **Run ID**：\`${report.run.id}\``);
  lines.push('');

  lines.push('## 执行摘要');
  lines.push('');
  lines.push(`发现 **${report.summary.findings}** 项，变更 **${report.summary.changes}** 项，开放问题 **${report.summary.open}** 项，未评估 **${report.summary.notAssessed}** 项。`);
  lines.push('');

  lines.push('## 数据概况');
  lines.push('');
  lines.push('| 数据集合 | 数量 |');
  lines.push('|---|---:|');
  const inventoryLabels = {
    entities: 'Entities', aliases: 'Aliases', relationTypes: 'Relation types', heroRelTypes: 'Hero relation types',
    relations: 'Relations', stages: 'Stages', contents: 'Contents', domainKeys: 'Domain keys', assets: 'Assets',
    sameAs: 'sameAs pairs', provenanceEntities: 'Entity provenance', derivations: 'Derivations',
  };
  Object.entries(inventoryLabels).forEach(([key, label]) => lines.push(`| ${label} | ${report.inventory[key] === undefined ? 0 : report.inventory[key]} |`));
  lines.push('');

  const mdList = (heading, entries, render, empty) => {
    lines.push(`## ${heading}`);
    lines.push('');
    if (!entries.length) lines.push(`> ${empty}`);
    else entries.forEach((entry, index) => lines.push(render(entry, index)));
    lines.push('');
  };
  mdList('发现的问题', report.findings.filter((item) => ['open', 'review-required'].includes(item.status)), (item) => {
    const subject = item.subject ? `（${item.subject}）` : '';
    const hint = item.repairHint ? `\n  - 修复建议：${item.repairHint}` : '';
    return `- [ ] **${item.code}** ${item.title}${subject}：${item.message}${hint}`;
  }, '未发现开放问题。');

  const resolvedFindings = report.findings.filter((item) => item.status === 'resolved');
  if (resolvedFindings.length) {
    lines.push('## 已解决问题');
    lines.push('');
    resolvedFindings.forEach((item) => lines.push(`- [x] **${item.code}** ${item.title}：${item.message}`));
    lines.push('');
  }

  mdList('已修改 / 已完善', report.changes, (item) => {
    const subject = item.subject ? `（${item.subject}）` : '';
    const beforeAfter = item.before !== null || item.after !== null ? `：\`${short(item.before, 160)}\` → \`${short(item.after, 160)}\`` : '';
    return `- **${item.title || item.id}**${subject}${beforeAfter}`;
  }, '本次没有可比较的变更。');

  mdList('验证与保证范围', report.assurances, (item) => {
    const evidence = item.evidence ? ` — ${item.evidence}` : '';
    return `- ${statusMark(item.status)} **${item.title}**${evidence}`;
  }, '没有验证项。');

  mdList('剩余风险', report.risks, (item) => `- **${item.title || item.id}**：${item.reason || item.message || ''}`, '没有额外风险记录。');

  mdList('下一步开发动作', report.nextSteps, (item, index) => {
    const details = [item.owner && `owner: ${item.owner}`, item.command && `命令: \`${item.command}\``, item.doneWhen && `完成条件: ${item.doneWhen}`].filter(Boolean).join('；');
    return `${index + 1}. **[${item.priority || 'P2'}] ${item.title}**${details ? ` — ${details}` : ''}`;
  }, '没有自动生成的下一步。');

  if (report.operations.length) {
    lines.push('## 审核操作');
    lines.push('');
    lines.push(`共 ${report.operations.length} 项操作，详见 audit 输入或 JSON report。`);
    lines.push('');
  }
  if (report.impacts.length) {
    lines.push('## Derivation 影响');
    lines.push('');
    report.impacts.forEach((item) => lines.push(`- **${item.name || item.id}**：${(item.triggers || []).join(', ')}`));
    lines.push('');
  }
  if (options.generatedBy) {
    lines.push(`_Generated by sg-data-pack report; ${options.generatedBy}_`);
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { renderJson, renderTerminalSummary, renderMarkdown, outcomeLabel };
