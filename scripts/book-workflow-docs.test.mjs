import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeTitle, replacesSameBook } from '../src/lib/book-title.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const upload = readFileSync(join(ROOT, 'docs/BOOK_UPLOAD.md'), 'utf8');
const patrol = readFileSync(join(ROOT, 'docs/GLOSSARY_PATROL.md'), 'utf8');
const blocks = [...upload.matchAll(/```js\r?\n([\s\S]*?)\r?\n```/g)].map((m) => m[1]);
const helper = blocks.find((s) => s.includes('// Staging helper:'));
const documented = await import(`data:text/javascript,${encodeURIComponent(helper)}`);

test('staging norm equals normalizeTitle: edition tails, two passes, real subtitles', () => {
  const labels = ['A Novel', 'A Memoir', 'A Biography', 'A True Story', 'An Autobiography', 'A Novella', 'A Graphic Novel'];
  const tails = labels.flatMap((s) => [`: ${s}`, `\uFF1A${s}`, ` - ${s}`, ` – ${s}`, ` — ${s}`, `(${s})`]);
  const titles = ['', ' ', 'Title!', 'Title: Catching Fire', 'Title-A Novel', ': A Novel'];
  for (const tail of tails) {
    titles.push(` Title${tail} `, `Title: Catching Fire${tail}`);
    for (const second of tails) titles.push(`Title${tail}${second}`, `Title${tail}${second}: A Novel`);
  }
  for (const value of titles) assert.equal(documented.norm(value), normalizeTitle(value), value);
  assert.equal(documented.norm('Title: A Novel (A Memoir)'), 'title');
  assert.notEqual(documented.norm('Title: Catching Fire'), documented.norm('Title'));
  assert.notEqual(documented.norm('Title-A Novel'), documented.norm('Title'));
  for (const incoming of [undefined, null, '', '  ', 'Title: A Novel', 'Another Book'])
    assert.equal(documented.replacesSameBook('Title', incoming), replacesSameBook('Title', incoming));
});

