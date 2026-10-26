# Margin Words 迁移与兼容记录（中文）

> **公开仓库。** 2026-10-04 起，旧的 Pull Request 留在私有档案 `duwqijlk/margin-words-archive`。这个仓库是公开项目。见 [ARCHIVE.zh-CN.md](ARCHIVE.zh-CN.md)。

英文版本见根目录 [MIGRATION.md](../MIGRATION.md)。

本文记录历史迁移和兼容行为，不是当前上传书籍、维护线上词表或部署网站的手册。当前操作从 [docs/MAINTENANCE.md](MAINTENANCE.md) 开始；按工作阅读[上传书籍](BOOK_UPLOAD.md)、[词表巡查](GLOSSARY_PATROL.md)、[书籍简介](BOOK_BLURBS.md)和[账号](ACCOUNTS.md)。

> **Git 里不放书的文件。** 版权 EPUB 只在私有桶 `margin-words-private`；公版 EPUB 只在书籍站 `https://books.inputread.site`。仓库里的 `packs/` 和 `public-books/` 是冻结快照，不是线上当前来源，不要把它们部署成线上书籍数据。私有档案里的旧 Pull Request 仍有书籍文件，所以档案保持私有。

## 1. 历史概览

- 这是一个用 Vite、React 和 zustand 做的静态阅读器，没有 AI 调用。可选账号使用 Pages Functions 和 D1；阅读不需要账号。
- 历史上的图书包格式是一个正好包含 `book.epub` 和 `glossary.json` 的 `.zip`。这个格式仍用于示例 kit 和兼容检查；应用当前从“发现”添加书，不是导入散装文件或 zip。
- 按钮和消息有中英文两种语言；书的正文和释义保持英文。
- 早期仓库保存了本机图书包目录和示例材料。这些文件现在只作为冻结的兼容样本。

## 2. 仓库和快照内容

| 路径 | 历史或兼容作用 |
| --- | --- |
| `src/`、`public/`、`index.html`、`vite.config.ts` | 应用 |
| `scripts/` | 构建、检查和测试脚本；一些图书包构建器仍用于本机样本 |
| `docs/`、`examples/`、`skills/` | 规格、示例书和辅助 skill |
| `glossary-src/` | 手写词表的来源 |
| `packs/<id>/` | 冻结的词表、封面和元数据快照，不是线上来源 |
| `public-books/<id>/` | 冻结的公版快照，不是线上来源 |
| `classics/<id>/` | 历史工作笔记 |
| `book-pack-kit.zip` | 制作示例图书包的兼容 kit |

除示例 EPUB 外，EPUB 通常不在 Git 里。唯一跟踪的 EPUB 是 `examples/sample-book/the-lantern-seller.epub`；线上书籍的合法 EPUB 可能不在本机，因此在某个 checkout 里不一定能完成完整的 EPUB/词表检查。

## 3. 仍然有效的规则

- 打开卡片或面板不能造成布局抖动。有 Chrome 和匹配的本机书时，运行 `node scripts/layout-shift-test.mjs after --quick`；应看到 `max shift 0px` 和 `0 failing`。
- 所有界面文字都要同时放在 `src/lib/i18n-en.ts` 和 `src/lib/i18n-zh.ts`；`npm run check:cjk` 检查仓库的中文边界。
- 阅读器不发起 AI 调用，不代表禁止经授权的 agent 制作或修正词表；按[注释技能](../skills/annotate-book-glossary/SKILL.md)和当前工作手册操作，不要使用旧发布流程。
- 不要把第三方 EPUB 放进 Git，也不要把版权 EPUB 放进公开桶；见[存储边界](MAINTENANCE.md#storage)。

## 4. 本机兼容检查

使用 `package.json` 声明的 Node 22 或更高版本。

```bash
npm ci
npm run build:local       # 测试时让书籍地址留在本机来源
npm run check:cjk
npm run check:example
npm test
npm run typecheck:functions
```

完整词表检查需要匹配的合法 EPUB：

```bash
node scripts/validate-glossary.mjs <book.epub> <glossary.json>
```

没有那本 EPUB 时，不要用另一个版本代替，也不要声称已经完整检查线上词表。`node scripts/build-packs.mjs --check` 只检查本地冻结样本，不会发布它。

## 5. 兼容数据行为

以下记录保留给旧客户端和旧数据：

- 本机词汇会从旧的按书存储迁移为每个词条一个全局生词卡，并带有 `sources[]`；复习计划字段保持不变。`scripts/wordbook.test.mjs` 和 `scripts/wordbook-e2e.mjs` 覆盖这个迁移。
- 同步数据保留旧的 `words` 类型。新客户端把旧项目合并进 `wordbook`，不会删除它们；旧客户端忽略 `wordbook`。改变这个协议时，客户端和 Functions 要一起部署。
- 阅读位置可以在旧的章节/滚动提示旁带新的 `{ chapter, paragraph, quote, offset }` 锚点。每台设备用自己的本地正文解析；同步不会下载或替换 EPUB。
- 已有书籍的书架会保留它。新书架不会自动安装任何书。

这些内容用于保留回滚和旧客户端行为，不代表当前操作地图，也不授权直接写入线上数据。

## 6. 历史上的部署边界

Pages 项目没有 Git 来源。网站、D1 数据库和 R2 存储桶都与此仓库分开。正式网站构建使用书籍站；`npm run build:local` 只用于本机检查。部署归属、缓存规则、存储安全、恢复和直接写入流程属于 [docs/MAINTENANCE.md](MAINTENANCE.md)，不属于这份历史记录。

## 7. 版权边界

这个仓库是公开的，历史里除示例外没有第三方 EPUB。版权 EPUB 仍在私有位置；公版文件仍在书籍站。私有档案保持私有，因为里面的旧 Pull Request 含有版权文件。
