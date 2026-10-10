# Optional accounts

Reading works with no account: books already on a device stay readable, and a signed-out visitor can browse Discover, the Guide and About. Adding new books (every add / download / "import my EPUB" action on Discover) requires sign-in. Sign-in also adds sync across devices. Book files are not synced and are not stored in D1. They stay on each device (and on `https://books.inputread.site` for the public books).

Accounts use **Cloudflare Pages Functions** (`functions/`) and a **D1** database bound as `DB`. There is no Git integration on the Pages project `margin-words`. Deploy is still `npx wrangler pages deploy dist --project-name margin-words --branch main`. That command uploads `functions/` as well when `wrangler.toml` is present. Do not deploy from this task; the owner deploys.

`wrangler.toml` points `DB` at the live D1 database `margin-words`, id `c286e644-2ead-438c-bb65-70ee028d957a`. That database already exists and `migrations/0001_init.sql` is already applied. Do not create a second database. Local `wrangler pages dev` still uses a local D1.

## What is stored

An email, a PBKDF2-SHA256 password hash (100,000 iterations, random salt per user), and an optional nickname. The nickname is not unique: two accounts may use the same one. No real name, age, school, or phone number.

Synced state is one JSON blob per item in `sync_items`, with `updated_at`:

| kind | item id | blob |
| --- | --- | --- |
| `shelf` | stable book key (normalized title + author) | the shelf card |
| `progress` | same book key | chapter and scroll (the old hint) plus `anchor`: the word list's paragraph id, a short text quote and an offset |
| `wordbook` | `w-a` ... `w-z`, `w-0` (shard by first letter of the lemma) | the ONE global wordbook: one card per lemma, its review schedule, and its `sources`, plus tombstones. A source is a word-list pointer (`ref`: list id, chapter, occurrence, form, phrase, mark), the book key, and the sentence that holds the word. The meaning stays in that list and is read from it whenever the card is shown, including after the list is edited. The sentence stays on the source so the notebook still shows that paragraph. A source saved before pointers is given a pointer on the device that still has that book's list, and the sentence is kept. A sentence that was already dropped is filled again from the book file on this device when that file is still here. |
| `words` | same book key | legacy, one list per book. Old clients still write it; new clients read it and fold it into `wordbook`, and never rewrite it |
| `settings` | `main` | theme, type size, language, review counts |

**Wordbook merge.** Last write wins per lemma. For the review schedule the card with more repetitions wins, then the later stage, then the later last review (so a device that reviewed never loses to one that did not). Sources are the union of both sides, at most 12 live sources per word, and a removed source is a tombstone. A source is keyed by its word-list pointer. A source that still has no pointer is keyed by the book plus the start of its sentence. When a device adds a pointer to an older source, the old key becomes a tombstone and the pointer key is added. The sentence stays on the pointer. Because the wordbook is sharded in 27 items, one D1 row stays small. Old clients ignore the `wordbook` kind and keep using `words`; new clients fold each legacy `words` item into the wordbook on every pull, so nothing written by an old client is lost. A pointer does not copy the meaning into the account. The other device loads `word-lists/<id>/glossary.json` or `public-books/<id>/glossary.json` from the books host and shows that list's current explanation next to the saved sentence. A later edit to the list shows up the next time the card is drawn. A custom list is not fetched: the other device shows the word, the saved sentence, and its review schedule without a fresh explanation until that list exists on the device.

**File-independent positions.** Two devices may hold slightly different EPUB files of the same edition, so a raw scroll position or chapter number can point to the wrong text. A reading place is stored as `{chapter, paragraph, quote, offset}`: the word list's own paragraph numbering plus up to 80 characters of text. Each device resolves it against its own text: the paragraph id first, then the same chapter by quote (nearest to the id), then other chapters, then the nearest paragraph id. A word-list pointer keeps the sentence for the notebook. When that sentence is missing and the book file is already on the device, the notebook fills it from the chapter text. No book file is ever downloaded or replaced.

Last write wins per item. Two devices that each save a different word keep both words. The same word keeps the newer copy. A delete is a tombstone, so it is not undone by an older copy. Review counts keep the higher number for each day.