function staging(run) {
  const dir = mkdtempSync(join(tmpdir(), 'book-workflow-docs-'));
  try {
    writeFileSync(join(dir, 'book-identity.mjs'), helper);
    return run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
function execute(dir, filename, source, args = []) {
  writeFileSync(join(dir, filename), source);
  return spawnSync(process.execPath, [join(dir, filename), ...args], { cwd: dir, encoding: 'utf8' });
}

test('find-book prints every collision across both catalogs', () => staging((dir) => {
  writeFileSync(join(dir, 'word-lists-catalog.json'), JSON.stringify({ lists: [
    { id: 'one', title: 'Title' }, { id: 'two', title: 'Title: A Novel' },
  ] }));
  writeFileSync(join(dir, 'public-catalog.json'), JSON.stringify({ packs: [{ id: 'three', title: 'Title' }] }));
  const result = execute(dir, 'find-book.mjs', blocks.find((s) => s.includes('// Is this book already live?')), ['new-id', 'Title']);
  assert.equal(result.status, 0, result.stderr);
  for (const id of ['one', 'two', 'three']) assert.ok(result.stdout.includes(`TAKEN: ${id}`));
}));

test('row list mode rejects another title and keeps live metadata, including for legacy input', () => staging((dir) => {
  const original = {
    id: 'the-lantern-seller', title: 'The Lantern Seller', author: 'Live author', isbn: 'live-isbn',
    added: '2020', updated: '2025', unknown: { keep: true },
    glossary: { url: 'old', sha256: 'old', unknown: 'preserve' },
  };
  const other = { id: 'old_id', title: 'Other', glossary: { sha256: 'untouched' } };
  const catalog = { format: 'test', meta: { keep: 1 }, lists: [original, other] };
  writeFileSync(join(dir, 'word-lists-catalog.json'), JSON.stringify(catalog));
  const source = blocks.find((s) => s.includes('// Rewrite ONE row'))
    .replace('mode: "new"', 'mode: "list"').replace('cover: "cover.jpg"', 'cover: ""');
  const run = (file) => {
    writeFileSync(join(dir, 'glossary.json'), JSON.stringify({ glossary: { word: { meaning: 'word' } }, ...file }));
    return execute(dir, 'row.mjs', source);
  };
  assert.notEqual(run({ title: 'Another Book' }).status, 0);
  for (const title of ['The Lantern Seller: A Novel', undefined]) {
    const result = run({ title, author: 'Incoming author', isbn: 'incoming-isbn' });
    assert.equal(result.status, 0, result.stderr);
    const next = JSON.parse(readFileSync(join(dir, 'catalog.next.json'), 'utf8'));
    assert.deepEqual(next.meta, catalog.meta);
    assert.deepEqual(next.lists[1], other);
    for (const key of ['title', 'author', 'isbn', 'added', 'unknown'])
      assert.deepEqual(next.lists[0][key], original[key]);
    assert.equal(next.lists[0].glossary.unknown, 'preserve');
  }
}));

const tapSelect = patrol.match(/SELECT book_id,[\s\S]*?FROM book_word_taps[\s\S]*?;/)?.[0];
const tapUpdate = patrol.match(/UPDATE book_word_taps[\s\S]*?;/)?.[0];

test('documented tap SQL resolves only the verified primary key and catalog snapshot', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of readdirSync(join(ROOT, 'migrations')).filter((s) => s.endsWith('.sql')).sort())
      db.exec(readFileSync(join(ROOT, 'migrations', name), 'utf8'));
    const insert = db.prepare(`INSERT INTO book_word_taps
      (book_id, word, chapter, occurrence, catalog_id, book_title, glossary_rev, last_tapped_at)
      VALUES (?, 'word', ?, ?, ?, 'Same Title', 'oldrev', 100)`);
    for (const row of [
      ['device-a', 1, 1, 'word-lists:a'], ['device-b', 1, 1, 'public-books:b'],
      ['device-a', 2, 1, 'word-lists:a'], ['device-a', 1, 2, 'word-lists:a'], ['legacy', 1, 1, ''],
    ]) insert.run(...row);
    const selected = db.prepare(tapSelect).all();
    assert.equal(selected.length, 5);
    const resolve = db.prepare(tapUpdate.replace(/\?[1-9]/g, '?'));
    const apply = (r) => resolve.run(200, 'newrev', r.book_id, r.word, r.chapter, r.occurrence,
      r.catalog_id, r.glossary_rev, r.last_tapped_at).changes;
    const snapshot = selected.find((r) => r.book_id === 'device-a' && r.chapter === 1 && r.occurrence === 1);
    for (const [column, value] of [['catalog_id', 'word-lists:changed'], ['glossary_rev', 'changed'], ['last_tapped_at', 101]]) {
      db.prepare(`UPDATE book_word_taps SET ${column} = ? WHERE book_id = ? AND chapter = 1 AND occurrence = 1`)
        .run(value, snapshot.book_id);
      assert.equal(apply(snapshot), 0, `${column} snapshot must guard new reports`);
      db.prepare(`UPDATE book_word_taps SET ${column} = ? WHERE book_id = ? AND chapter = 1 AND occurrence = 1`)
        .run(snapshot[column], snapshot.book_id);
    }
    assert.equal(apply(snapshot), 1);
    assert.equal(apply(snapshot), 0);
    const legacy = selected.find((r) => r.book_id === 'legacy');
    assert.equal(apply({ ...legacy, catalog_id: 'word-lists:a' }), 0, 'keep original empty ref');
    assert.equal(apply(legacy), 1);
    const pending = db.prepare(tapSelect).all();
    assert.equal(pending.length, 3);
    assert.ok(pending.some((r) => r.catalog_id === 'public-books:b'));
    assert.ok(pending.some((r) => r.chapter === 2));
    assert.ok(pending.some((r) => r.occurrence === 2));
  } finally { db.close(); }
});

