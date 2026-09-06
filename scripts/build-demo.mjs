import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from '../skill/archify-reader/scripts/build.mjs';

// 只为公开虚构样例创建临时 Git 快照，不操作使用者的业务仓库。
const root = fileURLToPath(new URL('../', import.meta.url));
const example = path.join(root, 'examples/campus-events');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'archify-reader-demo-'));
const repo = path.join(temp, 'campus-events');
const run = (exe, args, env = process.env) => execFileSync(exe, args, { encoding:'utf8', windowsHide:true, env, maxBuffer:16 * 1024 * 1024 });
await fs.cp(path.join(example, 'campus-events'), repo, {recursive:true});
const git = (...args) => run('git', ['-C', repo, ...args]);
git('init');
git('config', 'core.autocrlf', 'false');
git('add', '--', 'app', 'docs');
run('git', ['-C',repo,'-c','user.name=Reader Demo','-c','user.email=demo@example.invalid','-c','commit.gpgsign=false','commit','-m','虚构校园报名源码快照'], {...process.env,GIT_AUTHOR_DATE:'2026-09-06T00:00:00Z',GIT_COMMITTER_DATE:'2026-09-06T00:00:00Z'});
const commit = git('rev-parse','HEAD').trim();
await fs.cp(example, path.join(temp, 'artifact'), {recursive:true});
const artifact = path.join(temp, 'artifact');
const cli = process.argv[2];
if (cli) {
  const output = run(process.execPath, [path.resolve(cli),'deliver','workflow',path.join(artifact,'workflow.json'),path.join(artifact,'diagram.html'),'--quality','showcase','--json']);
  await fs.writeFile(path.join(artifact,'delivery-receipt.json'),output);
} else {
  await fs.access(path.join(artifact,'diagram.html')).catch(() => { throw new Error('缺少原生图：首次构建请传入官方 archify.mjs 路径'); });
}
const manifest = JSON.parse(await fs.readFile(path.join(example,'reader.template.json'),'utf8'));
manifest.codeSource = {repository:'../campus-events',commit};
const manifestFile = path.join(artifact,'reader.json');
await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
const receipt = await build(manifestFile);
// 输出留在临时目录。只有经过检查的成品才由分享包维护者收录。
console.log(JSON.stringify({manifest:manifestFile,html:path.join(artifact,manifest.output),commit,nodes:receipt.mappedNodes}));
