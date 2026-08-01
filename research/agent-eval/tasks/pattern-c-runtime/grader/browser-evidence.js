#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');

const [, , workspace, artifacts, candidateTreeSha256, taskId, toolRoot] = process.argv;
if (!workspace || !artifacts || !candidateTreeSha256 || !taskId || !toolRoot) {
  console.error('Usage: browser-evidence <workspace> <artifacts> <candidate-tree-sha256> <task-id> <tool-root>');
  process.exit(3);
}
let sha256Bytes;
let contentId;
let stableJson;
let snapshotTree;
try {
  ({ sha256Bytes, contentId, stableJson } = require(path.join(toolRoot, 'scripts/lib/sg-evidence-utils.js')));
  ({ snapshotTree } = require(path.join(toolRoot, 'scripts/lib/sg-tree-snapshot.js')));
  fs.mkdirSync(artifacts, { recursive: true });
} catch (error) {
  console.error('Browser producer setup failed: ' + (error.stack || error.message));
  process.exit(3);
}
const reference = path.join(__dirname, 'pattern-c-reference');

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
  ];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) continue;
    const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (!probe.error && probe.status === 0) return { executable: candidate, version: (probe.stdout || probe.stderr).trim() };
  }
  throw new Error('No supported Chrome or Chromium executable is available');
}

function verifyPillow() {
  const probe = spawnSync('python3', ['-c', 'from PIL import Image, ImageChops'], { encoding: 'utf8', timeout: 5000 });
  if (probe.error || probe.status !== 0) throw new Error('Python Pillow is unavailable: ' + (probe.stderr || probe.error));
}

function runChrome(chrome, root, label) {
  const html = path.join(root, 'lib/examples/index.html');
  const screenshot = path.join(artifacts, `${label}.png`);
  const common = [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--metrics-recording-only',
    '--window-size=1100,720', '--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000',
  ];
  const imageRun = spawnSync(chrome, [...common, `--screenshot=${screenshot}`, pathToFileURL(html).href], { encoding: 'utf8', maxBuffer: 4 << 20, timeout: 30000 });
  const domRun = spawnSync(chrome, [...common, '--dump-dom', pathToFileURL(html).href], { encoding: 'utf8', maxBuffer: 4 << 20, timeout: 30000 });
  if (imageRun.error || domRun.error || imageRun.status !== 0 || domRun.status !== 0 || !fs.existsSync(screenshot)) {
    throw new Error(`Chrome ${label} failed: ${imageRun.stderr || domRun.stderr || imageRun.error || domRun.error}`);
  }
  const domFile = path.join(artifacts, `${label}.dom.html`);
  const logFile = path.join(artifacts, `${label}.chrome.log`);
  fs.writeFileSync(domFile, domRun.stdout);
  fs.writeFileSync(logFile, [imageRun.stderr, domRun.stderr].filter(Boolean).join('\n'));
  return { screenshot, domFile, logFile, dom: domRun.stdout };
}

function compareImages(left, right, output) {
  const comparison = spawnSync('python3', ['-c', [
    'from PIL import Image, ImageChops',
    'import json,sys',
    'a=Image.open(sys.argv[1]).convert("RGBA")',
    'b=Image.open(sys.argv[2]).convert("RGBA")',
    'assert a.size==b.size',
    'd=ImageChops.difference(a,b)',
    'd.save(sys.argv[3])',
    'changed=sum(1 for p in d.getdata() if p != (0,0,0,0))',
    'print(json.dumps({"changed":changed,"total":a.width*a.height,"ratio":changed/(a.width*a.height)}))',
  ].join(';'), left, right, output], { encoding: 'utf8', timeout: 30000 });
  if (comparison.error || comparison.status !== 0) throw new Error('Pillow comparison failed: ' + (comparison.stderr || comparison.error));
  return JSON.parse(comparison.stdout);
}

function attribute(dom, name) {
  const match = new RegExp(`${name}="([^"]*)"`).exec(dom);
  return match ? match[1] : null;
}
function errorArray(dom, name) {
  const value = attribute(dom, name);
  if (value === null) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch (_) {
    return null;
  }
}
function artifact(id, file, mediaType) {
  const bytes = fs.readFileSync(file);
  return { id, path: path.basename(file), mediaType, sha256: sha256Bytes(bytes) };
}

let browser;
let referenceRun;
try {
  browser = findChrome();
  verifyPillow();
  referenceRun = runChrome(browser.executable, reference, 'reference');
  const preflightDiff = path.join(artifacts, 'reference-preflight-diff.png');
  const preflightMetric = compareImages(referenceRun.screenshot, referenceRun.screenshot, preflightDiff);
  fs.rmSync(preflightDiff, { force: true });
  if (preflightMetric.changed !== 0) throw new Error('reference image self-comparison is unstable');
} catch (error) {
  console.error('Browser producer infrastructure failed: ' + (error.stack || error.message));
  process.exit(3);
}