test('find-book stops with actionable ids for missing legacy catalog titles', () => staging((dir) => {
  writeFileSync(join(dir, 'public-catalog.json'), JSON.stringify({ packs: [] }));
  for (const title of [undefined, null, '', 123]) {
    writeFileSync(join(dir, 'word-lists-catalog.json'), JSON.stringify({ lists: [{ id: 'legacy_id', title }] }));
    const result = execute(dir, 'find-book.mjs', blocks.find((s) => s.includes('// Is this book already live?')), ['new-id', 'Title']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /verify missing titles for ids legacy_id before publication/);
    assert.doesNotMatch(result.stderr, /TypeError/);
    assert.doesNotMatch(result.stdout, /free/);
  }
}));

const comparison = blocks.find((s) => s.includes('// Full structural comparison;'));
function compareFiles(live, candidate) {
  return staging((dir) => {
    writeFileSync(join(dir, 'live.json'), JSON.stringify(live));
    writeFileSync(join(dir, 'candidate.json'), JSON.stringify(candidate));
    const result = execute(dir, 'compare.mjs', comparison, ['live.json', 'candidate.json']);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
}

test('documented comparison reports deleted phrases, sentences and paragraphs with full values', () => {
  const live = {
    glossary: { word: { meaning: 'A thing.' } },
    phrases: { 'look up': { meaning: 'Look for a fact.', credit: 'reader000001' } },
    sentences: [{ context: 'Some words.', simple: 'The plain meaning.', credit: 'reader000002' }],
    paragraphs: [{ context: 'The start.', mainIdea: 'A walk.', simple: 'They walk.', credit: 'reader000003' }],
  };
  const next = { glossary: live.glossary, phrases: {}, sentences: [], paragraphs: [] };
  const report = compareFiles(live, next);
  for (const [path, before] of [
    ['/phrases/look up', live.phrases['look up']],
    ['/sentences/0', live.sentences[0]], ['/paragraphs/0', live.paragraphs[0]],
  ]) assert.deepEqual(report.changes.find((c) => c.path === path), { op: 'deleted', path, before });
  assert.deepEqual(report.creditChanges.map((c) => c.path).sort(), [
    '/paragraphs/0/credit', '/phrases/look up/credit', '/sentences/0/credit',
  ]);
  const removedSections = compareFiles(live, { glossary: live.glossary });
  for (const section of ['phrases', 'sentences', 'paragraphs'])
    assert.deepEqual(removedSections.changes.find((c) => c.path === `/${section}`),
      { op: 'deleted', path: `/${section}`, before: live[section] });
  assert.equal(removedSections.creditChanges.length, 3);
});

test('documented comparison tracks each credit location, not a global set of public ids', () => {
  const id = 'reader000001';
  const live = {
    glossary: {
      kept: { meaning: 'Kept.', credit: id },
      lost: { meaning: 'Lost.', credit: id },
      senses: { senses: [{ meaning: 'First.', credit: id }, { meaning: 'Second.', credit: id }] },
    },
    phrases: { phrase: { meaning: 'Together.', credit: id } },
    sentences: [{ context: 'Text.', simple: 'Plain.', credit: id }],
    paragraphs: [{ context: 'Start.', mainIdea: 'Main.', simple: 'Plain.', credit: id }],
    future: { nested: [{ credit: id }] },
  };
  const next = structuredClone(live);
  delete next.glossary.lost.credit;
  delete next.glossary.senses.senses[0].credit;
  next.glossary.senses.senses[1].credit = 'reader000002';
  delete next.phrases.phrase.credit;
  delete next.sentences[0].credit;
  delete next.paragraphs[0].credit;
  delete next.future.nested[0].credit;
  const report = compareFiles(live, next);
  const deleted = report.creditChanges.filter((c) => c.op === 'deleted');
  assert.deepEqual(deleted.map((c) => c.path).sort(), [
    '/glossary/lost/credit', '/glossary/senses/senses/0/credit', '/phrases/phrase/credit',
    '/sentences/0/credit', '/paragraphs/0/credit', '/future/nested/0/credit',
  ].sort());
  assert.ok(deleted.every((c) => c.before === id));
  assert.deepEqual(report.creditChanges.find((c) => c.op === 'changed'), {
    op: 'changed', path: '/glossary/senses/senses/1/credit', before: id, after: 'reader000002',
  });
  assert.ok(!report.creditChanges.some((c) => c.path === '/glossary/kept/credit'));
  const moved = compareFiles({ sentences: live.sentences, paragraphs: [] }, { sentences: [], paragraphs: live.sentences });
  assert.deepEqual(moved.creditChanges, [
    { op: 'deleted', path: '/sentences/0/credit', before: id },
    { op: 'added', path: '/paragraphs/0/credit', after: id },
  ]);
});

test('documented comparison covers unknown fields, escaped paths, additions and array/type changes without truncation', () => {
  const live = {
    glossary: Object.fromEntries(Array.from({ length: 125 }, (_, i) => [`word${i}`, { meaning: `Old ${i}` }])),
    future: { 'a/b~c': { unknown: 1, removed: { keepFull: ['a', 'b'] } }, shape: { nested: true } },
    phrases: { phrase: { anchors: [{ chapter: 1, context: 'Old context.' }] } },
    sentences: [{ context: 'Old.', simple: 'Old.' }], paragraphs: [{ simple: 'Old.' }],
  };
  const next = structuredClone(live);
  for (let i = 0; i < 125; i++) next.glossary[`word${i}`].meaning = `New ${i}`;
  next.glossary.added = { meaning: 'New.', unknown: ['full', { deep: true }] };
  next.future['a/b~c'].unknown = 2;
  delete next.future['a/b~c'].removed;
  next.future.shape = null;
  next.future.newField = { arbitrary: [1, 2, 3] };
  next.phrases.phrase.anchors[0].context = 'New context.';
  next.sentences[0].simple = 'New.';
  next.paragraphs.push({ simple: 'Added.' });
  const report = compareFiles(live, next);
  for (let i = 0; i < 125; i++) assert.deepEqual(report.changes.find((c) => c.path === `/glossary/word${i}/meaning`),
    { op: 'changed', path: `/glossary/word${i}/meaning`, before: `Old ${i}`, after: `New ${i}` });
  for (const expected of [
    { op: 'added', path: '/glossary/added', after: next.glossary.added },
    { op: 'changed', path: '/future/a~1b~0c/unknown', before: 1, after: 2 },
    { op: 'deleted', path: '/future/a~1b~0c/removed', before: live.future['a/b~c'].removed },
    { op: 'changed', path: '/future/shape', before: live.future.shape, after: null },
    { op: 'added', path: '/future/newField', after: next.future.newField },
    { op: 'changed', path: '/phrases/phrase/anchors/0/context', before: 'Old context.', after: 'New context.' },
    { op: 'changed', path: '/sentences/0/simple', before: 'Old.', after: 'New.' },
    { op: 'added', path: '/paragraphs/1', after: next.paragraphs[1] },
  ]) assert.deepEqual(report.changes.find((c) => c.path === expected.path), expected);
  assert.equal(report.changes.length, 133);
  assert.deepEqual(compareFiles(live, structuredClone(live)), { changes: [], creditChanges: [] });
});

const passageDiscovery = patrol.match(/SELECT p\.id,[\s\S]*?WHERE p\.status != 'resolved'[\s\S]*?;/)?.[0];
const passageCutoff = patrol.match(/SELECT MAX\(id\) AS cutoff_id FROM passage_feedback WHERE topic = \?1;/)?.[0];
const passagePage = patrol.match(/SELECT p\.id,[^;]*?WHERE p\.topic = \?1[^;]*?;/)?.[0];
const passageUpdate = patrol.match(/UPDATE passage_feedback SET status = 'resolved'[\s\S]*?;/)?.[0];
const positional = (sql) => sql.replace(/\?\d+/g, '?');

test('documented passage pagination reviews a topic larger than 300 without resolving post-cutoff or unrelated reports', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of readdirSync(join(ROOT, 'migrations')).filter((s) => s.endsWith('.sql')).sort())
      db.exec(readFileSync(join(ROOT, 'migrations', name), 'utf8'));
    const insert = db.prepare(`INSERT INTO passage_feedback
      (book_id, catalog_id, book_title, chapter, paragraph, selected, reason, topic, status, created_at)
      VALUES ('device-a', ?, 'Title', 1, 1, 'Some words.', 'hard', ?, ?, ?)`);
    const topic = 11, otherTopic = 22;
    const targetIds = [];
    for (let i = 0; i < 705; i++) {
      const row = insert.run(i === 350 ? 'public-books:other' : 'word-lists:target', topic,
        i === 200 ? 'resolved' : 'pending', i);
      targetIds.push(Number(row.lastInsertRowid));
      if (i % 100 === 0) insert.run('word-lists:unrelated', otherTopic, 'pending', i);
    }
    const discovery = db.prepare(passageDiscovery).all();
    assert.equal(discovery.length, 300);
    assert.ok(discovery.every((r) => r.topic === topic));
    const cutoff = db.prepare(positional(passageCutoff)).get(topic).cutoff_id;
    assert.equal(cutoff, targetIds.at(-1));
    const page = db.prepare(positional(passagePage));
    const reviewed = [];
    let last = 0, lateId;
    const sizes = [];
    while (true) {
      const rows = page.all(topic, last, cutoff);
      sizes.push(rows.length);
      if (!rows.length) break;
      reviewed.push(...rows);
      last = rows.at(-1).id;
      if (!lateId) lateId = Number(insert.run('word-lists:target', topic, 'pending', 9999).lastInsertRowid);
    }
    assert.deepEqual(sizes, [300, 300, 105, 0]);
    assert.deepEqual(reviewed.map((r) => r.id), targetIds);
    assert.ok(reviewed.some((r) => r.status === 'resolved'), 'resolved context must not be lost');
    assert.ok(reviewed.some((r) => r.catalog_id === 'public-books:other'), 'topic is not catalog identity');
    const resolve = db.prepare(positional(passageUpdate));
    const apply = (id, savedTopic = topic, savedCutoff = cutoff) => resolve.run(10000, 'verifiedrev', id, savedTopic, savedCutoff).changes;
    assert.equal(apply(lateId), 0, 'cutoff protects a newly appended report, even if accidentally supplied');
    const unrelated = db.prepare('SELECT id FROM passage_feedback WHERE topic = ? LIMIT 1').get(otherTopic);
    assert.equal(apply(unrelated.id), 0, 'topic guard protects an unrelated reviewed id');
    const answered = reviewed.filter((r) => r.status !== 'resolved' && r.catalog_id === 'word-lists:target');
    for (const row of answered) assert.equal(apply(row.id), 1);
    assert.equal(apply(answered[0].id), 0);
    const pending = db.prepare("SELECT id, topic, catalog_id FROM passage_feedback WHERE status != 'resolved'").all();
    assert.equal(pending.filter((r) => r.topic === otherTopic).length, 8);
    assert.deepEqual(pending.filter((r) => r.topic === topic).map((r) => r.id).sort((a, b) => a - b),
      [targetIds[350], lateId]);
    assert.equal(db.prepare('SELECT resolved_rev FROM passage_feedback WHERE id = ?').get(answered[0].id).resolved_rev, 'verifiedrev');
  } finally { db.close(); }
});

