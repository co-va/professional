import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { replaceAssignmentTag, tagAssignments } from '../../settings/tags/assignments.js';

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
assert.deepEqual(replaceAssignmentTag(['a', 'a', 'other'], tag, ''), ['other']);
assert.deepEqual(replaceAssignmentTag(['a', 'other'], tag, 'b'), ['other', 'b']);
assert.deepEqual(replaceAssignmentTag(['a', 'b'], tag, 'b'), ['b']);
assert.deepEqual(replaceAssignmentTag([{ tagId: 'a' }, 'other'], tag, 'new'), ['other', 'new']);
assert.throws(() => replaceAssignmentTag(['other'], tag, ''), /уже снят/);
assert.equal(found.find(item => item.key === 'people:p1')?.source, 'people');
assert.equal(found.find(item => item.key === 'products:product-1')?.id, 'product-1');
const page = readFileSync('settings/tags/tags.js', 'utf8');
const style = readFileSync('ui/tags/tags.css', 'utf8');
assert.doesNotMatch(page, /miniCard|miniCardRail/);
assert.match(page, /v2ListEntries\(tags\.map\(/);
assert.match(page, /rightTop: String\(count\)/);
assert.match(page, /leadingSwatch:/);
assert.match(page, /variant: 'q'/);
assert.match(page, /data-tag-assignment/);
assert.match(page, /xRole: 'action'/);
assert.match(page, /commitPersonTags\(/);
assert.match(page, /commitProduct\(/);
assert.match(page, /commitProcedure\(/);
assert.match(page, /button\('Удалить ярлык', \{ variant: 'danger'/);
assert.match(page, /button\('Перенести', \{ variant: 'secondary'/);
assert.match(page, /button\('\+ Создать ярлык', \{ data: 'data-tag-create' \}\)/);
const transfer = page.slice(page.indexOf('const showTransfer = () => {'), page.indexOf('const showActions = () => {'));
assert.match(transfer, /class="settings-tags-v2"/, 'The transfer list uses the existing rectangular swatch');
assert.doesNotMatch(transfer, /button\('Отмена'/);
assert.doesNotMatch(transfer, /data-tag-action-back/);
assert.doesNotMatch(page, /<p>\$\{escapeHtml\(assignment\.kind\)\}<\/p>/);
assert.doesNotMatch(page, /subtitle: item\.kind/);
const actions = page.slice(page.indexOf('const showActions = () => {'), page.indexOf('  showActions();'));
assert.doesNotMatch(actions, /v2ListEntr(y|ies)/, 'Action buttons must not become list entries');
assert.doesNotMatch(actions, /data-tag-create/, 'Create action only belongs inside transfer');
assert.match(page, /loadBusinessState\(\)/);
assert.match(page, /loadOperationalState\(\{ full: true \}\)/);
assert.match(style, /\.settings-tags-v2 \.list-entry__swatch\{[^}]*border-radius:0/);
console.log('Settings Tags V2 list / count / Q: PASS');
