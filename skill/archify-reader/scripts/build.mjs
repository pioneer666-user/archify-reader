import { readFile, writeFile, mkdir, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Marked } from '../vendor/marked.mjs';
import { createEvidenceSource, renderEvidenceMarkdown } from './evidence.mjs';

const home = fileURLToPath(new URL('../', import.meta.url));
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sha = text => createHash('sha256').update(text).digest('hex');
const requireValue = (value, message) => { if (!value) throw new Error(message); };
const onlyFields = (value, fields, label) => {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), `${label}必须是对象`);
  requireValue(Object.keys(value).every(key => fields.includes(key)), `${label}含不支持的字段`);
};

// 原始 HTML、图片与普通链接只显示文字；只有校验过的节点引用生成内部按钮。
export function renderMarkdown(source, references = new Map()) {
  const md = new Marked({ gfm: true, breaks: false });
  md.use({ renderer: {
    html({ text }) { return escape(text); },
    link({ href, text, tokens }) {
      if (/^node:/i.test(href)) {
        const target = href.slice(5);
        const ref = references.get(target);
        requireValue(href.startsWith('node:') && ref, `节点引用未声明：${href}`);
        requireValue(text === ref.label, `节点引用名称须与目标一致：${text} → ${ref.label}`);
        ref.uses++;
        const label = `${ref.relationLabel} · ${ref.label}`;
        return `<button type="button" class="sd-node-reference" data-sd-target="${escape(target)}" title="${escape(label)}" aria-label="${escape(label)}">${escape(ref.label)}<span aria-hidden="true"> ↗</span></button>`;
      }
      return `${this.parser.parseInline(tokens)} <code>${escape(href)}</code>`;
    },
    image({ text }) { return `<span>${escape(text || '[图片]')}</span>`; },
  } });
  return md.parse(source);
}

export function sectionFromMarkdown(source, heading) {
  // Use the Markdown lexer so headings inside fenced examples are not targets.
  const tokens = new Marked().lexer(source);
  const hits = tokens.flatMap((token, index) => token.type === 'heading' && token.text === heading ? [index] : []);
  requireValue(hits.length === 1, `详情章节必须唯一且存在：${heading}（找到 ${hits.length} 处）`);
  const start = hits[0];
  let end = start + 1;
  while (end < tokens.length && !(tokens[end].type === 'heading' && tokens[end].depth <= tokens[start].depth)) end++;
  return tokens.slice(start + 1, end).map(token => token.raw).join('');
}

async function localDocument(root, relative) {
  requireValue(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !/^[a-z]+:/i.test(relative), '详情必须使用相对 MD 路径');
  const target = await realpath(path.resolve(root, relative));
  const rel = path.relative(root, target);
  requireValue(rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel) && /\.md$/i.test(target), `详情必须位于关联文件目录内：${relative}`);
  return target;
}