test('playbooks distinguish source provenance, feedback lifecycles and the CPU-gated public EPUB contract', () => {
  const maintenance = readFileSync(join(ROOT, 'docs/MAINTENANCE.md'), 'utf8');
  for (const doc of [upload, patrol, maintenance]) {
    assert.match(doc, /original.bytes?/);
    assert.match(doc, /unverified/);
    assert.match(doc, /dirty state/);
    assert.match(doc, /ZIP/);
  }
  assert.match(patrol, /Passage inserts are always\s+`pending`, not `reopened`/);
  assert.match(patrol, /does \*\*not\*\* separate `catalog_id`/);
  assert.match(patrol, /Missing-word taps do not currently reopen automatically/);
  assert.doesNotMatch(passageUpdate, /WHERE topic\s*=/);
  assert.match(passageUpdate, /WHERE id = \?3 AND topic = \?4 AND id <= \?5/);
  const publicEpub = upload.slice(upload.indexOf('**Public-domain book: the implemented API'));
  assert.match(publicEpub, /PUBLIC_BOOK_PUBLISH_CPU_CONFIRMED=true/);
  assert.match(publicEpub, /identical-byte retry/);
  assert.ok(publicEpub.includes("sha256(epubSHA"));
  assert.match(publicEpub, /does not first publish to the private word-list catalog/);
  assert.match(publicEpub, /before any write/);
  assert.doesNotMatch(upload, /edit that one field by hand after the script, or use the\s+admin \*\*Books\*\* tab/);
});

