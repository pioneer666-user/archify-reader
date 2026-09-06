import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Marked } from '../vendor/marked.mjs';

const run = promisify(execFile);
const check = (ok, message) => { if (!ok) throw new Error(message); };
const sha = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fields(value, allowed, context) {
  check(value && typeof value === 'object' && !Array.isArray(value), `${context}必须是对象`);
  check(Object.keys(value).every(key => allowed.includes(key)), `${context}含不支持的字段`);
}

// 只读 Git 对象，不执行仓库代码、过滤器或 shell；不跟随工作区内容和替换对象。
async function git(repository, args) {
  try {
    const { stdout } = await run('git', ['--no-replace-objects', '--literal-pathspecs', '-C', repository, ...args], {
      encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    });
    return stdout;
  } catch {
    throw new Error(`读取源码快照失败：${args[0]}；请检查仓库、完整 commit 和文件是否存在`);
  }
}

export async function createEvidenceSource(config, root) {
  fields(config, ['repository', 'commit'], 'codeSource');
  check(typeof config.repository === 'string' && config.repository.trim(), 'codeSource.repository 必须指定本地源码仓库');
  check(typeof config.commit === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(config.commit), 'codeSource.commit 必须是完整小写 commit 哈希，不能使用分支名');
  const repository = await realpath(path.resolve(root, config.repository));
  const top = (await git(repository, ['rev-parse', '--show-toplevel'])).toString('utf8').trim();
  check((await realpath(top)).toLowerCase() === repository.toLowerCase(), 'codeSource.repository 必须指向仓库根目录');
  check((await git(repository, ['cat-file', '-t', config.commit])).toString('utf8').trim() === 'commit', 'codeSource.commit 对象必须是 commit');
  const files = new Map();
  const mappings = [];
  const summary = { repository: path.basename(repository), commit: config.commit };

  async function readSnippet(spec) {
    fields(spec, ['file', 'startLine', 'endLine'], '源码片段');
    check(typeof spec.file === 'string' && spec.file && !/[\\:\x00-\x1f\x7f]/.test(spec.file)
      && !spec.file.startsWith('/') && spec.file.split('/').every(part => part && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'), '源码文件必须使用仓库内相对路径和正斜杠');
    check(Number.isSafeInteger(spec.startLine) && Number.isSafeInteger(spec.endLine)
      && spec.startLine >= 1 && spec.endLine >= spec.startLine, '源码行范围必须为正整数，且结束行不小于开始行');
    if (!files.has(spec.file)) {
      const tree = (await git(repository, ['ls-tree', '-z', config.commit, '--', spec.file])).toString('utf8');
      const match = tree.match(/^(100644|100755) blob ([a-f0-9]+)\t([^\0]+)\0$/);
      check(match && match[3] === spec.file, `源码文件不存在或不是普通文件：${spec.file}`);
      const bytes = await git(repository, ['cat-file', 'blob', match[2]]);
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { throw new Error(`源码必须为 UTF-8 文本：${spec.file}`); }
      check(!text.includes('\0'), `源码不能是二进制文件：${spec.file}`);
      const lines = text.split('\n');
      if (text.endsWith('\n')) lines.pop();
      files.set(spec.file, { lines, blob: match[2], sha256: sha(bytes) });
    }
    const file = files.get(spec.file);
    check(spec.endLine <= file.lines.length, `源码行范围越界：${spec.file} 共 ${file.lines.length} 行`);
    const code = file.lines.slice(spec.startLine - 1, spec.endLine).join('\n');
    check(code.trim(), `源码片段为空：${spec.file}:${spec.startLine}-${spec.endLine}`);
    return { ...spec, code, sha256: sha(code), blob: file.blob };
  }

  return {
    summary,
    async resolve(nodeId, evidence) {
      check(Array.isArray(evidence) && evidence.length > 0, `节点 evidence 必须是非空数组：${nodeId}`);
      const seen = new Set();
      const result = [];
      for (const pair of evidence) {
        fields(pair, ['heading', 'snippets'], '证据关联');
        check(typeof pair.heading === 'string' && pair.heading.trim() && !seen.has(pair.heading), '证据章节标题必须非空且不能重复');
        seen.add(pair.heading);
        check(Array.isArray(pair.snippets) && pair.snippets.length > 0, `证据章节缺少源码片段：${pair.heading}`);
        const snippets = [];
        for (const spec of pair.snippets) snippets.push(await readSnippet(spec));
        mappings.push({ nodeId, heading: pair.heading, snippets: snippets.map(({ code, ...ref }) => ref) });
        result.push({ heading: pair.heading, snippets });
      }
      return result;
    },
    receipt() {
      return { ...summary, files: [...files].map(([file, { lines, ...info }]) => ({ file, ...info })), mappings,
        checks: { commitExists: true, regularFiles: true, rangesExist: true, sectionsPaired: true },
        semanticVerification: 'not_run', runtimeVerification: 'not_run' };
    },
  };
}

function renderSnippet(snippet) {
  const label = `${snippet.file} · L${snippet.startLine}–${snippet.endLine}`;
  const lines = snippet.code.split('\n').map((line, index) => `<span class="sd-code-line" data-line="${snippet.startLine + index}">${escape(line)}</span>`).join('\n');
  return `<figure class="sd-snippet"><figcaption>${escape(label)}</figcaption><pre tabindex="0" aria-label="${escape(label)}"><code>${lines}</code></pre></figure>`;
}

// 按 MD 的顺序呈现，绝不按 JSON 顺序重排业务，也不丢弃未关联的上下文。
export function renderEvidenceMarkdown(markdown, pairs, summary, renderMarkdown) {
  const tokens = new Marked().lexer(markdown);
  const headings = tokens.flatMap((token, index) => token.type === 'heading' ? [{ index, ...token }] : []);
  const depth = Math.min(...headings.map(heading => heading.depth));
  const sections = new Map();
  for (const pair of pairs) {
    const hits = headings.filter(heading => heading.text === pair.heading);
    check(hits.length === 1 && hits[0].depth === depth, `证据标题必须唯一且为详情中的第一层子标题：${pair.heading}`);
    const start = hits[0].index;
    let end = start + 1;
    while (end < tokens.length && !(tokens[end].type === 'heading' && tokens[end].depth <= depth)) end++;
    check(tokens.slice(start + 1, end).some(token => token.type !== 'space'), `证据章节没有业务正文：${pair.heading}`);
    sections.set(start, { end, pair });
  }
  let html = `<div class="sd-evidence-meta"><strong>源码对照 · 版本快照</strong><span>${escape(summary.repository)} · <code title="${summary.commit}">${summary.commit.slice(0, 12)}</code></span><p>代码取自此版本；白话与对应关系由 AI 编写，尚未经过运行验证。未连线的段落是范围说明或待核实事项。</p></div>`;
  let plain = [];
  const flush = () => { if (plain.length) html += `<div class="sd-unpaired">${renderMarkdown(plain.join(''))}</div>`; plain = []; };
  let pairNumber = 0;
  for (let index = 0; index < tokens.length;) {
    const section = sections.get(index);
    if (!section) { plain.push(tokens[index++].raw); continue; }
    flush(); pairNumber++;
    html += `<section class="sd-evidence-pair" aria-label="${escape(section.pair.heading)}"><div class="sd-evidence-code"><div class="sd-column-label">${String(pairNumber).padStart(2, '0')} / 对应源码</div>${section.pair.snippets.map(renderSnippet).join('')}</div><div class="sd-evidence-link" aria-hidden="true"></div><div class="sd-evidence-prose"><div class="sd-column-label">业务说明</div>${renderMarkdown(tokens.slice(index, section.end).map(token => token.raw).join(''))}</div></section>`;
    index = section.end;
  }
  flush();
  return html;
}
