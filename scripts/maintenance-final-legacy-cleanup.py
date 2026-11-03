from pathlib import Path
import re

ROOT = Path('.')
SELF = Path('scripts/maintenance-final-legacy-cleanup.py')


def js_usage_files(token):
    found = set()
    for path in ROOT.rglob('*.js'):
        if '.git' in path.parts or '.github' in path.parts:
            continue
        if token in path.read_text():
            found.add(path.as_posix())
    return found


expected = {
    'availableBookText': {'settings/documents/data.js'},
    'availableBaseVersion': {'settings/documents/data.js'},
    'isOwnerBook': {'core/access.js'},
    'X-Book-Document-Id': {'core/runtime/tenant-document-archive.js'},
    'downloadRknGuide': {'core/runtime/tenant-document-archive.js'},
}
for token, files in expected.items():
    actual = js_usage_files(token)
    assert actual == files, f'{token}: expected {files}, got {actual}'

# Access: capability map is authoritative. Remove the retired owner fallback entirely.
path = Path('core/access.js')
text = path.read_text()
assert '  isOwnerBook: false,\n' in text
text = text.replace('  isOwnerBook: false,\n', '')
old = '  if (!capability) return currentAccess.isOwnerBook === true;'
assert old in text
text = text.replace(old, '  if (!capability) return false;')
path.write_text(text)

# Documents: only PLATFORM/CUSTOM remain. Dead shadow fields are removed, not renamed.
path = Path('settings/documents/data.js')
text = path.read_text()
old = "    sourceMode: sourceMode === 'BOOK' ? 'BOOK' : sourceMode === 'CUSTOM' ? 'CUSTOM' : '',"
assert old in text
text = text.replace(old, "    sourceMode: sourceMode === 'PLATFORM' ? 'PLATFORM' : sourceMode === 'CUSTOM' ? 'CUSTOM' : '',")
text = text.replace('    availableBaseVersion: Math.max(0, Number(item.availableBaseVersion || 0)),\n', '')
text = text.replace("    availableBookText: String(item.availableBookText || ''),\n", '')
text = text.replace("    sourceMode: 'BOOK',", "    sourceMode: 'PLATFORM',")
text = text.replace("        sourceMode: exactRegistryDocument ? 'BOOK' : 'CUSTOM',", "        sourceMode: exactRegistryDocument ? 'PLATFORM' : 'CUSTOM',")
text = text.replace('        availableBaseVersion: exactRegistryDocument ? 0 : base.version,\n', '')
text = text.replace("        availableBookText: exactRegistryDocument ? '' : rendered,\n", '')
text = text.replace("    if (active.sourceMode === 'BOOK') {", "    if (active.sourceMode === 'PLATFORM') {")
text = text.replace('          availableBaseVersion: 0,\n', '')
text = text.replace("          availableBookText: '',\n", '')
old_tail = """    const nextAvailable = active.text === rendered && active.title === base.title ? 0 : base.version;
    const nextText = nextAvailable ? rendered : '';
    if (active.baseKey !== base.key
      || active.availableBaseVersion !== nextAvailable
      || active.availableBookText !== nextText) {
      current[index] = normalize({
        ...active,
        baseKey: base.key,
        availableBaseVersion: nextAvailable,
        availableBookText: nextText,
      });
      changed = true;
    }
"""
assert old_tail in text
text = text.replace(old_tail, """    if (active.baseKey !== base.key) {
      current[index] = normalize({ ...active, baseKey: base.key });
      changed = true;
    }
""")
text = text.replace("previous.sourceMode === 'BOOK'", "previous.sourceMode === 'PLATFORM'")
text = text.replace("next.sourceMode === 'BOOK'", "next.sourceMode === 'PLATFORM'")
old_changed = """      String(item?.documentClass || '') !== String(current[index]?.documentClass || '')
      || Object.prototype.hasOwnProperty.call(item || {}, 'recordType')
"""
assert old_changed in text
text = text.replace(old_changed, """      String(item?.documentClass || '') !== String(current[index]?.documentClass || '')
      || String(item?.sourceMode || '') !== String(current[index]?.sourceMode || '')
      || Object.keys(item || {}).some((key) => !Object.prototype.hasOwnProperty.call(current[index] || {}, key))
""")
path.write_text(text)