function compareRawFiles(live, candidate) {
  return staging((dir) => {
    writeFileSync(join(dir, 'live.json'), live);
    writeFileSync(join(dir, 'candidate.json'), candidate);
    return execute(dir, 'compare.mjs', comparison, ['live.json', 'candidate.json']);
  });
}

test('documented comparison rejects lossy raw numeric tokens in either file before JSON.parse', () => {
  const unsafe = [
    '9007199254740993', '9007199254740992', '-9007199254740993', '-9007199254740992',
    '1e400', '-1e400', '1.5', '1.0', '-0.5', '1e0', '1E+2', '1e-2', '-0',
  ];
  const safe = '{"future":{"value":9007199254740991}}';
  for (const token of unsafe) {
    const raw = `{"future":{"value":${token}}}`;
    for (const [before, after] of [[raw, safe], [safe, raw]]) {
      const result = compareRawFiles(before, after);
      assert.notEqual(result.status, 0, token);
      assert.match(result.stderr, /unsupported numeric token.*lossless comparison and manual review/, token);
      assert.equal(result.stdout, '', 'a rejected comparison must not emit an apparent no-diff report');
    }
  }
  for (const [a, b] of [
    ['9007199254740993', '9007199254740992'], ['1e400', '2e400'],
    ['-9007199254740993', '-9007199254740992'],
  ]) {
    const result = compareRawFiles(`{"unknown":${a}}`, `{"unknown":${b}}`);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /lossless comparison/);
    assert.equal(result.stdout, '');
  }
});