export async function build(manifestPath) {
  const manifestFile = await realpath(manifestPath);
  const root = path.dirname(manifestFile);
  const manifestText = await readFile(manifestFile, 'utf8');
  const manifest = JSON.parse(manifestText);
  onlyFields(manifest, ['version', 'input', 'output', 'nodes', 'codeSource'], '关联文件');
  requireValue(manifest.version === 1, '不支持的关联文件版本');
  const input = await realpath(path.resolve(root, manifest.input));
  const output = path.resolve(root, manifest.output);
  requireValue(path.dirname(output) === root && /\.html$/i.test(output), '增强 HTML 必须输出到关联文件同目录');
  requireValue(input.toLowerCase() !== output.toLowerCase(), '不能覆盖 Archify 原生 HTML');
  const original = await readFile(input, 'utf8');
  requireValue(!original.includes('id="sd-reader"'), '输入已经增强过，请使用 Archify 原始 HTML');
  const generator = original.match(/<meta name="generator" content="(archify [^"]+)"/i)?.[1];
  requireValue(generator, '未识别 Archify 生成标记');
  requireValue(original.includes('data-focus-selected') && original.includes('class="diagram-container"'), 'Archify 适配检查失败：节点聚焦或容器标记缺失');
  requireValue((original.match(/<\/body>/gi) || []).length === 1, 'HTML 必须有且只有一个 body 结束标签');
  const nodeIds = [...original.matchAll(/<g\b[^>]*\bdata-node-id="([^"]+)"/g)].map(match => match[1]);
  requireValue(nodeIds.length > 0 && new Set(nodeIds).size === nodeIds.length, '图节点缺失或 ID 不唯一');
  requireValue(Array.isArray(manifest.nodes) && manifest.nodes.length > 0, '至少需要一个节点关联');
  for (const entry of manifest.nodes) onlyFields(entry, ['id', 'label', 'note', 'document', 'heading', 'evidence', 'references', 'evidenceExemption'], '节点关联');
  // 默认要求每个已配置详情的节点有证据；例外必须显式声明并向读者展示。
  const exemptions = [];
  const missingEvidence = [];
  for (const entry of manifest.nodes) {
    if (Object.hasOwn(entry, 'evidenceExemption')) {
      const exemption = entry.evidenceExemption;
      onlyFields(exemption, ['kind', 'reason'], '证据豁免');
      requireValue(['design', 'user-requested'].includes(exemption.kind), '证据豁免 kind 只能是 design 或 user-requested');
      requireValue(typeof exemption.reason === 'string' && exemption.reason.trim(), '证据豁免必须写明原因');
      requireValue(!Object.hasOwn(entry, 'evidence'), `证据与整节点豁免不能同时配置：${entry.id}`);
      exemptions.push({ nodeId: entry.id, ...exemption });
    } else if (!Object.hasOwn(entry, 'evidence')) missingEvidence.push(entry.id);
  }
  requireValue(!missingEvidence.length, `以下详情节点缺少源码证据：${missingEvidence.join('、')}。请阅读 references/code-evidence.md，在原 MD/JSON 上补 evidence 与 codeSource；仅未实现设计或用户明确要求省略时可声明 evidenceExemption，不能因讨论稿或即将重构而跳过。`);
  const hasEvidence = manifest.nodes.some(entry => Object.hasOwn(entry, 'evidence'));
  requireValue(!hasEvidence || manifest.codeSource, '配置 evidence 时必须提供 codeSource');
  requireValue(!manifest.codeSource || hasEvidence, 'codeSource 没有对应的 evidence 关联');
  const evidenceSource = hasEvidence ? await createEvidenceSource(manifest.codeSource, root) : null;
  const seen = new Set();
  const documents = new Map();
  const nodes = [];
  const nodeReferences = [];
  const relationLabels = { input: '前置输入', configuration: '配置来源', dependency: '依赖', next: '继续执行', later: '后续操作' };
  for (const entry of manifest.nodes) {
    requireValue(nodeIds.includes(entry.id), `图中没有节点：${entry.id}`);
    requireValue(!seen.has(entry.id), `节点关联重复：${entry.id}`);
    seen.add(entry.id);
    requireValue(typeof entry.label === 'string' && entry.label.trim() && typeof entry.note === 'string' && entry.note.trim(), `节点缺少名称或注释：${entry.id}`);
    requireValue(typeof entry.heading === 'string' && entry.heading.trim(), `节点缺少详情章节：${entry.id}`);
    const file = await localDocument(root, entry.document);
    if (!documents.has(file)) documents.set(file, await readFile(file, 'utf8'));
    const markdown = sectionFromMarkdown(documents.get(file), entry.heading);
    requireValue(markdown.trim(), `详情章节为空：${entry.heading}`);
    const references = new Map();
    if (Object.hasOwn(entry, 'references')) {
      requireValue(Array.isArray(entry.references), 'references 必须是数组');
      for (const ref of entry.references) {
        onlyFields(ref, ['target', 'relation'], '节点引用');
        const target = manifest.nodes.find(node => node.id === ref.target);
        requireValue(target && nodeIds.includes(ref.target), `引用目标必须在图中且配置详情：${ref.target}`);
        requireValue(ref.target !== entry.id && !references.has(ref.target), `节点引用不能指向自身或重复：${ref.target}`);
        requireValue(Object.hasOwn(relationLabels, ref.relation), `不支持的节点关系：${ref.relation}`);
        references.set(ref.target, { ...ref, label: target.label, relationLabel: relationLabels[ref.relation], uses: 0 });
      }
    }
    const render = source => renderMarkdown(source, references);
    const pairs = Object.hasOwn(entry, 'evidence') ? await evidenceSource.resolve(entry.id, entry.evidence) : null;
    const exemption = entry.evidenceExemption;
    const exemptionNotice = exemption ? `<p class="sd-unpaired"><strong>${exemption.kind === 'design' ? '未实现设计 · 无源码对照' : '按用户要求省略源码对照'}</strong>：${escape(exemption.reason)}</p>` : '';
    const html = pairs ? renderEvidenceMarkdown(markdown, pairs, evidenceSource.summary, render) : exemptionNotice + render(markdown);
    for (const ref of references.values()) {
      requireValue(ref.uses > 0, `声明的节点引用未用于正文：${entry.id} → ${ref.target}`);
      nodeReferences.push({ from: entry.id, to: ref.target, relation: ref.relation, occurrences: ref.uses });
    }
    nodes.push({ id: entry.id, label: entry.label, note: entry.note, source: `${entry.document} → ${entry.heading}`,
      ...(pairs ? { evidence: true } : {}),
      html });
  }
  const css = await readFile(path.join(home, 'assets/reader.css'), 'utf8');
  const js = await readFile(path.join(home, 'assets/reader.js'), 'utf8');
  const payload = JSON.stringify({ nodes, generator }).replace(/</g, '\\u003c');
  const addition = `\n<!-- Archify Reader v0.4: derived artifact; original receipt does not cover this extension. -->
<style id="sd-reader-style">${css}</style>
<div id="sd-reader">
  <button id="sd-open" type="button" aria-haspopup="dialog" aria-controls="sd-dialog">业务详情</button>
  <div id="sd-tip" role="tooltip" hidden></div>
  <dialog id="sd-dialog" aria-labelledby="sd-title">
    <header class="sd-header"><div><span class="sd-eyebrow">业务详情</span><h2 id="sd-title" tabindex="-1"></h2></div><div class="sd-actions"><button type="button" id="sd-back" hidden>返回上一详情</button><button type="button" id="sd-close" aria-label="关闭详情，返回图">关闭 ×</button></div></header>
    <label class="sd-picker">切换节点 <select id="sd-select" aria-label="切换详情节点"></select></label>
    <div id="sd-scroll"><p id="sd-note"></p><article id="sd-content"></article><p id="sd-source"></p></div>
  </dialog>
</div>
<script id="sd-reader-data" type="application/json">${payload}</script>
<script id="sd-reader-runtime">${js}</script>\n`;
  const enhanced = original.replace(/<\/body>/i, () => `${addition}</body>`);
  const warnings = nodeIds.filter(id => !seen.has(id)).map(id => `节点未配置详情：${id}`);
  const receipt = {
    extension: 'archify-reader/0.4', generator,
    original: { file: path.relative(root, input), sha256: sha(original) },
    manifest: { file: path.basename(manifestFile), sha256: sha(manifestText) },
    documents: [...documents].map(([file, source]) => ({ file: path.relative(root, file), sha256: sha(source) })),
    enhanced: { file: path.basename(output), sha256: sha(enhanced) },
    checks: { uniqueNodeIds: true, targetsExist: true, sectionsExist: true, originalPreserved: true },
    mappedNodes: nodes.length, totalNodes: nodeIds.length, warnings,
    evidenceCoverage: { scope: 'configured-detail-nodes', default: 'required', evidencedNodes: nodes.filter(node => node.evidence).map(node => node.id), exemptions, paragraphCoverage: 'not_verified', exemptionJustification: 'not_verified' },
    browserEvidence: 'not_run', visualReview: 'not_run', businessVerification: 'not_run',
    ...(nodeReferences.length ? { nodeReferences: { mappings: nodeReferences, targetsAndLabelsChecked: true, semanticVerification: 'not_run' } } : {}),
    ...(evidenceSource ? { codeEvidence: evidenceSource.receipt() } : {}),
  };
  await mkdir(path.dirname(output), { recursive: true });
  // Do not replace the last readable output when validation fails above.
  const pending = `${output}.pending`;
  await writeFile(pending, enhanced);
  await rename(pending, output);
  await writeFile(`${output}.receipt.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireValue(process.argv.length === 3, '用法：node scripts/build.mjs <reader.json>');
    console.log(JSON.stringify(await build(process.argv[2]), null, 2));
  } catch (error) { console.error(`Reader build failed: ${error.message}`); process.exitCode = 1; }
}
