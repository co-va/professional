#!/usr/bin/env node
// Preserve immutable history while correcting the known legacy criterion vocabulary.
// The pinned Core parser, scope rules and final-file-version verification are unchanged.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const [gatePath, base, head, repository] = process.argv.slice(2);
const sha = /^[0-9a-f]{40}$/;
const cutoff = '2202ec57ee273563a35491cc55295c6f0731302c';
const prefix = 'Operational-Evidence: ';
const git = args => execFileSync('git', args, {encoding:'utf8',maxBuffer:32*1024*1024});
assert.ok(gatePath && sha.test(base) && sha.test(head) && repository === 'professional', 'Exact Professional release arguments required');
const { parseEvidence, verifyEvidence } = await import(pathToFileURL(resolve(gatePath)).href);
const manifest = JSON.parse(readFileSync(new URL('./legacy-evidence-criteria.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, 1);
assert.equal(manifest.cutoff, cutoff);
assert.equal(manifest.entries.length, 54, 'Fixed historical migration batch');
git(['merge-base','--is-ancestor',cutoff,head]);
const entries = new Map();
for (const entry of manifest.entries) {
  assert.ok(sha.test(entry.sha) && !entries.has(entry.sha), 'Unique exact legacy SHA required');
  assert.ok(Array.isArray(entry.from) && Array.isArray(entry.to) && entry.from.length && entry.to.length);
  assert.equal(new Set(entry.to).size, entry.to.length);
  git(['merge-base','--is-ancestor',entry.sha,cutoff]);
  const original = git(['show','-s','--format=%B',entry.sha]);
  const records = original.split(/\r?\n/).filter(line => line.startsWith(prefix));
  assert.equal(records.length, 1, entry.sha + ': exactly one immutable legacy record required');
  assert.throws(() => parseEvidence(original), entry.sha + ': valid records must never be rewritten');
  const record = JSON.parse(records[0].slice(prefix.length));
  assert.deepEqual(record.criteria, entry.from, entry.sha + ': original criterion mismatch');
  const migrated = {...record, criteria:entry.to};
  // Do not remove an already valid criterion.
  for (const criterion of entry.from) {
    let valid = false;
    try { parseEvidence(prefix + JSON.stringify({...record,criteria:[criterion]})); valid = true; } catch {}
    if (valid) assert.ok(entry.to.includes(criterion), entry.sha + ': existing valid criterion removed');
  }
  const replacement = prefix + JSON.stringify(migrated);
  assert.equal(parseEvidence(replacement).length,1,entry.sha + ': migrated record must pass original Core parser');
  entries.set(entry.sha, {original:records[0],replacement});
}

// Exact second historical batch. Keep the pinned parser and final-version checks.
const metadataCutoff = '44c08cc944019cefaea90abaa058984eb53749bd';
const metadata = JSON.parse(readFileSync(new URL('./legacy-evidence-20261128.json', import.meta.url), 'utf8'));
assert.equal(metadata.version, 1);
assert.equal(metadata.cutoff, metadataCutoff);
assert.equal(metadata.entries.length, 58, 'Fixed historical metadata correction batch');
git(['merge-base','--is-ancestor',metadataCutoff,head]);
for (const entry of metadata.entries) {
  assert.ok(sha.test(entry.sha) && !entries.has(entry.sha), 'Unique exact historical SHA required');
  assert.ok(Array.isArray(entry.to) && entry.to.length && new Set(entry.to).size === entry.to.length);
  git(['merge-base','--is-ancestor',entry.sha,metadataCutoff]);
  const original = git(['show','-s','--format=%B',entry.sha]);
  const records = original.split(/\r?\n/).filter(line => line.startsWith(prefix));
  assert.equal(records.length, 1, entry.sha + ': exactly one historical evidence line required');
  assert.equal(records[0], entry.original, entry.sha + ': immutable evidence mismatch');
  assert.throws(() => parseEvidence(original), entry.sha + ': valid records must never be rewritten');
  const raw = records[0].slice(prefix.length);
  let record;
  try { record = JSON.parse(raw); } catch { record = null; }
  const paths = record?.files ?? git(['diff-tree','--no-commit-id','--name-only','--no-renames','-r','-z',entry.sha]).split('\0').filter(Boolean).sort();
  assert.ok(paths.length && new Set(paths).size === paths.length, 'Exact historical paths required');
  let migrated;
  if (record) {
    assert.ok(Array.isArray(record.checks) && record.checks.length);
    assert.ok(typeof record.remaining === 'string');
    for (const criterion of record.criteria || []) {
      let valid = false;
      try { parseEvidence(prefix + JSON.stringify({kind:'candidate',files:paths,criteria:[criterion],result:'Criterion validation only',remaining:'',checks:['Validate historical criterion']})); valid = true; } catch {}
      if (valid) assert.ok(entry.to.includes(criterion), entry.sha + ': valid historical criterion removed');
    }
    migrated = {...record,files:paths,criteria:entry.to,result:record.result ?? original.split(/\r?\n/)[0],checks:[...new Set(record.checks)]};
  } else {
    assert.match(raw, /syntax|checked|checks|parse|assert/i);
    migrated = {kind:'candidate',files:paths,criteria:entry.to,result:raw,remaining:'Unstructured historical statement preserved; no new tests or owner acceptance asserted.',checks:[raw]};
  }
  const replacement = prefix + JSON.stringify(migrated);
  assert.equal(parseEvidence(replacement).length, 1, entry.sha + ': corrected metadata must pass original parser');
  entries.set(entry.sha,{original:records[0],replacement});
}

const ancestor = git(['merge-base',base,head]).trim();
const files = git(['diff','--name-only','--no-renames','-z',ancestor,head]).split('\0').filter(Boolean);
const applied = [];
const commits = git(['rev-list',ancestor+'..'+head]).trim().split('\n').filter(Boolean).map(sha => {
  let message = git(['show','-s','--format=%B',sha]);
  const entry = entries.get(sha);
  if (entry) {
    assert.ok(message.includes(entry.original));
    message = message.replace(entry.original,entry.replacement);
    applied.push(sha);
  }
  return {sha,message};
});
const cache = new Map();
const versionAt = (sha,file) => {
  const key = sha+'\0'+file;
  if (!cache.has(key)) cache.set(key,git(['--literal-pathspecs','ls-tree','-z',sha,'--',file]));
  return cache.get(key);
};
const result = verifyEvidence({files,commits,versionAt,head,repository});
for (const error of result.errors) console.error(error);
console.log('Historical criterion corrections: '+applied.length+'; original commit evidence retained.');
console.log('Release evidence: '+result.covered.length+' covered; '+result.errors.length+' errors. This is not owner acceptance.');
process.exitCode = result.errors.length ? 1 : 0;
