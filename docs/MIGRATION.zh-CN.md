# Margin Words 迁移说明（中文）

> **公开仓库。** 2026-10-04 起，旧的 Pull Request 留在私有档案 `duwqijlk/margin-words-archive`。这个仓库是公开项目。见 [ARCHIVE.zh-CN.md](ARCHIVE.zh-CN.md)。

英文完整版见根目录 [MIGRATION.md](../MIGRATION.md)。

> **Git 里不放书的文件。** 版权 EPUB 只在私有桶 `margin-words-private`（不公开，应用不会去读）。公版 EPUB 只在书籍站 `https://books.inputread.site`。仓库里的 `packs/` 是词表和封面，不是书。不要把 `packs/` 部署到公开网站。旧 Pull Request 在私有档案里，那里还有书的文件，所以档案保持私有。这个公开仓库没有那些文件。

## 概览

- 静态阅读器（Vite + React 19 + Tailwind 4 + zustand），没有 AI 调用。已下载的书不登录也能读；添加新书要先登录。账号在 `functions/`（见 docs/ACCOUNTS.md）。
- 应用里没有导入 `.zip` 的入口；添加图书都在“发现”页。“书包”（一个 `.zip`，里面正好是 `book.epub` + `glossary.json`）是书籍站点的格式。不接受单独的 EPUB。
- 界面有中文和英文两种语言；书和释义始终是英文。
- 词表（glossary）必须人工手写，不用 AI 生成。

## 规则

- 不能有布局抖动：运行 `node scripts/layout-shift-test.mjs after --quick`，结果必须是 `max shift 0px`、`0 failing`。
- 界面文字用简单英文（中文在 `src/lib/i18n-zh.ts`）。
- 中文只允许出现在 `src/lib/i18n-zh.ts`、`docs/`、`README.zh-CN.md`；用 `npm run check:cjk` 检查。

## 安装与构建（Node 24）

```
npm ci
npx vite build
node scripts/build-packs.mjs --out public-books
```

## 部署

Cloudflare Pages 项目 `margin-words`，域名 `inputread.site`：

```
npx vite build
npx wrangler pages deploy dist --project-name margin-words --branch main
```

`dist/` 只有网页，没有书。书的文件用 `npm run build:books` 生成，再上传到书籍站点（公有领域的 EPUB，以及版权书的词表和缩小后的封面）。**绝不要公开部署 `packs/`。** 版权 EPUB 用 `npm run build:private` 生成 `dist-private/`，只放进没有公开访问的私有桶 `margin-words-private`。应用不会请求这个桶。不要把 `dist-private/` 放进 `dist/` 或 `dist-books/`。

## 添加书

- 公有领域的书：EPUB 在书籍站上。词表、封面放进 `public-books/<id>/`。本机有 `book.epub` 时再运行 `node scripts/build-packs.mjs --out public-books`。
- 有版权的书：EPUB 放在私有桶里。词表放进 `packs/<id>/`。本机有 `book.epub` 时再运行 `node scripts/build-packs.mjs`。

## 没有放进 git 的文件（可重新生成）

除了 `examples/sample-book/the-lantern-seller.epub`，所有 `*.epub` 都不进 Git。另外还有 `node_modules/`、`dist/`、`dist-books/`、`dist-private/`、`site/`、`packs/*.zip`（含 `all-packs.zip`）、`public-books/*.zip`、`classics/**/*.pack.zip`。
