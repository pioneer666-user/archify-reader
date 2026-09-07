import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillDir = join(repoRoot, 'skill', 'archify-reader');

const identicalPairs = [
  ['LICENSE', 'LICENSE'],
  ['ARCHIFY-LICENSE.txt', 'ARCHIFY-LICENSE.txt'],
];
const mustExist = [
  join(repoRoot, 'THIRD-PARTY-NOTICES.md'),
  join(skillDir, 'THIRD-PARTY-NOTICES.md'),
];

let failed = false;

for (const [rootFile, skillFile] of identicalPairs) {
  const rootPath = join(repoRoot, rootFile);
  const skillPath = join(skillDir, skillFile);
  if (!existsSync(rootPath) || !existsSync(skillPath)) {
    console.error(`MISSING: ${existsSync(rootPath) ? skillPath : rootPath}`);
    failed = true;
    continue;
  }
  if (readFileSync(rootPath).equals(readFileSync(skillPath))) {
    console.log(`OK (identical): ${rootFile}`);
  } else {
    console.error(`DIFF: ${rootFile} 与 skill 包内副本不一致`);
    failed = true;
  }
}

for (const path of mustExist) {
  if (existsSync(path)) {
    console.log(`OK (present): ${path}`);
  } else {
    console.error(`MISSING: ${path}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
