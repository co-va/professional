import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const sourceFile = path.resolve('scripts/extract-professional.mjs');
let source = await fs.readFile(sourceFile, 'utf8');

const patches = [
  [
    "return content.slice(0,a)+replacement+content.slice(b);",
    "return content.slice(0,a)+replacement+content.slice(b+end.length);",
  ],
  [
    "await copyJs(await resolveModule(key, spec));",
    "const dependency = await resolveModule(key, spec);\n    try { await copyJs(dependency); } catch (error) { throw new Error(`${key} -> ${dependency}: ${error.message}`); }",
  ],
];

for (const [before, after] of patches) {
  if (!source.includes(before)) throw new Error(`Extractor patch target not found: ${before}`);
  source = source.replace(before, after);
}

const runtimeFile = path.join(os.tmpdir(), `extract-professional-${process.pid}.mjs`);
await fs.writeFile(runtimeFile, source, 'utf8');

const result = spawnSync(process.execPath, [runtimeFile], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit',
});

await fs.rm(runtimeFile, { force: true });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