test('documented raw number guard allows safe integers and numeric-looking strings with escapes', () => {
  const live = {
    bounds: [-9007199254740991, 0, 9007199254740991],
    '9007199254740993': '9007199254740993 -9007199254740993 1e400 1.5 -0',
    escaped: 'A quote " then 1e400, backslash \\ then 9007199254740993.',
    literalEscape: '\\"1e400',
  };
  const identical = compareRawFiles(JSON.stringify(live), JSON.stringify(live));
  assert.equal(identical.status, 0, identical.stderr);
  assert.deepEqual(JSON.parse(identical.stdout), { changes: [], creditChanges: [] });
  const changed = compareRawFiles('{"n":9007199254740991,"s":"1e400"}', '{"n":-9007199254740991,"s":"2e400"}');
  assert.equal(changed.status, 0, changed.stderr);
  assert.deepEqual(JSON.parse(changed.stdout).changes, [
    { op: 'changed', path: '/n', before: 9007199254740991, after: -9007199254740991 },
    { op: 'changed', path: '/s', before: '1e400', after: '2e400' },
  ]);
  const unicodeString = compareRawFiles('{"s":"\u0031e400"}', '{"s":"1e400"}');
  assert.equal(unicodeString.status, 0, unicodeString.stderr);
  assert.deepEqual(JSON.parse(unicodeString.stdout), { changes: [], creditChanges: [] });
});