The book file (EPUB) stays on the device. On a new device the shelf card can appear before the file does. Add the book again from Discover; the app folds the two cards into one.

## Commands the owner runs

The D1 database is already created. Name `margin-words`, id `c286e644-2ead-438c-bb65-70ee028d957a`, binding `DB`. Migration `migrations/0001_init.sql` is already applied on that database. Do not run `wrangler d1 create` again.

For a new environment only:

```bash
npx wrangler d1 create margin-words
npx wrangler d1 migrations apply margin-words --remote
```

There is one migration file. Wrangler applies `migrations/` in filename order.

The account API itself needs no secret. Passwords and session tokens are generated in the Worker. Session tokens are stored only as SHA-256 hashes. The cookie is `mw_session`, HttpOnly, SameSite=Lax, and Secure on https. It expires after 30 days. Email reset needs one more secret, `RESEND_API_KEY` (see the password reset section below).

Turnstile on registration, login, and the password-reset request is on in production. The public site key in `.env.production` is the world-region widget. The secret is the Pages secret `TURNSTILE_SECRET_KEY`. A production build bakes the site key into the page. The server accepts a token only when siteverify returns success on `inputread.site`, `www.inputread.site`, or `margin-words.pages.dev`, with action `signup` for register, `login` for login, and `reset` for the password-reset request. If the secret is unset, none of the routes require a token.

The widget region is `world`. Readers in mainland China can stay on the widget's own Troubleshoot screen, because that challenge host does not finish there. This account cannot create a `china` widget (`not entitled` for region `china`), and a world site key loaded from `https://challenges.cloudflare-cn.com/turnstile/v0/api.js` is rejected. Rate limits on register and the reset request stay in place.

