# Margin Words（边注词典）

[![网站](https://img.shields.io/badge/site-inputread.site-1E4A3A)](https://inputread.site)
[![PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm_Noncommercial_1.0.0-blue.svg)](LICENSE)

> **公开仓库。** 以后的开发、推送和 Pull Request 都在这里。所有者已在 2026-10-04 归档私有档案 [duwqijlk/margin-words-archive](https://github.com/duwqijlk/margin-words-archive)。它只读，并保持私有。记录：[docs/ARCHIVE.zh-CN.md](docs/ARCHIVE.zh-CN.md)。

一个英文小说阅读器，给中国初中生用。读书时点一个词，就能看到为这本书写的简单英文解释。按钮和菜单有**简体中文**和**英文**。书里的内容一直是英文。没有 AI。

**[打开阅读器](https://inputread.site)** · [English](README.md)

![发现页：公版书封面，封面上的加号用来把书放进书架](docs/images/discover-zh.png)

## 项目介绍

Margin Words 是一个英文小说阅读器，给正在开始读英文原著的中国初中生用。

在故事里点一个词，卡片上就是为这本书写的简单英文解释。段落笔记、句子笔记和短语留在正文旁边，打开卡片时页面不会挪动。按钮和菜单可以是简体中文或英文，小说本身一直是英文。阅读器里没有 AI。

已经在这台设备上的书，不登录也能读；第一次下载之后，没有网络也能读。新书只能从“发现”添加，这一步需要登录。公版经典从书籍站点下载。仍有版权的小说不会放在这里：“发现”给出词表和书号，读者添加自己合法获得的 EPUB。

可以直接打开 [inputread.site](https://inputread.site)。这个仓库公开提供源代码，使用 [PolyForm Noncommercial 1.0.0 非商业许可证](LICENSE)，[适用范围和例外见下文](#许可证)。

## 能做什么

- **点词看解释。** 点一个词，卡片上是这本书词表里的简单英文意思。词表里没有的词会直接说明。卡片浮在文字上面，页面不会被挤开。
- **段落旁边的笔记。** 有笔记的段落，边上一直有一盏小灯。句子笔记和短语也从正文里打开。
- **先有书架，再到发现。** 新书架是空的，会带你去“发现”。“发现”是添加图书的唯一入口，而且要先登录。没登录也可以浏览全部书。已经存在这台设备上的书，不登录也能读。
- **公版经典。** 《爱丽丝梦游仙境》《金银岛》和其他免费的书，添加时才会下载。名人演讲在“发现”里单独的一个标签。
- **有版权的书仍由读者自己保存。** 这类书在“发现”里只提供词表和书号，不提供小说文件。你把自己的 EPUB 加到这张卡片上。应用会告诉你有多少原文能对上；低于 80% 时会先说明。
- **生词本。** 存下一个词，以后再复习。每个词一张卡片，并记下它原来的那句话。
- **数据页。** 一页看完“发现”里的全部书：书的数量、标出的单词、段落笔记、句子笔记、短语，还有系列。
- **存在这台设备上。** 书和词表存在浏览器里。打开网站需要网络。
- **账号可有可无。** 添加新书需要登录。同一个账号还可以把书架、阅读位置、生词和设置同步到别的设备。读书本身不需要账号。

用 Vite、React 和 Tailwind 做成。账号功能打开时，用 Cloudflare Pages Functions 和 D1。说明见 [docs/ACCOUNTS.md](docs/ACCOUNTS.md)。

## 在自己的电脑上运行

```bash
npm install
npm run dev
```

打开 <http://localhost:8080>。

`npx vite build` 会把静态网站写到 `dist/`（HTML、JS、CSS 和字体）。这个文件夹里没有书。正式构建从 `https://books.inputread.site` 读取书籍。`npm run build:local` 把书籍地址留在同一站点，测试用这个。

任何静态网站都可以托管 `dist/`。可选的账号接口是放在这些文件旁边的 Pages Function。没有这些函数，阅读器照常可用。

## 做一本图书包

应用不能导入单独的 EPUB，也不能导入 zip。读者只从“发现”添加书。

**图书包**是把一本书准备进目录的格式：一个 `.zip`，里面正好是 `book.epub` 和 `glossary.json`。规则在 [docs/book-pack-spec.md](docs/book-pack-spec.md) 第 3 节。

`book-pack-kit.zip` 给做书的人，或者给 AI。里面有规格说明、示例故事 *The Lantern Seller*、它的词表，以及一个做好的示例包。应用里的“使用说明”和“设置”有“怎样做图书包”的链接（页面 `/kit/`）。

```bash
node scripts/make-pack.mjs book.epub glossary.json my-book.pack.zip
npm run build:kit
npm run check:example
```

## 许可证

从引入本次许可变更的提交起，XCRUN 有权重新授权的本项目原创应用代码、Pages Functions、工具和文档，采用 [PolyForm Noncommercial License 1.0.0](LICENSE)。

Required Notice: Copyright (c) 2026 XCRUN

你可以在许可证规定的允许用途内使用、复制、分发和修改这些内容，包括协议明确允许的个人用途和非商业组织用途。超出这些允许用途的商业使用，必须另行取得相关权利人的书面授权；可通过 <https://github.com/duwqijlk/margin-words/issues> 联系维护者。分发时须附带许可证（或其链接）及 Required Notice 声明。这是公开源代码的非商业许可，不是 OSI 认可的开源许可证。

本次变更不能撤销此前版本已经授予的 MIT 权利。按 MIT 获得的旧版本仍可按原许可使用，但这不意味着之后仅按新许可发布的修改也适用 MIT。第三方代码、依赖、字体、图标、独立授权的示例，以及 XCRUN 无权重新授权的贡献，继续适用各自的许可和声明；根目录许可证不会替换这些许可。

小说是另一回事：

| 内容 | 许可 |
| --- | --- |
| 上述范围内的原创阅读器、Pages Functions、工具和文档 | [PolyForm Noncommercial 1.0.0 非商业许可证](LICENSE)；适用范围及此前的 MIT 授权见上文 |
| 示例故事 *The Lantern Seller* | 本项目原创，[CC0](https://creativecommons.org/publicdomain/zero/1.0/)。见 [docs/book-pack-spec.md](docs/book-pack-spec.md)。 |
| 公版书 | 公有领域。文件不在 Git 里，由书籍站点提供。 |
| 仍有版权的书 | 不在这个仓库里。本项目不托管、不出售、不分享这些书。“发现”只列出词表和书号。读者使用自己合法获得的 EPUB。 |
| 词表（`glossary.json`） | 本应用的学习笔记。笔记里的短引文仍属于原作者和出版社。 |
| [English Read](https://github.com/bitbw/english-read) | 另一个项目，Copyright (c) 2026 English Read contributors，[MIT](https://github.com/bitbw/english-read/blob/main/LICENSE)。Margin Words 受到它的启发，但是独立的应用。 |

如果某段引文不该出现在这里，请到 <https://github.com/duwqijlk/margin-words/issues> 告诉我们。

## 开发和维护

书和词表不再在这个仓库里维护。这里的 `packs/` 和 `public-books/` 是冻结快照；线上 R2 存储桶和 D1 记录才是当前来源。不要把线上内容复制回 Git，不要提交书籍内容，也不要为书籍内容开 PR。当前操作地图见 [docs/MAINTENANCE.md](docs/MAINTENANCE.md)。

先看[维护地图](docs/MAINTENANCE.md)，了解存储归属、版本与缓存、发布安全和恢复，再按任务进入对应指南：

| 想改什么 | 去哪里 | 是否需要部署 |
| --- | --- | --- |
| 界面、阅读器、浏览器行为 | `src/`；[项目约束](AGENTS.md) | 需要 |
| API、登录、权限、配额行为 | `functions/`；[账号手册](docs/ACCOUNTS.md) | 需要；先满足数据库结构要求 |
| 书籍、词典、封面、书籍系列/分类 | [上传手册](docs/BOOK_UPLOAD.md) | 不需要 |
| 发现页保存的展示列 | 后台 → 系列；[系列与展示列的区别](docs/BOOK_UPLOAD.md#86-a-books-series-vs-a-discover-rail) | 不需要 |
| 读者反馈、释义修正、采纳署名 | [巡检手册](docs/GLOSSARY_PATROL.md) | 不需要 |
| 双语简介 | [简介手册](docs/BOOK_BLURBS.md) | 不需要 |
| 账号数据和角色 | [账号手册](docs/ACCOUNTS.md) | 支持的纯数据操作不需要 |
| 线上工作文档 | `docs/`；[文档归属](docs/MAINTENANCE.md#ownership) | 需要，发布到 `/kit/*.md` |

当前唯一的[部署流程](docs/MAINTENANCE.md#deploy)由维护地图说明，不放在书籍手册里。

不要用已经废弃的本机发布命令更新线上书籍。公开显示的贡献者姓名和头像文件，是“用户数据只放 D1”规则中已记录的 R2 例外；遇到这部分时按维护地图操作。

公开网站是 [inputread.site](https://inputread.site)。更早的 Pull Request 留在私有档案 [duwqijlk/margin-words-archive](https://github.com/duwqijlk/margin-words-archive)；见 [docs/ARCHIVE.zh-CN.md](docs/ARCHIVE.zh-CN.md)。[迁移说明](docs/MIGRATION.zh-CN.md)只保留历史和兼容记录，当前操作请看[维护地图](docs/MAINTENANCE.md)，不要把迁移说明当作新的操作指南。

### 本机检查

常用的本机检查：

```bash
npx tsc --noEmit
npm run check:cjk          # 中文只允许出现在 src/lib/i18n-zh.ts、docs/ 和 README.zh-CN.md
npm run check:example
npm test
```

完整的词表检查需要匹配的 EPUB；本仓库没有线上书籍所需的本地 EPUB。只有在你有这本书的合法本地 EPUB 时，才运行 `node scripts/validate-glossary.mjs <book.epub> <glossary.json>`。`node scripts/build-packs.mjs --check` 只检查冻结快照，不会发布它。

### 界面语言

所有看得见的文字都在两本词典里，键名相同：`src/lib/i18n-en.ts` 和 `src/lib/i18n-zh.ts`。少一个键，`npx tsc --noEmit` 就会失败。第一次打开时跟着浏览器语言（中文用中文，其他用英文），选择会保存下来。书的内容（解释、笔记、短语、书名）不会被翻译。

## 来源

这个阅读器的想法来自开源项目 [English Read](https://github.com/bitbw/english-read)（Copyright (c) 2026 English Read contributors，[MIT 许可证](https://github.com/bitbw/english-read/blob/main/LICENSE)）。Margin Words 是我们自己的应用。应用里的“使用说明”也写了同样的话。
