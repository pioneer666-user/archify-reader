import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from '../scripts/build.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reader-references-'));
  const original = '<html><head><meta name="generator" content="archify 2.17.0-dev.1"></head><body><div class="diagram-container"><svg><g data-node-id="save"></g><g data-node-id="config"></g><g data-node-id="unmapped"></g></svg></div><script>const marker="data-focus-selected";</script></body></html>';
  const markdown = '## 保存\n先读取[配置](node:config)，再保存。参见[配置](node:config)。\n\n`[配置](node:config)`\n\n```md\n[配置](node:config)\n```\n\n## 配置\n设置保存开关。\n';
  await writeFile(path.join(root, 'raw.html'), original);
  await writeFile(path.join(root, 'details.md'), markdown);
  const manifest = { version:1, input:'raw.html', output:'reader.html', nodes:[
    { id:'save', label:'保存', note:'保存答卷', document:'details.md', heading:'保存', references:[{target:'config',relation:'configuration'}] },
    { id:'config', label:'配置', note:'设置开关', document:'details.md', heading:'配置' },
  ] };
  // 这些夹具专测普通详情，显式声明测试范围内的省略要求。
  for (const node of manifest.nodes) node.evidenceExemption = { kind: 'user-requested', reason: '测试夹具要求仅验证普通详情。' };
  const file = path.join(root, 'reader.json');
  const save = () => writeFile(file, JSON.stringify(manifest));
  await save();
  return { root, file, manifest, save, markdown };
}

test('正文引用生成内部按钮；代码示例保留文字；收据不声称业务关系正确', async () => {
  const f = await fixture();
  const receipt = await build(f.file);
  const html = await readFile(path.join(f.root, 'reader.html'), 'utf8');
  const content = JSON.parse(html.match(/<script id="sd-reader-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).nodes[0].html;
  assert.equal((content.match(/data-sd-target="config"/g) || []).length, 2);
  assert.ok(content.includes('<code>[配置](node:config)</code>'));
  assert.ok(content.includes('先读取') && content.includes('再保存'));
  assert.equal(receipt.nodeReferences.mappings[0].occurrences, 2);
  assert.equal(receipt.nodeReferences.semanticVerification, 'not_run');
  assert.equal((await build(f.file)).enhanced.sha256, receipt.enhanced.sha256);
});

test('拒绝未知关系、自引用、重复和缺少详情的目标，保留上次产物', async () => {
  const f = await fixture(); await build(f.file);
  const before = await readFile(path.join(f.root, 'reader.html'));
  const previousReceipt = await readFile(path.join(f.root, 'reader.html.receipt.json'));
  for (const references of [
    [{target:'missing',relation:'later'}], [{target:'unmapped',relation:'later'}],
    [{target:'save',relation:'input'}], [{target:'config',relation:'automatic'}],
    [{target:'config',relation:'input'},{target:'config',relation:'later'}],
    [{target:'config',relation:'input',code:'伪造字段'}], null,
  ]) {
    f.manifest.nodes[0].references = references; await f.save();
    await assert.rejects(build(f.file));
    assert.deepEqual(await readFile(path.join(f.root, 'reader.html')), before);
    assert.deepEqual(await readFile(path.join(f.root, 'reader.html.receipt.json')), previousReceipt);
  }
});

test('拒绝未声明、误标名称、未使用的引用和不存在的目标章节', async () => {
  const f = await fixture();
  delete f.manifest.nodes[0].references; await f.save();
  await assert.rejects(build(f.file), /未声明/);
  f.manifest.nodes[0].references = [{target:'config',relation:'configuration'}]; await f.save();
  await writeFile(path.join(f.root, 'details.md'), f.markdown.replace('[配置](node:config)', '[保存](node:config)'));
  await assert.rejects(build(f.file), /名称须与目标一致/);
  await writeFile(path.join(f.root, 'details.md'), '## 保存\n`[配置](node:config)`\n\n## 配置\n内容');
  await assert.rejects(build(f.file), /未用于正文/);
  await writeFile(path.join(f.root, 'details.md'), f.markdown);
  f.manifest.nodes[1].heading = '不存在'; await f.save();
  await assert.rejects(build(f.file), /章节必须唯一且存在/);
});