path = Path('settings/documents/documents.js')
text = path.read_text()
old = "sourceMode: current?.sourceMode === 'CUSTOM' ? 'CUSTOM' : 'BOOK',"
assert old in text
path.write_text(text.replace(old, "sourceMode: current?.sourceMode === 'CUSTOM' ? 'CUSTOM' : 'PLATFORM',"))

# The RKN download export has no caller. Delete it instead of inventing another header contract.
path = Path('core/runtime/tenant-document-archive.js')
lines = path.read_text().splitlines(keepends=True)
matches = [i for i, line in enumerate(lines) if line.startswith('export async function downloadRknGuide(')]
assert len(matches) == 1, matches
del lines[matches[0]]
path.write_text(''.join(lines))

# Remove retired literal guards; permanent guards are installed only after runtime proof.
path = Path('scripts/audit-professional-clean.mjs')
text = path.read_text()
text = text.replace("  ['book.auth.token', 'Legacy auth token key returned'],\n", '')
text = text.replace("  ['book:v2-context-changed', 'Legacy Shared V2 context event returned'],\n", '')
path.write_text(text)

# Project map: cleanup is complete only when the current tree is clean; CI remains absent.
path = Path('PROJECT_STATE.md')
state = path.read_text()
state = state.replace(
    '- Shared внутренние события в Professional не получают `User`/`Book`-маркер; для общего UI используется нейтральный namespace.',
    '- Shared внутренние события в Professional не получают маркер конкретного приложения; для общего UI используется нейтральный namespace.',
)
state = state.replace(
    '- Legacy runtime migration `book.auth.token` удалён; используется один технический ключ `va-tools.auth.token`.',
    '- Retired auth-token migration удалена; используется один технический ключ `va-tools.auth.token`.',
)
start = state.index('### Этап 8 —')
end = state.index('### Этап 9 —')
stage8 = """### Этап 8 — dead code / duplicate / retired cleanup — DONE

- Dead runtime, exact runtime duplicates, User/Admin/Landing contours и legacy/compat/bridge paths отсутствуют по фактической карте.
- Внутренние Professional events используют `professional:*`; Shared V2 events используют нейтральный `va-tools:*`.
- Retired product-name namespace, browser keys, access fallback, document source marker и неиспользуемые shadow-поля удалены, а не сохранены через alias/migration/bridge.
- Мёртвый экспорт загрузки RKN PDF удалён целиком; новый дублёр ему не создавался.
- Document source имеет только актуальные значения `PLATFORM` / `CUSTOM`; неизвестные persisted-поля отбрасываются нормализацией и не становятся вторым контрактом.
- Изменения сделаны вместо старой реализации. Параллельных owners и compatibility aliases не добавлено.
- Постоянный CI отсутствует. Следующий этап — техническая проверка очищенного Professional без постоянного CI.

"""
state = state[:start] + stage8 + state[end:]
state = re.sub(
    r'4\. Отдельно нормализовать legacy server/API naming[^\n]*',
    '4. Отдельно нормализовать оставшееся legacy server/API naming в Core; Professional не создаёт compatibility alias и не меняет Core на этом этапе.',
    state,
)
path.write_text(state)

# Remove retired wording from the repository boundary document, if present.
path = Path('PROFESSIONAL_BOUNDARY.md')
text = path.read_text()
text = re.sub(r'\bBook\b', 'retired-product-name', text)
text = text.replace('book:', 'retired-event:').replace('book.', 'retired-key.')
path.write_text(text)

# Current-tree proof. Legitimate "Booking" is intentionally not matched.
patterns = [
    re.compile(r'\bBOOK\b'),
    re.compile(r'\bBook\b'),
    re.compile(r'\bbook\b'),
    re.compile(r'[a-z]Book[A-Z]'),
    re.compile(r'X-Book-'),
    re.compile(r'book:'),
    re.compile(r'book\.'),
]
text_suffixes = {'.js', '.mjs', '.css', '.html', '.json', '.webmanifest', '.md', '.yml', '.yaml'}
failures = []
for candidate in ROOT.rglob('*'):
    if not candidate.is_file() or '.git' in candidate.parts or '.github' in candidate.parts or candidate == SELF:
        continue
    if candidate.suffix.lower() not in text_suffixes:
        continue
    source = candidate.read_text(errors='ignore')
    if any(pattern.search(source) for pattern in patterns):
        failures.append(candidate.as_posix())
assert not failures, f'Retired markers remain: {failures}'