test('series contract stops legacy abbreviation conflicts instead of parallel series or silent migration', () => {
  const series = upload.slice(upload.indexOf('### 8.2 Put a book into a series'), upload.indexOf('### 8.3'));
  assert.match(series, /Legacy series-name conflict: stop and report/);
  assert.match(series, /existing series uses an old invented\s+abbreviation such as `MTH`/);
  assert.match(series, /separate reviewed\s+series\/rails migration/);
  assert.match(series, /every affected existing row and saved Discover rail/);
  assert.match(series, /Do not create\s+a parallel `Magic Tree House` series/);
  assert.match(series, /do not silently rename old rows during an ordinary upload/);
  assert.match(series, /Resume the new upload only after the reviewed\s+series-name migration is complete and verified/);
  assert.match(series, /official abbreviations such as `TED` are not this\s+conflict/);
});

test('distinct-topic discovery progresses past a deferred topic with more than 300 reports and resumes a bounded cursor', () => {
  const sql = patrol.match(/SELECT DISTINCT topic FROM passage_feedback[^;]*;/)?.[0];
  assert.ok(sql, 'execute the documented discovery SQL');
  assert.match(patrol, /3 topic-discovery pages per run/);
  assert.match(patrol, /last considered topic/);
  assert.match(patrol, /even if that topic\s+was deferred/);
  assert.match(patrol, /save cursor 0 for the \*\*next run\*\*/);
  const db = new DatabaseSync(':memory:');
  try {
    for (const name of readdirSync(join(ROOT, 'migrations')).filter((s) => s.endsWith('.sql')).sort())
      db.exec(readFileSync(join(ROOT, 'migrations', name), 'utf8'));
    const insert = db.prepare(`INSERT INTO passage_feedback
      (book_id, selected, reason, topic, status, created_at)
      VALUES ('device-a', 'Text.', 'hard', ?, ?, 1)`);
    for (let i = 0; i < 705; i++) insert.run(1, 'pending');
    for (let topic = 2; topic <= 66; topic++) insert.run(topic, 'pending');
    insert.run(99, 'resolved');
    const sampled = db.prepare(passageDiscovery).all();
    assert.equal(sampled.length, 300);
    assert.ok(sampled.every((r) => r.topic === 1), 'row-level triage alone starves later topics');
    const page = db.prepare(positional(sql));
    let cursor = 0;
    const considered = [], deferred = [];
    for (let budget = 0; budget < 3; budget++) {
      const rows = page.all(cursor);
      assert.equal(rows.length, 20);
      for (const row of rows) {
        considered.push(row.topic);
        deferred.push(row.topic); // All remain open; cursor progress is independent of resolution.
        cursor = row.topic;
      }
    }
    assert.equal(cursor, 60);
    assert.deepEqual(considered, Array.from({ length: 60 }, (_, i) => i + 1));
    assert.ok(deferred.includes(1) && considered.includes(2));
    const nextRun = page.all(cursor);
    assert.deepEqual(nextRun.map((r) => r.topic), [61, 62, 63, 64, 65, 66]);
    const partialCursor = nextRun[1].topic; // Stop after two topics, not the page's final topic.
    assert.deepEqual(page.all(partialCursor).map((r) => r.topic), [63, 64, 65, 66]);
    cursor = nextRun.at(-1).topic;
    assert.deepEqual(page.all(cursor), []);
    assert.ok(page.all(0).some((r) => r.topic === 1), 'next sweep revisits deferred topics');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM passage_feedback WHERE topic = 1 AND status = 'pending'").get().n, 705);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM passage_feedback WHERE topic > 1 AND status = 'pending'").get().n, 65);
  } finally { db.close(); }
});