try {
  const candidateRun = runChrome(browser.executable, workspace, 'candidate');
  const stabilityRun = runChrome(browser.executable, workspace, 'candidate-stability');
  const diffFile = path.join(artifacts, 'visual-diff.png');
  const stabilityDiffFile = path.join(artifacts, 'stability-diff.png');
  const metric = compareImages(referenceRun.screenshot, candidateRun.screenshot, diffFile);
  const stability = compareImages(candidateRun.screenshot, stabilityRun.screenshot, stabilityDiffFile);
  const status = attribute(candidateRun.dom, 'data-runtime-status');
  const styleScore = Number(attribute(candidateRun.dom, 'data-computed-style-score'));
  const consoleErrors = errorArray(candidateRun.dom, 'data-console-errors');
  const pageErrors = errorArray(candidateRun.dom, 'data-page-errors');
  const networkFailures = errorArray(candidateRun.dom, 'data-network-failures');
  const collectorReady = consoleErrors !== null && pageErrors !== null && networkFailures !== null;
  const cardCount = (candidateRun.dom.match(/class="card"/g) || []).length;
  const runtimeArtifacts = [
    artifact('candidate-dom', candidateRun.domFile, 'text/html'),
    artifact('candidate-browser-log', candidateRun.logFile, 'text/plain'),
  ];
  const runtime = {
    evidenceVersion: '1.0', kind: 'runtime-evidence', evidenceId: null,
    scenarioId: 'pattern-c-gallery', subjectTreeSha256: candidateTreeSha256,
    producer: { name: 'headless-chrome-pattern-c', version: '1.2.0' },
    environment: { browser: browser.version, platform: process.platform, taskId },
    assertions: [
      { id: 'error-collector', status: collectorReady ? 'passed' : 'failed' },
      { id: 'mount-status', status: status === 'passed' ? 'passed' : 'failed', actual: status },
      { id: 'card-count', status: cardCount === 3 ? 'passed' : 'failed', actual: cardCount, expected: 3 },
      { id: 'gamma-visible', status: candidateRun.dom.includes('Gamma Card') ? 'passed' : 'failed' },
    ],
    consoleErrors: consoleErrors || ['browser error collector was not available'],
    pageErrors: pageErrors || [],
    networkFailures: networkFailures || [],
    artifacts: runtimeArtifacts,
  };
  runtime.evidenceId = contentId('runtime', runtime, ['evidenceId']);
  fs.writeFileSync(path.join(artifacts, 'runtime-evidence.json'), JSON.stringify(runtime, null, 2) + '\n');

  const visualArtifacts = [
    artifact('reference-screenshot', referenceRun.screenshot, 'image/png'),
    artifact('candidate-screenshot', candidateRun.screenshot, 'image/png'),
    artifact('diff-screenshot', diffFile, 'image/png'),
    artifact('candidate-stability-screenshot', stabilityRun.screenshot, 'image/png'),
    artifact('stability-diff-screenshot', stabilityDiffFile, 'image/png'),
  ];
  const thresholds = { maxPixelDiffRatio: 0.02, minComputedStyleScore: 0.98, minCoverage: 1 };
  const visual = {
    evidenceVersion: '1.0', kind: 'visual-evidence', evidenceId: null,
    referenceTreeSha256: 'sha256:' + snapshotTree(reference, { errorOnSpecialFile: true, exclude: false }).treeSha256,
    candidateTreeSha256,
    configurationSha256: sha256Bytes(stableJson({ viewport: [1100, 720], thresholds, stabilityRuns: 2 })),
    producer: { name: 'headless-chrome-pillow', version: '1.2.0' }, thresholds,
    scenarios: [{
      id: 'pattern-c-gallery-desktop', viewport: { width: 1100, height: 720 },
      pixelDiffRatio: metric.ratio,
      computedStyleScore: Number.isFinite(styleScore) ? styleScore : 0,
      coverage: Math.min(cardCount / 3, 1),
      stabilityFailures: stability.changed === 0 ? 0 : 1,
      referenceArtifact: 'reference-screenshot', candidateArtifact: 'candidate-screenshot', diffArtifact: 'diff-screenshot',
    }],
    artifacts: visualArtifacts,
  };
  visual.evidenceId = contentId('visual', visual, ['evidenceId']);
  fs.writeFileSync(path.join(artifacts, 'visual-evidence.json'), JSON.stringify(visual, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ runtime: runtime.evidenceId, visual: visual.evidenceId, pixelDiffRatio: metric.ratio, stabilityDiffRatio: stability.ratio }) + '\n');
} catch (error) {
  console.error('Candidate browser assessment failed: ' + (error.stack || error.message));
  process.exit(1);
}
