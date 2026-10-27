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
