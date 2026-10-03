# Margin Words 迁移说明（中文）

本仓库是 Margin Words 项目的完整副本，已迁移到 **私有** GitHub 仓库 `duwqijlk/margin-words`。英文完整版见根目录 [MIGRATION.md](../MIGRATION.md)。

> **只能放在私有仓库。** `packs/` 里的版权书仅供私人使用（9 本带 EPUB，另有纳尼亚全集词表、不含 EPUB）。本仓库必须保持私有；不要公开，也不要把 `packs/` 部署到任何公开网站。

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

- 公有领域的书：放进 `public-books/<id>/`（`book.epub`、`glossary.json`、`cover.jpg`、`info.json`），再运行 `node scripts/build-packs.mjs --out public-books`。
- 有版权的书：放进 `packs/<id>/`，运行 `node scripts/build-packs.mjs`，只供私人使用。

## 没有放进 git 的文件（可重新生成）

`node_modules/`、`dist/`、`dist-books/`、`dist-private/`、`site/`、`packs/*.zip`（含 `all-packs.zip`）、`public-books/*.zip`、`classics/**/*.pack.zip`。
