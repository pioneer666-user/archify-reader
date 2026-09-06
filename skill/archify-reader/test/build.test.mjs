import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, renderMarkdown, sectionFromMarkdown } from '../scripts/build.mjs';

const original = '<html><head><meta name="generator" content="archify 2.17.0-dev.1"></head><body><div class="diagram-container"><svg><g data-node-id="save"></g><g data-node-id="other"></g></svg></div><script>const marker="data-focus-selected";</script></body></html>';
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'archify-reader-'));
  await writeFile(path.join(root, 'original.html'), original);
  await writeFile(path.join(root, 'details.md'), '# 业务\n\n## 保存\n\n保存到 Redis。\n\n### 边界\n\n未归档。\n\n## 别的\n\n不应显示。');
  const manifest = { version: 1, input: 'original.html', output: 'reader.html', nodes: [{ id: 'save', label: '保存', note: '尚未归档', document: 'details.md', heading: '保存' }] };
  // 这些夹具专测普通详情，显式声明测试范围内的省略要求。
  for (const node of manifest.nodes) node.evidenceExemption = { kind: 'user-requested', reason: '测试夹具要求仅验证普通详情。' };
  const file = path.join(root, 'reader.json');
  const save = () => writeFile(file, JSON.stringify(manifest));
  await save();
  return { root, file, manifest, save };
}

test('build embeds the correct section, preserves original and is reproducible', async () => {
  const f = await fixture();
  const receipt = await build(f.file);
  const html = await readFile(path.join(f.root, 'reader.html'), 'utf8');
  assert.equal(await readFile(path.join(f.root, 'original.html'), 'utf8'), original);
  assert.ok(html.includes('保存到 Redis'));
  assert.ok(html.includes('未归档'));
  assert.ok(!html.includes('不应显示'));
  assert.equal(receipt.warnings.length, 1);
  assert.equal(receipt.browserEvidence, 'not_run');
  assert.equal((await build(f.file)).enhanced.sha256, receipt.enhanced.sha256);
});

test('invalid node and missing/ambiguous headings fail without replacing last output', async () => {
  const f = await fixture();
  await build(f.file);
  const previous = await readFile(path.join(f.root, 'reader.html'), 'utf8');
  f.manifest.nodes[0].id = 'missing'; await f.save();
  await assert.rejects(build(f.file), /图中没有节点/);
  f.manifest.nodes[0].id = 'save'; f.manifest.nodes[0].heading = '不存在'; await f.save();
  await assert.rejects(build(f.file), /详情章节必须唯一且存在/);
  f.manifest.nodes[0].heading = '保存'; await f.save();
  await writeFile(path.join(f.root, 'details.md'), '## 保存\n第一段\n\n## 保存\n第二段');
  await assert.rejects(build(f.file), /找到 2 处/);
  assert.equal(await readFile(path.join(f.root, 'reader.html'), 'utf8'), previous);
});

test('rejects duplicate mappings, source overwrite, outside docs and already enhanced input', async () => {
  const f = await fixture();
  f.manifest.nodes.push({ ...f.manifest.nodes[0] }); await f.save();
  await assert.rejects(build(f.file), /节点关联重复/);
  f.manifest.nodes.pop(); f.manifest.output = 'original.html'; await f.save();
  await assert.rejects(build(f.file), /不能覆盖/);
  f.manifest.output = 'reader.html'; f.manifest.nodes[0].document = path.join(f.root, 'details.md'); await f.save();
  await assert.rejects(build(f.file), /相对 MD 路径/);
  f.manifest.nodes[0].document = 'details.md'; await f.save(); await build(f.file);
  f.manifest.input = 'reader.html'; f.manifest.output = 'second.html'; await f.save();
  await assert.rejects(build(f.file), /输入已经增强/);
});

test('Markdown headings inside fences do not break section boundaries', () => {
  const section = sectionFromMarkdown('## 目标\n说明\n```md\n## 目标\n```\n### 子节\n细节\n## 下节\n结束', '目标');
  assert.ok(section.includes('细节'));
  assert.ok(!section.includes('结束'));
});

test('authored Markdown cannot inject script, HTML, active links or remote images', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[危险](javascript:alert)\n\n![图](https://example.invalid/image.png)');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<a '));
  assert.ok(!html.includes('<img '));
  assert.ok(html.includes('危险'));
});

test('literal replacement characters and script terminators in notes stay data', async () => {
  const f = await fixture();
  f.manifest.nodes[0].note = '$& $` $\' </script><script>bad()</script>';
  await f.save(); await build(f.file);
  const html = await readFile(path.join(f.root, 'reader.html'), 'utf8');
  const encoded = html.match(/<script id="sd-reader-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(encoded).nodes[0].note, f.manifest.nodes[0].note);
  assert.ok(!html.includes('<script>bad()'));
});

test('默认拒绝无证据详情，保留旧页面和收据；显式设计豁免可见且转义', async () => {
  const f = await fixture();
  await build(f.file);
  const out = path.join(f.root, 'reader.html');
  const before = await readFile(out);
  const receiptBefore = await readFile(out + '.receipt.json');
  delete f.manifest.nodes[0].evidenceExemption; await f.save();
  await assert.rejects(build(f.file), /缺少源码证据：save/);
  assert.deepEqual(await readFile(out), before);
  assert.deepEqual(await readFile(out + '.receipt.json'), receiptBefore);
  f.manifest.nodes[0].evidenceExemption = { kind: 'design', reason: '拟议功能 <img src=x> 尚未实现' }; await f.save();
  const receipt = await build(f.file);
  const html = await readFile(out, 'utf8');
  const content = JSON.parse(html.match(/<script id="sd-reader-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).nodes[0].html;
  assert.ok(content.includes('未实现设计 · 无源码对照'));
  assert.ok(content.includes('&lt;img src=x&gt;'));
  assert.equal(receipt.evidenceCoverage.exemptions[0].kind, 'design');
  assert.equal(receipt.evidenceCoverage.paragraphCoverage, 'not_verified');
  for (const invalid of [null, {}, {kind:'design',reason:' '}, {kind:'unavailable',reason:'没有代码'}, {kind:'design',reason:'设计',extra:true}]) {
    f.manifest.nodes[0].evidenceExemption = invalid; await f.save();
    await assert.rejects(build(f.file));
  }
});
