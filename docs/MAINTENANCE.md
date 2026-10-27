# Maintenance map: code, live data, and publishing

Start here when maintaining inputread.site. This is the shared operational contract, not another
book-upload recipe. Choose a task below, read its playbook, and follow the shared publishing and
recovery checkpoints here. Configuration and source establish the intended system; they do not
prove which DNS, cache rules, migrations or version are live in Cloudflare today.

## Choose a task

| Change | Entry point | Deploy? |
| --- | --- | --- |
| Reader, layout, UI or browser behavior | `src/`; the [repository instructions](https://github.com/duwqijlk/margin-words/blob/main/AGENTS.md) | Yes |
| Authentication, permissions, quotas or admin validation | `functions/`; [Accounts](https://github.com/duwqijlk/margin-words/blob/main/docs/ACCOUNTS.md) | Yes; apply required schema changes first |
| New word-list book, an existing book's list/EPUB/cover/series/category | [Book upload](https://inputread.site/kit/book-upload.md) | No |
| A public-domain EPUB replacement | API contract is implemented; CPU-budget gate defaults closed. Stop under Book upload §7 until separately confirmed | No improvised publishing path |
| A brand-new public-domain catalog id | Not supported by the current live onboarding workflow; stop and report the gap | Do not revive a retired build pipeline |
| Bilingual book summary | [Book blurbs](https://inputread.site/kit/book-blurbs.md) | No |
| Reader reports, corrections, credit and accepted contributions | [Patrol](https://inputread.site/kit/patrol.md) | No |
| Discover's saved rows | Admin → Series; [book series vs rows](https://inputread.site/kit/book-upload.md#86-a-books-series-vs-a-discover-rail) | No |
| Accounts, roles or account troubleshooting | [Accounts](https://github.com/duwqijlk/margin-words/blob/main/docs/ACCOUNTS.md); use the supported admin controls | Data-only changes: no |
| This maintenance map or the hosted work instructions | Edit the source in `docs/`; built by `scripts/build-guide.mjs` | Yes, to update `/kit/*.md` |

A change to data **contents** does not deploy code. A change to a data **format or meaning** may
need a coordinated parser/API change and migration. Decoupled storage is not an independent schema.
Book id naming is not an id migration: keep existing ids, object paths and device/report references.
Changing identity or the reserved `custom` semantics needs a separate coordinated migration, not a
routine list upload; follow [identity and naming](https://inputread.site/kit/book-upload.md#identity-and-naming).

<a id="storage"></a>
## Storage and access boundaries

| Home | Authority and access | Source/configuration entry |
| --- | --- | --- |
| Cloudflare Pages project `margin-words` | `dist/` HTML, hashed JS/CSS, fonts and generated guide files; same-origin `/api/*` runs Pages Functions | `wrangler.toml`, `public/_routes.json`, `src/main.tsx` |
| R2 `margin-words-books`, binding `BOOKS` | Live book metadata/content and intentionally public projections; books host is `https://books.inputread.site` | `src/lib/books-base.ts`, `functions/lib/db.ts` |
| R2 `margin-words-private`, binding `PRIVATE` | Private EPUB objects; no public bucket access. Trusted/admin streaming uses `/api/book/<id>/epub` | `functions/api/book/[id]/epub.ts` |
| D1 `margin-words`, binding `DB` | Accounts, sessions, signup/verification, sync, roles, quotas, download logs, feedback/taps, sponsorships, rate limits and catalog locks | `migrations/`, `functions/`; account contracts in Accounts |
| Browser IndexedDB / localStorage | This device's installed books/lists, reading state and settings. Not a publishing source or production backup | `src/lib/book-db.ts`, stores and sync modules |
| Git | App, Functions, scripts, docs and fixtures. `packs/` and `public-books/` book content are frozen snapshots, not live sources | Repository instructions and [retired tools](#retired) |

Never rebuild or overwrite a live book from the frozen checkout. Never commit live book content or
open a book-content PR. Read live R2 before changing a list, including when using an admin upload:
whole-file replacement does not merge patrol corrections or preserve reader credits for you.

### Live-object map

All paths below are **object keys**, not local directories to upload wholesale.

| Home/key | Contents / writer |
| --- | --- |
| `BOOKS:word-lists/catalog.json`, `lists[]` | Word-list books; one row per id. `POST /api/admin/word-lists` can add a new id from glossary metadata or update an existing one. |
| `BOOKS:word-lists/<id>/glossary.json` | That book's live word list. Protected reader route `/api/glossary/<id>`; admin upload or token-only patrol can replace it. |
| `PRIVATE:<id>/book.epub`, optional `<id>/cover.jpg` | Private book files; `POST /api/admin/books?kind=private`. The optional private cover is not the public card-cover URL. |
| `BOOKS:public-books/catalog.json`, `packs[]` | Public-domain books. Current admin routes require an existing public id. |
| `BOOKS:public-books/<id>/book.epub`, `glossary.json` | Public EPUB and protected glossary; admin book/list routes update existing books. |
| `BOOKS:covers/lists-<id>.jpg`, `covers/public-<id>.jpg` | Public card covers. Exact procedure and row fields belong to Book upload. |
| `BOOKS:word-lists/<id>/blurb.json`, `public-books/<id>/blurb.json` | Bilingual summaries; `/api/admin/blurb` or the Book blurbs workflow. Not catalog fields. |
| `BOOKS:word-lists/discover-rails.json` | Editorial rows, separate from book metadata; `/api/admin/discover-rails`. |
| `BOOKS:word-lists/glossary-work.json` | Admin work markers; `/api/admin/glossary-work`, cleared best-effort after a list publish. |
| `BOOKS:word-lists/qq-groups.json` | Published group configuration; `/api/admin/qq-groups`. |
| `BOOKS:contributors.json` | Public projection derived from D1 accepted feedback and public profiles; rebuild workflow is in Patrol. Do not hand-edit it as the source of acceptance. |
| `BOOKS:avatars/<public_id>-<version>.webp` | Public profile images managed by the avatar endpoint. Immutable versioned objects; not private account records. |

D1 is the authority for private account/sync/feedback records; deliberately published contributor
profiles and avatars are the R2 exception. Do not publish email addresses, tokens or private records.

The separate worker in `workers/glossary-block/` blocks direct public-host glossary downloads.
The app uses the authenticated Pages API instead. Deploying Pages does not deploy that worker or
establish its routes, bucket policy, CORS or CDN rules; verify those separately when changing hosting.

<a id="versions"></a>
## Versions, caches, and when readers see changes

### Catalog/file contract

- Hash **exact uploaded bytes**, not a parsed/reserialized equivalent. Store the byte count and full
  lower-case SHA-256 with the file reference. A formatting-only rewrite changes the hash too.
- A word-list revision is the first 12 hex characters of `glossary.sha256`. Public books also use
  the row's top-level `rev` (the installed public Update gate) and hash-derived `glossary.rev`.
  A glossary-only change sets both to the glossary hash prefix. EPUB changes set top-level row
  `rev` to `sha256(epubSHA + "\n" + glossarySHA).slice(0, 12)`; identical-byte retries preserve
  the current revision. The reader also compares the installed EPUB SHA independently of row
  revision, so a glossary rollback cannot hide a changed EPUB. `updated` alone is not an identity.
  Books UI sends a single public multipart request, not a private-list request first. Both public
  write endpoints default to 503 `publish-budget-unconfirmed` unless the operator separately
  confirms target-runtime CPU budget and sets `PUBLIC_BOOK_PUBLISH_CPU_CONFIRMED=true`.
  Local valid large JSON tests exceed 10 ms and are not Cloudflare CPU proof; the 16 MB cap is
  not a Free-plan safety guarantee. No production setting is enabled by this code release.
  See [Book upload §7](https://inputread.site/kit/book-upload.md#7-job-c--replace-the-epub).
- `added` is the original listing time; preserve it on existing rows. `updated` records the applicable
  publication time. A metadata-only series change need not pretend a new list was published.
- When a glossary hash changes, preserve the old row's `updated` as `previousUpdated`. This is a
  **timestamp, not file history or a rollback copy**. Backups must contain the bytes.
- Catalog counts describe the final glossary: `words` follows the admin expression
  `Object.keys(file.glossary).length` for strictly validated public writes (private list publication
  retains `Number(file.count) || Object.keys(file.glossary).length`); paragraph/sentence counts are their
  array lengths and phrases are object-key counts (missing optional parts count as zero). Keep an
  explicit `count` current when adding/removing entries; do not carry a stale total into the row.
- Preserve all unrelated rows/fields and top-level metadata. Book upload owns the detailed field
  table and row-building steps; Patrol owns editorial preservation and acceptance semantics.

### Freshness is not the same for every layer

| Layer | Actual behavior and verification |
| --- | --- |
| Catalogs | Loaders request `cache: "no-cache"` when invoked, not continuous polling. Public catalog loading has a local fallback. Revisit/reload when verifying and check for a stale fallback. |
| Server catalog/category caches | Per-binding in-memory entries may be reused for about 60 seconds. Do not promise a category/allowance change is instantaneous everywhere. |
| Word lists | Production fetches go through authenticated `/api/glossary/<id>` (`no-store`). Read protected bytes with authorized R2 access when verifying hashes; public 403 is expected, not proof of successful publishing. |
| Covers | The public URL gets `?v=<first 12 of cover.sha256>` and objects use `public, max-age=31536000, immutable`. Replacing bytes without the row hash leaves the old URL cached. Verify the new URL, bytes and headers. This is HTTP caching, not a stored book-cover update pushed to all tabs. |
| Avatars | Version is in the object key. A new image uses a new key; do not rewrite immutable versions as a maintenance shortcut. |
| Blurbs | Fetched on demand, then memoized for the page lifetime, including absent blurbs. An ordinary reader may need a full page reload; an admin save invalidates that admin page's local entry. Reopening a dialog alone is not a freshness guarantee. |
| Contributors | HTTP caching is five minutes and the frontend memoizes successful loads for the page lifetime. Validate the R2 projection, then use a fresh page; do not promise all open pages update in five minutes. |
| Installed books/lists | IndexedDB copies remain. Update detection offers a reader action instead of silently replacing a list; custom lists are protected. Own-EPUB updates check edition matching. Public-book Update may download a changed EPUB; private EPUB replacement does not push it to existing devices. |
| App shell | HTML and `/sw.js` are no-cache; hashed assets are one-year immutable. The SW does not serve responses/offline pages. A new controller can trigger one reload, deferred while reading. Application deployment and R2 content refresh are separate events. |

Implementation pointers: `src/lib/packs.ts`, `word-list-catalog.ts`, `word-list-update.ts`,
`book-blurbs.ts`, `contributors.ts`, `covers.ts`; `functions/lib/catalog-rev.ts`, `book-category.ts`;
`src/main.tsx`, `scripts/sw-template.js`, `public/_headers`. Paths are relative to the
[repository root](https://github.com/duwqijlk/margin-words).

<a id="publishing"></a>
## Shared publishing checkpoints

These apply to admin uploads as well as external writers. Task-specific commands stay in the
playbook. Authentication to R2/D1 does not supply application validation or a transaction.

### Establish who may write

- Admin catalog operations cooperate through `withCatalogLock()` in
  [catalog-lock.ts](https://github.com/duwqijlk/margin-words/blob/main/functions/lib/catalog-lock.ts).
  The lock is per catalog, leased for 60 seconds, waits up to 15 seconds, and may return
  `409 catalog-busy`. There is no lease renewal or fencing; this is not an absolute global lock.
- Direct wrangler, S3 and Cloudflare API writes **bypass that lock**, validations and rollback.
  Downloading a catalog again reduces a stale-snapshot risk but is **not a lock**.
- Before a direct publish, explicitly coordinate an exclusive window with the owner/operator:
  no admin publishing, patrol run or other agent may write the affected catalog/list during it.
  Do not invent a pause API or assume a schedule is idle. If exclusivity cannot be established,
  prepare a proposed change and stop before writing. Do not add D1 writes to a token-only agent's
  allowed tasks to simulate safety.

### Prepare → publish → read back

1. **Confirm the job and target.** Resolve id/kind against live catalogs; reject a different book
   or a duplicate title. Limit the change to the authorized objects and fields.
2. **Snapshot before overwrite.** Save original catalog bytes, the affected row, affected object
   bytes, object existence, content type, cache-control and other HTTP metadata needed to restore.
   Token-only agents can read bytes and metadata through Cloudflare's R2 object API; wrangler users
   can retrieve bytes with `r2 object get` and inspect metadata through the authorized R2/S3 API
   or dashboard. Do not use a protected public glossary response as the backup. If the metadata
   needed for a safe restore cannot be retrieved, stop before overwriting.
   Use private local storage or the operator's approved backup system, never Git or a public bucket.
   Keep scripts separate from downloaded/untrusted files. A repo snapshot is not a live backup.
3. **Prepare offline.** Merge intended fixes with the live list; preserve existing words, senses,
   notes, phrases and associated credits unless an explicitly reviewed change supersedes them.
   Validate matching and format; calculate counts and hashes from the final bytes.
4. **Check the base again.** Just before publishing, re-read the affected live files and catalog.
   If either differs unexpectedly from the snapshot, stop, reconcile the new live data and repeat
   validation. Do not force an old candidate over newer work. Maintain the exclusive window.
5. **Write content, then its catalog.** Use the task's order. Each R2 PUT replaces an entire object;
   there is no append/merge or multi-object transaction. Existing readers may observe a transient
   file/hash mismatch between writes. Minimize that interval; do not leave it unverified.
6. **Read back with authorization.** Retrieve the published objects from R2 and verify exact byte
   counts/hashes, catalog target values, preservation of other rows, and relevant HTTP metadata.
   Then check public catalog/cover/summary views with freshness rules above. An HTTP 200 or expected
   protected-glossary 403 alone is not proof that file and catalog match.
7. **Complete only after verification.** Clear relevant work markers and mark reports resolved or
   accepted only when their published changes and credits were verified. Follow Patrol's D1 rules.
   Report keys, hashes, verification results and anything unfinished. Release coordination only
   after consistency is confirmed or an incident is handed back to the operator.

Do not claim admin publishing supplies all of these checkpoints automatically. Admin list uploads
replace whole files; the Books UI publishes a list and book in separate operations.

<a id="recovery"></a>
## Partial failure and recovery

**Stop further work, retain snapshots and identify what actually landed.** A timeout is an unknown
outcome, not proof a write failed. Read the affected R2 objects/catalog before retrying.

| State | Response, within the coordinated window |
| --- | --- |
| New objects exist but no new catalog row | They may be unreferenced. Verify other catalogs before calling them unused; complete the reviewed publish or leave them reported for operator cleanup. Do not delete blindly. |
| Existing glossary replaced, catalog still has old hash | Downloads/updates can fail hash checks. Either complete the intended catalog publish after validation, or restore the old glossary bytes and metadata from the snapshot. Verify the resulting pair. |
| Catalog write timed out / failed response | Read it back. If new values landed, verify them rather than blindly retrying or restoring old files. |
| Another writer changed the catalog | Reconcile only the affected row on the **latest** catalog, preserving other writers' changes. Never upload an old full-catalog backup as a rollback. If the same book changed, stop and resolve ownership before restoring it. |
| Cover changed but row update did not | Coordinate restoring old cover bytes/metadata or completing the reviewed row update. Verify the chosen hash-versioned URL; immutable URLs already cached are an extra concern, not a reason to rewrite hashes incorrectly. |
| Private EPUB changed, later cover/list step failed | Treat the book/list/cover separately: the UI's second operation does not roll back its first. Verify matching before completing or restoring the affected objects. |
| R2 publish worked, completion/credit D1 update failed | Keep the verified content; report pending record updates. Reconcile the exact report ids/revision under Patrol rather than accepting reports whose content was not used. |
| No snapshot / uncertain restore | Do not regenerate from frozen Git files. Report the inconsistent keys, observed hashes and missing backup; request operator recovery. |

`publishWithCatalog()` snapshots existing file bytes and attempts restoration after a caught
write failure. It is **best effort**, not an atomic publish: restore errors can fail, process
termination may bypass cleanup, newly created objects remain, and original HTTP metadata is not
snapshotted. Cover/private writes are not all inside this helper. Never report rollback as complete
until readback proves consistency. Do not mark feedback resolved merely because a PUT was attempted.

<a id="deploy"></a>
## Application deployment and schema changes

Production is a manual Cloudflare Pages deploy from the public repository. This is a different job
from a live-book update. Do not deploy without authorization and do not assume a push deploys it.

1. Review the intended commit and clean working tree. If merging a PR, fetch the actual merged
   commit and compare it with the reviewed tree before building. Do not build an outdated local main.
2. Check the targeted environment and required account configuration in
   [Accounts](https://github.com/duwqijlk/margin-words/blob/main/docs/ACCOUNTS.md). Never print secrets.
3. For schema changes, inspect the new SQL and compatibility first. Apply required **pending**
   migrations before code that depends on them. Do not replay individual SQL files blindly: some
   migrations rebuild tables/backfill data. Inspect the migration history, take an appropriate D1
   backup and plan old/new code compatibility before a destructive change.

```bash
npx wrangler d1 migrations list margin-words --remote
```

```bash
npx wrangler d1 migrations apply margin-words --remote
```

4. Run checks appropriate to the change: `npx tsc --noEmit`, Functions typecheck when relevant,
   `npm run check:cjk`, focused tests and `npm test`. Documentation distribution also needs
   `node scripts/build-guide.mjs --check` and `npm run check:example`. Some book validators/fixtures
   require authorized EPUBs absent from a public checkout; report unavailable fixtures, not a pass.
5. Build with `VITE_BOOKS_BASE` **unset** for the intended production books host. An empty value is
   for local tests, not production. Ordinary builds do not include book directories.

```bash
npm run build
```

6. Inspect the generated guide/assets and deploy only the site/Functions:

```bash
npx wrangler pages deploy dist --project-name margin-words --branch main
```

7. Verify the deployment URL and custom domain, affected APIs/content and expected protection.
   Check changed hosted documents against source bytes. Do not call a successful build a successful
   deploy, or a deploy response proof the custom domain is serving the expected version.

D1 migrations, R2 data changes, Pages deployment and the glossary-block worker are separate actions.
Do not bundle a frozen book-directory upload into a site deploy. Application rollback does not
restore D1, R2, or device data; verify schema and data compatibility before selecting an older app.

<a id="troubleshooting"></a>
## Troubleshooting: where to start

| Symptom | First checks / owning playbook |
| --- | --- |
| New book missing | Correct live catalog/array/id, successful catalog PUT, category, search/filter, fresh catalog request. A file without a row is not a listing. Book upload. |
| Series absent or split | Exact `series` spelling/category, valid number; automatic rows vs saved `discover-rails.json`, minimum/row limits. Book upload §8. |
| Old cover | Correct `covers/` key, row SHA equals new bytes, `?v=` changes, immutable HTTP metadata; fresh component/page. Book upload §10 and Versions above. |
| Word list fails / Update missing | Authorized R2 readback vs row hash/bytes, public `rev`, target id, account quota/auth errors, own-EPUB match and custom-list hold. Never bypass protection by publishing a glossary URL. |
| Summary/credit missing | Correct file/path/language or entry-level credit; accepted D1 record alone is insufficient; contributor projection rebuilt; fresh page to avoid memoized data. Blurbs / Patrol. |
| Admin returns `catalog-busy` | Other cooperating publisher/lease; investigate before retrying. Do not delete a live lock to force a publish. |
| Deploy caused stale chunks/reload | Expected deployed commit/assets, HTML/SW cache headers, missing asset really 404 rather than HTML, `src/main.tsx` recovery. Not a reason to overwrite book data. |
| API fails after code deploy | Required migration/configuration/bindings, Functions logs and route behavior. Accounts; do not run schema SQL by guesswork. |

<a id="ownership"></a>
## Documentation ownership

| Detailed rule | Single editing home |
| --- | --- |
| Storage boundaries, freshness/revisions, shared safety/recovery, deployment | This file: `docs/MAINTENANCE.md` |
| Book task commands, catalog fields, series/order/rails, cover procedure | [Book upload](https://inputread.site/kit/book-upload.md): `docs/BOOK_UPLOAD.md` |
| Feedback decisions, accepted suggestions, per-entry credit, token-only D1 operations | [Patrol](https://inputread.site/kit/patrol.md): `docs/GLOSSARY_PATROL.md` |
| Summary format, languages, replacement semantics, writing rules | [Book blurbs](https://inputread.site/kit/book-blurbs.md): `docs/BOOK_BLURBS.md` |
| Account configuration/auth/sync/routes and account-specific verification | [Accounts](https://github.com/duwqijlk/margin-words/blob/main/docs/ACCOUNTS.md) |
| Glossary representation and anchoring | [Glossary format](https://github.com/duwqijlk/margin-words/blob/main/docs/GLOSSARY_FORMAT.md) and its linked schema |
| Mandatory coding/UI constraints | [AGENTS.md](https://github.com/duwqijlk/margin-words/blob/main/AGENTS.md) |

**Authority on every run:** reread the owning task playbook, this map and the required source
specifications, not a previous summary, old copy or authoring ZIP. With a checkout, use its actual
`docs/` files and record resolved path/commit/dirty state; without one, reload the hosted playbooks
and linked specifications and record URLs/retrieval times. Never guess a local path. Local source
and hosted instructions are different evidence: record original-byte SHA-256 and compare only
comparable raw Markdown bytes. If not checked, label local/hosted parity **unverified**; if
mismatched, reconcile governing instructions/app version before writes. Do not claim a deploy or
live equivalence from a local preview. Missing required instructions means stop before writes.
Detailed per-run provenance steps and report fields live in Book upload and Patrol.

Patrol's topic is only a device-local open-overlap aid, not a global catalog identity. Read every
report individually through a fixed topic/id cutoff with pagination, then resolve only reviewed,
answered ids; no whole-topic UPDATE. Word feedback may be `reopened`; passage inserts are
`pending` and later work can start a new topic; resolved taps do not auto-reopen. Patrol owns the
exact SQL, tap snapshot guards and unchanged contribution aggregation.

README is navigation, not another runbook. Keep brief safety checkpoints beside destructive steps,
but link to the detailed rule rather than copying it. When changing a schema, key, API or cache
contract, update its owning document and the affected task checkpoints in the same change.

The single source-to-hosted mapping is `HOSTED_DOCS` in `scripts/build-guide.mjs`. It emits these
work documents unchanged at `/kit/*.md`; editing `dist/` is not an update path. Their shared links
use full hosted URLs so an external agent does not need a checkout. Source-only specifications
link to GitHub. The downloadable book-authoring ZIP is not an operations manual and stays separate.

<a id="retired"></a>
## Frozen fixtures and retired publishing tools

`build:books`, `build:private`, `build-packs`, `publish-word-list`, `publish-public-book` and
`build-site` remain for historical/local fixture tooling. They are **not current production book
publishing instructions**. Never rebuild live catalogs from their Git inputs, bulk-upload their
output to repair production, or use them to work around unsupported public-book onboarding.

The migration guides are historical compatibility references. Use this map and the task playbooks
for current work. A newly found unsupported operation should be reported and designed explicitly,
not implemented by silently reviving old instructions.
