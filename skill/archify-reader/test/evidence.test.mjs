import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from '../scripts/build.mjs';

const run = promisify(execFile);
const source = 'async function save() {\r\n  await write();\r\n  return "</script><img src=x onerror=bad()>";\r\n}\r\n';
const markdown = '## 保存\n范围说明不能丢。\n\n### 第一步\n先保存。\n\n#### 失败条件\n失败则中断。\n\n### 第二步\n随后返回。\n\n### 待核实\n尚未运行验证。\n';
const original = '<html><head><meta name="generator" content="archify 2.17.0-dev.1"></head><body><div class="diagram-container"><svg><g data-node-id="save"></g></svg></div><script>const marker="data-focus-selected";</script></body></html>';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reader-evidence-'));
  const git = async (...args) => (await run('git', ['-C', root, ...args], { windowsHide: true })).stdout.trim();
  await git('init');
  await git('config', 'core.autocrlf', 'false');
  await writeFile(path.join(root, 'code.js'), source);
  await writeFile(path.join(root, 'binary.bin'), Buffer.from([0, 255, 0]));
  await git('add', 'code.js', 'binary.bin');
  await git('-c', 'user.name=ReaderTest', '-c', 'user.email=reader@example.invalid', 'commit', '-m', '源码快照');
  const commit = await git('rev-parse', 'HEAD');
  await writeFile(path.join(root, 'original.html'), original);
  await writeFile(path.join(root, 'details.md'), markdown);
  const manifest = { version: 1, input: 'original.html', output: 'reader.html', codeSource: { repository: '.', commit }, nodes: [{
    id: 'save', label: '保存', note: '保存后返回', document: 'details.md', heading: '保存', evidence: [
      { heading: '第二步', snippets: [{ file: 'code.js', startLine: 3, endLine: 4 }] },
      { heading: '第一步', snippets: [{ file: 'code.js', startLine: 1, endLine: 2 }] },
    ],
  }] };
  const file = path.join(root, 'reader.json');
  const save = () => writeFile(file, JSON.stringify(manifest));
  await save();
  const output = () => readFile(path.join(root, 'reader.html'), 'utf8');
  return { root, git, commit, manifest, file, save, output };
}
function nodeHtml(html) {
  return JSON.parse(html.match(/<script id="sd-reader-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).nodes[0].html;
}

test('有部分证据仍拒绝遗漏节点；混合设计可豁免但不能同时配证据', async () => {
  const f = await fixture();
  await writeFile(path.join(f.root, 'original.html'), original.replace('</svg>', '<g data-node-id="proposal"></g></svg>'));
  await writeFile(path.join(f.root, 'details.md'), markdown + '\n## 提案\n拟议：增加通知。\n');
  f.manifest.nodes.push({id:'proposal',label:'提案',note:'尚未实现',document:'details.md',heading:'提案'}); await f.save();
  await assert.rejects(build(f.file), /缺少源码证据：proposal/);
  f.manifest.nodes[1].evidenceExemption = {kind:'design',reason:'拟议通知未实现'}; await f.save();
  const receipt = await build(f.file);
  assert.deepEqual(receipt.evidenceCoverage.evidencedNodes, ['save']);
  assert.equal(receipt.evidenceCoverage.exemptions.length, 1);
  assert.ok(receipt.codeEvidence.mappings.length > 0);
  f.manifest.nodes[0].evidenceExemption = {kind:'user-requested',reason:'测试冲突'}; await f.save();
  await assert.rejects(build(f.file), /不能同时配置/);
});

test('按 MD 顺序配对，保留范围/子节/待核实内容；源码作为文字嵌入', async () => {
  const f = await fixture();
  const receipt = await build(f.file);
  const html = await f.output();
  const content = nodeHtml(html);
  assert.ok(content.indexOf('第一步') < content.indexOf('第二步'));
  for (const text of ['范围说明不能丢', '失败则中断', '尚未运行验证', 'data-line="3"']) assert.ok(content.includes(text));
  assert.ok(!content.includes('<img'));
  assert.ok(!content.includes('</script>'));
  assert.ok(content.includes('&lt;/script&gt;'));
  assert.equal(receipt.codeEvidence.commit, f.commit);
  assert.equal(receipt.codeEvidence.mappings.length, 2);
  assert.equal(receipt.codeEvidence.semanticVerification, 'not_run');
  assert.equal(receipt.businessVerification, 'not_run');
  assert.equal(await readFile(path.join(f.root, 'original.html'), 'utf8'), original);
  assert.equal((await build(f.file)).enhanced.sha256, receipt.enhanced.sha256);
});

test('工作区修改和后续提交不能悄悄替换锁定的源码', async () => {
  const f = await fixture();
  const first = await build(f.file);
  await writeFile(path.join(f.root, 'code.js'), '完全不同的源码\n');
  assert.equal((await build(f.file)).enhanced.sha256, first.enhanced.sha256);
  await f.git('add', 'code.js');
  await f.git('-c', 'user.name=ReaderTest', '-c', 'user.email=reader@example.invalid', 'commit', '-m', '源码变更');
  assert.equal((await build(f.file)).enhanced.sha256, first.enhanced.sha256);
  f.manifest.codeSource.commit = await f.git('rev-parse', 'HEAD'); await f.save();
  await assert.rejects(build(f.file), /越界/);
});

test('错误路径、越界/空行范围和假代码字段均失败，保留上次页面及收据', async () => {
  const f = await fixture();
  await build(f.file);
  const before = await f.output();
  const receiptFile = path.join(f.root, 'reader.html.receipt.json');
  const beforeReceipt = await readFile(receiptFile, 'utf8');
  const pair = f.manifest.nodes[0].evidence[0];
  const invalid = [
    { file: '../code.js', startLine: 1, endLine: 2 },
    { file: 'D:/code.js', startLine: 1, endLine: 2 },
    { file: 'missing.js', startLine: 1, endLine: 2 },
    { file: 'code.js', startLine: 0, endLine: 2 },
    { file: 'code.js', startLine: 1.5, endLine: 2 },
    { file: 'code.js', startLine: 2, endLine: 1 },
    { file: 'code.js', startLine: 4, endLine: 5 },
    { file: 'binary.bin', startLine: 1, endLine: 1 },
    { file: 'code.js', startLine: 1, endLine: 2, code: '伪造代码' },
  ];
  for (const spec of invalid) {
    pair.snippets = [spec]; await f.save();
    await assert.rejects(build(f.file));
    assert.equal(await f.output(), before);
    assert.equal(await readFile(receiptFile, 'utf8'), beforeReceipt);
  }
});

test('拒绝不稳定版本、不存在的 commit 和无源码配置的证据', async () => {
  const f = await fixture();
  for (const commit of ['HEAD', f.commit.slice(0, 8), '0'.repeat(40)]) {
    f.manifest.codeSource.commit = commit; await f.save();
    await assert.rejects(build(f.file));
  }
  delete f.manifest.codeSource; await f.save();
  await assert.rejects(build(f.file), /必须提供 codeSource/);
});

test('拼错证据字段不能静默退回普通模式', async () => {
  const f = await fixture();
  delete f.manifest.codeSource;
  const node = f.manifest.nodes[0];
  node.evidences = node.evidence; delete node.evidence;
  await f.save();
  await assert.rejects(build(f.file), /含不支持的字段/);
});

test('拒绝缺失、重复、嵌套和空白的业务章节映射', async () => {
  const f = await fixture();
  for (const heading of ['不存在', '失败条件', '第一步']) {
    f.manifest.nodes[0].evidence[0].heading = heading; await f.save();
    await assert.rejects(build(f.file));
  }
  f.manifest.nodes[0].evidence[0].heading = '第二步'; await f.save();
  await writeFile(path.join(f.root, 'details.md'), markdown + '\n### 第二步\n重复\n');
  await assert.rejects(build(f.file), /必须唯一/);
  await writeFile(path.join(f.root, 'details.md'), markdown.replace('随后返回。', ''));
  await assert.rejects(build(f.file), /没有业务正文/);
});