Deploy (owner, not this repo's automation). `npm run build` with no `VITE_BOOKS_BASE` keeps book files on `https://books.inputread.site`. Do not deploy a `build:local` folder.

```bash
npm run build
npx wrangler pages deploy dist --project-name margin-words --branch main
```

That uploads `dist/` and `functions/` only. Do not upload `dist-books/`, `packs/`, or `dist-private/` with it.

`pages deploy` uploads `dist/` and the `functions/` directory, and it attaches the `DB` binding from `wrangler.toml`. The Pages project name is `margin-words`.

### Live checklist

Do these in order, logged in to the Cloudflare account that owns the Pages project `margin-words`.

1. Database. Already done: D1 name `margin-words`, id `c286e644-2ead-438c-bb65-70ee028d957a`, written in `wrangler.toml` as binding `DB`. Do not create another database.

2. Schema. Already applied: `migrations/0001_init.sql`. `migrations/0002_nickname.sql` adds optional `users.nickname` (not unique). Apply it before deploying functions that read that column:

   ```bash
   npx wrangler d1 migrations apply margin-words --remote
   ```

3. Secrets and env vars.

   | Name | Required | Where it is set |
   | --- | --- | --- |
   | `DB` | yes | Pages binding from `wrangler.toml` (`binding = "DB"`). Not a secret. |
   | `TURNSTILE_SECRET_KEY` | yes in production | Pages secret. When it is set, register and login require a token. |
   | `RESEND_API_KEY` | only to send reset mail | Pages secret. When it is set, password-reset requests send mail through Resend; `/api/auth/me` reports `resetEmail: true`. Unset keeps the hook off. |
   | `VITE_TURNSTILE_SITE_KEY` | yes for a production build | Public world-region site key in `.env.production`. `npm run build` picks it up. |
   | `VITE_BOOKS_BASE` | no | Build-time only. Leave unset so production uses `https://books.inputread.site`. |

   No other secret is used. Session tokens are random and stored as SHA-256 hashes. There is no JWT signing key.

   The production secret is a Pages secret. Do not put it in the repo. `npm run build` reads the public site key from `.env.production`.

4. Build and deploy, from the repo root:

   ```bash
   npm run build
   npx wrangler pages deploy dist --project-name margin-words --branch main
   ```

   Do not upload `dist-books/`, `packs/`, or `dist-private/` with that deploy.

### Verify on the live site

Use a new email you control. Password at least 8 characters.

1. Signed out. Open `https://inputread.site/shelf`. The shelf, Discover, and a book still open with no account. The person icon is in the top bar.
2. Sign up. Person icon → Create account → email, password, password again. The dialog should say signed in and then "Synced" (Chinese UI: "已同步").
3. Log in. Sign out, then sign in with the same email and password. The dialog shows that email again.
4. Sync. On this browser, change a setting (language or type size) or add a book to the shelf. Wait about two seconds until it says Synced. In a private window, or another device, open `https://inputread.site`, sign in with the same account, and confirm that change is there. Book files are not copied; a shelf card can show up before the EPUB does. Add the book again from Discover on the second device if the file is missing.
5. Delete. In the account dialog, choose Delete account, enter the password, and confirm. Sign-in with that email and password then fails. Books already on the device stay on the device.

A cookie check from a terminal (the `Set-Cookie` line must include `HttpOnly`, `Secure`, and `SameSite=Lax`):

```bash
curl -sS -D - -o /dev/null -c /tmp/mw.cookies \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"correct horse"}' \
  https://inputread.site/api/auth/register
curl -sS -b /tmp/mw.cookies https://inputread.site/api/auth/me
curl -sS -b /tmp/mw.cookies -H 'content-type: application/json' \
  -d '{"items":[]}' https://inputread.site/api/sync
curl -sS -b /tmp/mw.cookies -X POST -H 'content-type: application/json' \
  -d '{"password":"correct horse"}' https://inputread.site/api/auth/delete
curl -sS -b /tmp/mw.cookies https://inputread.site/api/auth/me
curl -sS -o /dev/null -w '%{http_code}\n' -b /tmp/mw.cookies https://inputread.site/api/auth/export
```

After delete, `/api/auth/me` is `200` with `{"user":null,"resetEmail":true}` (`resetEmail` is `true` in production because the Resend key is set; it does not depend on sign-in). `/api/auth/export` (and `/api/sync`) is `401`. A signed-out `GET /api/auth/me` is also `200` with `{"user":null,"resetEmail":true}`, and the shelf page should still load.

## Local development

Install dependencies, then apply migrations to a local D1 and serve the built site with the functions:

```bash
npm install
npx wrangler d1 migrations apply margin-words --local
npm run build:local
npx wrangler pages dev dist --port 8788
```

Open `http://localhost:8788`. The account button is in the top bar, and the same screen is linked from Settings. `build:local` keeps book files on this origin so Discover still works.

For a live front end while editing UI, run Vite and point Pages at it (functions stay on Wrangler, the page is proxied):

```bash
npm run dev
npx wrangler pages dev --proxy 8080 --port 8788
```

`http://localhost:8788` is not https, so the session cookie is HttpOnly and SameSite=Lax but not Secure. Production (`https://inputread.site`) sets Secure. Browsers drop a Secure cookie on plain http, which would make local sign-in look broken.

Check the functions types:

```bash
npm run typecheck:functions
```

## Password reset hook

Email reset is served by **Resend** (`https://api.resend.com/emails`, `Authorization: Bearer` with the Pages secret `RESEND_API_KEY`). Mail goes out from `no-reply@inputread.site`, so the domain must stay verified in the Resend dashboard (DKIM/CNAME records on Cloudflare DNS). Mainland China cannot rely on Google or GitHub login, and this app does not send any other mail.

`functions/lib/email.ts` exports `resendSender(apiKey)`. `handlePasswordResetRequest` uses it when `RESEND_API_KEY` is set, and the no-op `deliverPasswordReset` otherwise. You receive `{ email, resetUrl, token, expiresAt }`. The link is:

```text
https://inputread.site/shelf?reset=<token>
```

The page opens a "new password" form. Confirming calls `POST /api/auth/password-reset/confirm` with `{ token, password }`, stores a new hash, and signs every session out. Tokens expire after one hour. The request endpoint always answers `{ ok: true }` so it does not reveal whether the email exists. The login dialog shows a "send reset link" form only when `/api/auth/me` reports `resetEmail: true`; without the key it keeps the note that email reset is not turned on.

Do not log the token. If the key must rotate, put the new one in Resend and replace the Pages secret; no code change is needed.

## API

All routes are same-origin. The service worker does not answer requests, so `/api/*` is not cached.

| Method | Path | |
| --- | --- | --- |
| POST | `/api/auth/register` | `{ email, password, turnstileToken? }` |
| POST | `/api/auth/login` | `{ email, password, turnstileToken? }` |
| POST | `/api/auth/logout` | clears the cookie |
| GET | `/api/auth/me` | `200` and `{ user, resetEmail }` when signed in, `200` and `{ user: null, resetEmail }` when signed out. `user.nickname` is a string or null. `resetEmail` is the global flag for the reset-mail provider |
| POST | `/api/auth/nickname` | `{ nickname }` saves a 1–16 character label. Not unique |
| POST | `/api/auth/delete` | `{ password }` deletes every row for that user |
| GET | `/api/auth/export` | email, created time, nickname, and sync items (no password hash) |
| POST | `/api/auth/password-reset/request` | `{ email, turnstileToken? }` |
| POST | `/api/auth/password-reset/confirm` | `{ token, password }` |
| GET | `/api/sync` | all items (optional `?since=` unix ms) |
| POST | `/api/sync` | `{ items: [...] }` merges and returns the stored rows |

Login and register are rate-limited per IP and per email (15-minute window): login 20 per IP and 10 failed logins per email, register 10 per IP and 5 per email. A successful login does not add to the per-email count. IPv6 addresses share a bucket by their /64 prefix. Password reset uses the same window at 10 per IP and 5 per email.

## Client behavior

On launch the app rehydrates the local stores, then asks `/api/auth/me`. `{ user: null }` means signed out. If that call fails because the functions are not deployed, the app stays signed out and keeps working.

On sign-in it pulls the server copy, merges it with this device (union, then last-write-wins), and pushes anything the server did not already have. Later edits are pushed about 1.5 seconds after the last change, and also when the page is hidden. A pull runs on start and when the tab becomes visible. If the network is down, the change stays queued in this browser and is sent on the next successful sync.

Signing out or deleting the account does not wipe the books on this device.

## Schema

`migrations/0001_init.sql`:

- `users` — id, email, password_hash, password_salt, password_iters, created_at, and (from `0002_nickname.sql`) nickname
- `sessions` — token_hash, user_id, created_at, expires_at (cascade delete)
- `rate_limits` — bucket, window_start, hits
- `sync_items` — user_id, kind, item_id, data, updated_at, deleted (cascade delete)
- `password_resets` — token_hash, user_id, created_at, expires_at, used_at (cascade delete)
- `sponsorships` — (`0003_sponsorship.sql`) id, user_id, method (`wechat`, `alipay`, or `crypto`), display_name, created_at, email_sent_at, amount_cents, listed_at, closed_at (cascade delete)

Apply `0003` before a deploy that serves the sponsorship functions: `npx wrangler d1 migrations apply margin-words --remote`.

## Sponsorship

A sponsorship is a public-interest donation. The site does not take payment, does not store a WeChat id, an Alipay account, or a wallet address, and does not send the instruction email. The reader picks a way. The name on the thank-you list is the account nickname, not a name typed in the dialog. A request needs a nickname already saved on the account. The dialog always shows the official address `xcrunnnn@outlook.com`. One open request per account. After it is listed or closed, the reader can send another. If the nickname changes later, the public list uses the new one.

`/admin` is not in the menu. `GET` and `POST /api/admin/sponsorships` answer 403 unless the signed-in email is that official address. The admin marks the email sent, types the USD amount (the only unit; no conversion in the app), and lists the row. A listed row is one gift. Repeat gifts add up. The public `GET /api/sponsorships` returns two lists, `month` and `total`, one line per person: cents confirmed in the current China month (UTC+8), and cents confirmed in total. The overview rotates one name in each column. Deleting the account removes that person's rows, so the name leaves the list.

| Method | Path | Who |
| --- | --- | --- |
| GET | `/api/sponsorships` | anyone; listed gifts only |
| POST | `/api/sponsorships` | signed in, with a nickname; `{ method }` |
| GET | `/api/sponsorship-request` | signed in; the open request, or `{ open: null }` |
| GET | `/api/admin/sponsorships` | admin |
| POST | `/api/admin/sponsorships` | admin; `{ id, action: "email" \| "list" \| "close", amount? }` |
