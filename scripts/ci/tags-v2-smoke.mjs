import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tagAssignments } from '../../settings/tags/assignments.js';

const tag = { id: 'a', name: 'Краска' };
const sources = {
  people: [
    { key: 'p1', name: 'Иван', surname: 'Иванов', tags: ['a', 'a'] },
    { key: 'p2', name: 'Анна', tags: ['Краска'] },
    { key: 'p3', name: 'Николай', tags: ['other'] },
  ],
  products: [{ id: 'product-1', name: 'Шампунь', tags: ['a'] }],
  procedures: [{ id: 'service-1', name: 'Окрашивание', tags: [{ id: 'a' }] },
    { id: 'deleted', name: 'Старая услуга', tags: ['a'], deletedAt: '2026-10-01' }],
  workplaces: [],
  records: [{ id: 'record-1', date: '2026-11-12', from: '11:00', tags: ['a'] }],
};
const found = tagAssignments(tag, sources);
assert.equal(found.length, 5, 'Count entities, not duplicate ID entries');
assert.deepEqual(new Set(found.map(x => x.kind)), new Set(['Человек', 'Товар', 'Услуга', 'Запись']));
assert.equal(tagAssignments({ id: 'missing', name: 'Другой' }, sources).length, 0);
assert.equal(tagAssignments({}, sources).length, 0);
const page = readFileSync('settings/tags/tags.js', 'utf8');
const style = readFileSync('ui/tags/tags.css', 'utf8');
assert.doesNotMatch(page, /miniCard|miniCardRail/);
assert.match(page, /v2ListEntries\(tags\.map\(/);
assert.match(page, /rightTop: String\(count\)/);
assert.match(page, /leadingSwatch:/);
assert.match(page, /variant: 'q'/);
assert.match(page, /loadBusinessState\(\)/);
assert.match(page, /loadOperationalState\(\{ full: true \}\)/);
assert.match(style, /\.settings-tags-v2 \.list-entry__swatch\{[^}]*border-radius:0/);
console.log('Settings Tags V2 list / count / Q: PASS');
